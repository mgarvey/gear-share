import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const status = spawnSync("supabase", ["status", "-o", "env"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, DOCKER_API_VERSION: "1.43" },
});
if (status.status !== 0) {
  throw new Error(`Unable to inspect the local gear share stack. Run npm run db:start first.\n${status.stderr.trim()}`);
}

function localSetting(name) {
  const match = status.stdout.match(new RegExp(`^${name}="([^"]+)"$`, "m"));
  if (!match) throw new Error(`Local Supabase status did not provide ${name}`);
  return match[1];
}

const apiUrl = localSetting("API_URL");
const anonKey = localSetting("ANON_KEY");
const serviceRoleKey = localSetting("SERVICE_ROLE_KEY");
const service = createClient(apiUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anonymous = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const password = `Local-only-${randomUUID()}!`;
const suffix = randomUUID();
const createdUserIds = [];
let crossCommunityId;
let supplyId;
let groupSupplyId;
let objectPath;
let restorePath;
let deniedGroupPath;
let administratorGroupPath;

const discovery = spawnSync("docker", [
  "ps",
  "--filter", "label=com.supabase.cli.project=community-gear-lending",
  "--filter", "name=supabase_db_",
  "--format", "{{.Names}}",
], { encoding: "utf8" });
const containers = discovery.stdout.trim().split("\n").filter(Boolean);
if (discovery.status !== 0 || containers.length !== 1) {
  throw new Error(`Expected one running gear share database container; found ${containers.length}`);
}

function runSql(sql) {
  const result = spawnSync("docker", ["exec", "-i", containers[0], "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: sql,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Storage fixture SQL failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function expectSuccess(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function createUser(kind) {
  const email = `storage-${kind}-${suffix}@example.test`;
  const data = await expectSuccess(await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `Storage ${kind}` },
  }), `create ${kind} user`);
  createdUserIds.push(data.user.id);
  const client = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await expectSuccess(await client.auth.signInWithPassword({ email, password }), `sign in ${kind} user`);
  return { id: data.user.id, client };
}

async function expectStorageDenied(promise, label) {
  const result = await promise;
  if (!result.error) throw new Error(`${label}: request unexpectedly succeeded`);
}

try {
  const active = await createUser("active");
  const pending = await createUser("pending");
  const deactivated = await createUser("deactivated");
  const cross = await createUser("cross-community");
  const storedWithContact = await createUser("stored-with-contact");

  const communityId = runSql("select id from public.communities where slug = 'gear-share-community';");
  crossCommunityId = randomUUID();
  supplyId = randomUUID();
  groupSupplyId = randomUUID();
  objectPath = `${communityId}/${supplyId}/${randomUUID()}.jpg`;
  deniedGroupPath = `${communityId}/${groupSupplyId}/${randomUUID()}.jpg`;
  administratorGroupPath = `${communityId}/${groupSupplyId}/${randomUUID()}.jpg`;
  runSql(`
insert into public.communities (id, slug, name)
values ('${crossCommunityId}', 'storage-cross-${suffix}', 'Storage cross-community fixture');
update public.profiles
set membership_status = 'active', approved_by = '${active.id}', approved_at = now()
where id in ('${active.id}', '${storedWithContact.id}');
update public.profiles
set membership_status = 'deactivated', deactivated_by = '${active.id}', deactivated_at = now()
where id = '${deactivated.id}';
update public.profiles
set community_id = '${crossCommunityId}', membership_status = 'active', approved_by = '${active.id}', approved_at = now()
where id = '${cross.id}';
insert into public.supplies (
  id, community_id, title, description, category, condition, ownership_kind, owner_id, custodian_id,
  quantity_total, listing_status, created_by
) values (
  '${supplyId}', '${communityId}', 'Storage policy fixture',
  'Disposable local integration-test listing', 'other-gear', 'good', 'individual', '${active.id}',
  '${active.id}', 1, 'listed', '${active.id}'
);
insert into public.community_roles (community_id, user_id, role, granted_by)
values
  ('${communityId}', '${active.id}', 'member', '${active.id}'),
  ('${communityId}', '${active.id}', 'steward', '${active.id}'),
  ('${communityId}', '${storedWithContact.id}', 'member', '${active.id}');
insert into public.supplies (
  id, community_id, title, description, category, condition, ownership_kind, owner_id, custodian_id,
  quantity_total, listing_status, created_by
) values (
  '${groupSupplyId}', '${communityId}', 'Group media policy fixture',
  'Stored with contact must not mutate media', 'other-gear', 'good', 'group', null,
  '${storedWithContact.id}', 1, 'listed', '${active.id}'
);
`);

  await expectStorageDenied(
    active.client.storage.from("gear-images").upload(objectPath, new Blob(["local storage fixture"], { type: "image/jpeg" })),
    "individual manager direct final upload",
  );
  await expectSuccess(
    await service.storage.from("gear-images").upload(objectPath, new Blob(["local storage fixture"], { type: "image/jpeg" })),
    "server-created individual final object fixture",
  );

  const exportedObject = await expectSuccess(await service.storage.from("gear-images").download(objectPath), "export private object");
  const exportedBytes = Buffer.from(await exportedObject.arrayBuffer());
  const exportedSha256 = createHash("sha256").update(exportedBytes).digest("hex");
  restorePath = `${communityId}/${supplyId}/${randomUUID()}.jpg`;
  await expectSuccess(await service.storage.from("gear-images").upload(restorePath, exportedBytes, { contentType: "image/jpeg" }), "restore private object to disposable path");
  const restoredObject = await expectSuccess(await service.storage.from("gear-images").download(restorePath), "download restored private object");
  const restoredBytes = Buffer.from(await restoredObject.arrayBuffer());
  const restoredSha256 = createHash("sha256").update(restoredBytes).digest("hex");
  if (restoredSha256 !== exportedSha256 || restoredBytes.byteLength !== exportedBytes.byteLength) {
    throw new Error("restored private object does not match the export manifest");
  }
  const restoredSigned = await expectSuccess(await active.client.storage.from("gear-images").createSignedUrl(restorePath, 60), "active member signs restored object");
  const restoredResponse = await fetch(restoredSigned.signedUrl);
  if (!restoredResponse.ok || await restoredResponse.text() !== "local storage fixture") {
    throw new Error(`restored signed object was not usable: HTTP ${restoredResponse.status}`);
  }
  process.stdout.write(`Storage export/restore rehearsal OK: ${JSON.stringify({ path: objectPath, byteLength: exportedBytes.byteLength, sha256: exportedSha256 })}\n`);

  await expectStorageDenied(
    storedWithContact.client.storage.from("gear-images").upload(deniedGroupPath, new Blob(["denied group media"], { type: "image/jpeg" })),
    "Stored with contact group-media upload",
  );
  await expectStorageDenied(
    storedWithContact.client.rpc("set_supply_image_paths", { target_supply_id: groupSupplyId, supplied_paths: [deniedGroupPath] }),
    "Stored with contact group image-path mutation",
  );
  await expectStorageDenied(
    active.client.storage.from("gear-images").upload(administratorGroupPath, new Blob(["administrator group media"], { type: "image/jpeg" })),
    "Administrator direct final group-media upload",
  );
  await expectSuccess(
    await service.storage.from("gear-images").upload(administratorGroupPath, new Blob(["administrator group media"], { type: "image/jpeg" })),
    "server-created group final object fixture",
  );
  await expectStorageDenied(
    active.client.rpc("set_supply_image_paths", { target_supply_id: groupSupplyId, supplied_paths: [administratorGroupPath] }),
    "Administrator group image-path association without sanitizer receipt",
  );
  process.stdout.write("Group media authority invariant OK: direct final writes denied; Stored with contact path mutation denied; Administrator cannot bypass a sanitizer receipt.\n");

  await expectStorageDenied(anonymous.storage.from("gear-images").download(objectPath), "anonymous authenticated-object download");
  await expectStorageDenied(anonymous.storage.from("gear-images").createSignedUrl(objectPath, 60), "anonymous signed URL creation");
  await expectStorageDenied(pending.client.storage.from("gear-images").download(objectPath), "pending-member download");
  await expectStorageDenied(deactivated.client.storage.from("gear-images").download(objectPath), "deactivated-member download");
  await expectStorageDenied(cross.client.storage.from("gear-images").download(objectPath), "cross-community download");

  await expectSuccess(await active.client.storage.from("gear-images").download(objectPath), "active same-community download");
  const signed = await expectSuccess(
    await active.client.storage.from("gear-images").createSignedUrl(objectPath, 1),
    "active signed URL creation",
  );
  const validResponse = await fetch(signed.signedUrl);
  if (!validResponse.ok || await validResponse.text() !== "local storage fixture") {
    throw new Error(`valid signed URL was not usable: HTTP ${validResponse.status}`);
  }

  const unsignedResponse = await fetch(`${apiUrl}/storage/v1/object/gear-images/${objectPath}`);
  if (unsignedResponse.ok) throw new Error("unsigned private-object request unexpectedly succeeded");

  await new Promise((resolve) => setTimeout(resolve, 2100));
  const expiredResponse = await fetch(signed.signedUrl);
  if (expiredResponse.ok) throw new Error("expired signed URL unexpectedly remained usable");

  process.stdout.write("Storage authorization invariant OK: unsigned, expired, anonymous, pending, deactivated, and cross-community access denied; valid signed URL usable before expiry.\n");
} finally {
  if (objectPath) await service.storage.from("gear-images").remove([objectPath, ...(restorePath ? [restorePath] : []), ...(deniedGroupPath ? [deniedGroupPath] : []), ...(administratorGroupPath ? [administratorGroupPath] : [])]);
  if (supplyId || groupSupplyId) runSql(`delete from public.supplies where id in ('${supplyId}', '${groupSupplyId}');`);
  if (createdUserIds.length > 0) {
    const fixtureIds = createdUserIds.map((userId) => `'${userId}'`).join(", ");
    runSql(`
begin;
alter table public.ses_feedback_events disable trigger ses_feedback_events_protected;
alter table public.notification_delivery_attempts disable trigger notification_delivery_attempts_protected;
alter table public.transactional_email_outbox disable trigger transactional_email_outbox_protected;
alter table public.transactional_email_suppressions disable trigger transactional_email_suppressions_protected;
alter table public.transactional_email_preferences disable trigger transactional_email_preferences_protected;
alter table public.transactional_email_suppression_audit disable trigger transactional_email_suppression_audit_protected;
alter table public.transactional_email_preference_audit disable trigger transactional_email_preference_audit_protected;
alter table public.private_notifications disable trigger private_notifications_protected;
delete from public.ses_feedback_events where outbox_id in (select id from public.transactional_email_outbox where recipient_user_id in (${fixtureIds}));
delete from public.notification_delivery_attempts where outbox_id in (select id from public.transactional_email_outbox where recipient_user_id in (${fixtureIds}));
delete from public.transactional_email_suppressions where recipient_user_id in (${fixtureIds});
delete from public.transactional_email_preferences where profile_id in (${fixtureIds});
delete from public.transactional_email_suppression_audit where recipient_user_id in (${fixtureIds}) or actor_user_id in (${fixtureIds});
delete from public.transactional_email_preference_audit where profile_id in (${fixtureIds}) or actor_user_id in (${fixtureIds});
delete from public.transactional_email_outbox where recipient_user_id in (${fixtureIds});
delete from public.private_notifications where recipient_user_id in (${fixtureIds});
alter table public.ses_feedback_events enable trigger ses_feedback_events_protected;
alter table public.notification_delivery_attempts enable trigger notification_delivery_attempts_protected;
alter table public.transactional_email_outbox enable trigger transactional_email_outbox_protected;
alter table public.transactional_email_suppressions enable trigger transactional_email_suppressions_protected;
alter table public.transactional_email_preferences enable trigger transactional_email_preferences_protected;
alter table public.transactional_email_suppression_audit enable trigger transactional_email_suppression_audit_protected;
alter table public.transactional_email_preference_audit enable trigger transactional_email_preference_audit_protected;
alter table public.private_notifications enable trigger private_notifications_protected;
delete from public.role_audit where target_user_id in (${fixtureIds}) or actor_user_id in (${fixtureIds});
delete from public.community_roles where user_id in (${fixtureIds}) or granted_by in (${fixtureIds});
-- Remove fixture profiles as a set before deleting Auth users. An approved
-- profile may refer to its own Auth user through the intentionally restrictive
-- approval-audit foreign key, which prevents one-at-a-time Auth deletion.
delete from public.profiles where id in (${fixtureIds});
commit;
`);
  }
  for (const userId of createdUserIds.reverse()) {
    await expectSuccess(await service.auth.admin.deleteUser(userId), `delete temporary storage user ${userId}`);
  }
  if (crossCommunityId) runSql(`delete from public.communities where id = '${crossCommunityId}';`);
}
