import { spawn, spawnSync } from "node:child_process";

// Exercises inventory and wanted-request race conditions.

const projectLabel = "community-gear-lending";
const databaseName = process.env.GEAR_SHARE_TEST_DATABASE || "postgres";
const communityId = "ca000000-0000-4000-8000-000000000001";
const adminId = "ca100000-0000-4000-8000-000000000001";
const ownerId = "ca100000-0000-4000-8000-000000000002";
const borrowerId = "ca100000-0000-4000-8000-000000000003";
const supplyId = "ca200000-0000-4000-8000-000000000001";
const requestId = "ca300000-0000-4000-8000-000000000001";
const offerId = "ca400000-0000-4000-8000-000000000001";

const discovery = spawnSync("docker", ["ps", "--filter", `label=com.supabase.cli.project=${projectLabel}`, "--filter", "name=supabase_db_", "--format", "{{.Names}}"], { encoding: "utf8" });
if (discovery.status !== 0) throw new Error(`Unable to inspect local Supabase: ${discovery.stderr.trim()}`);
const containers = discovery.stdout.trim().split("\n").filter(Boolean);
if (containers.length !== 1) throw new Error(`Expected one local gear share database container; found ${containers.length}.`);
const container = containers[0];
const psqlArgs = () => ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", databaseName];
function runSql(sql) {
  const result = spawnSync("docker", psqlArgs(), { input: sql, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`PostgreSQL command failed:\n${result.stderr.trim()}`);
  return result.stdout.trim();
}
function runConcurrentSql(sql) {
  return new Promise((resolve) => {
    const child = spawn("docker", psqlArgs(), { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(sql);
  });
}
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const cleanup = `
begin;
alter table public.notification_delivery_attempts disable trigger notification_delivery_attempts_protected;
alter table public.transactional_email_outbox disable trigger transactional_email_outbox_protected;
alter table public.private_notifications disable trigger private_notifications_protected;
alter table public.supply_guideline_versions disable trigger supply_guideline_versions_immutable;
alter table public.gear_loan_guideline_acceptances disable trigger gear_loan_guideline_acceptances_immutable;
alter table public.wanted_request_moderation_audit disable trigger wanted_request_moderation_audit_immutable;
delete from public.notification_delivery_attempts where outbox_id in (select id from public.transactional_email_outbox where community_id = '${communityId}');
delete from public.transactional_email_outbox where community_id = '${communityId}';
delete from public.private_notifications where community_id = '${communityId}';
delete from public.gear_loan_guideline_acceptances where community_id = '${communityId}';
delete from public.gear_loans where community_id = '${communityId}';
delete from public.wanted_request_moderation_audit where community_id = '${communityId}';
delete from public.wanted_offers where community_id = '${communityId}';
delete from public.wanted_requests where community_id = '${communityId}';
delete from public.supply_guideline_versions where community_id = '${communityId}';
delete from public.supplies where community_id = '${communityId}';
delete from public.community_roles where community_id = '${communityId}';
delete from public.profiles where community_id = '${communityId}';
delete from auth.users where id in ('${adminId}', '${ownerId}', '${borrowerId}');
delete from public.communities where id = '${communityId}';
alter table public.notification_delivery_attempts enable trigger notification_delivery_attempts_protected;
alter table public.transactional_email_outbox enable trigger transactional_email_outbox_protected;
alter table public.private_notifications enable trigger private_notifications_protected;
alter table public.supply_guideline_versions enable trigger supply_guideline_versions_immutable;
alter table public.gear_loan_guideline_acceptances enable trigger gear_loan_guideline_acceptances_immutable;
alter table public.wanted_request_moderation_audit enable trigger wanted_request_moderation_audit_immutable;
commit;`;

try {
  runSql(`${cleanup}
insert into public.communities (id, slug, name) values ('${communityId}', 'inventory-races', 'Inventory Races');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000000', '${adminId}', 'authenticated', 'authenticated', 'inventory-race-admin@example.test', '', now(), now(), now(), '{"display_name":"Inventory Race Administrator"}'),
  ('00000000-0000-0000-0000-000000000000', '${ownerId}', 'authenticated', 'authenticated', 'inventory-race-owner@example.test', '', now(), now(), now(), '{"display_name":"Inventory Race Owner"}'),
  ('00000000-0000-0000-0000-000000000000', '${borrowerId}', 'authenticated', 'authenticated', 'inventory-race-borrower@example.test', '', now(), now(), now(), '{"display_name":"Inventory Race Borrower"}');
alter table public.profiles disable trigger profile_membership_notification;
update public.profiles set community_id = '${communityId}', membership_status = 'active', approved_by = '${adminId}', approved_at = now();
alter table public.profiles enable trigger profile_membership_notification;
insert into public.community_roles (community_id, user_id, role, granted_by) values
  ('${communityId}', '${adminId}', 'member', '${adminId}'), ('${communityId}', '${adminId}', 'steward', '${adminId}'),
  ('${communityId}', '${ownerId}', 'member', '${adminId}'), ('${communityId}', '${borrowerId}', 'member', '${adminId}');
insert into public.supplies (id, community_id, title, description, category, condition, ownership_kind, owner_id, custodian_id, quantity_total, listing_status, created_by)
values ('${supplyId}', '${communityId}', 'Inventory race tent', '', 'tents-shelters', 'good', 'individual', '${ownerId}', '${ownerId}', 2, 'listed', '${ownerId}');
begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${ownerId}', true); select * from public.set_supply_guidelines('${supplyId}', 0, array['Return dry']); commit;
insert into public.wanted_requests (id, community_id, requester_id, title, desired_quantity)
values ('${requestId}', '${communityId}', '${borrowerId}', 'Inventory race request', 1);
insert into public.wanted_offers (id, community_id, request_id, supply_id, offerer_id)
values ('${offerId}', '${communityId}', '${requestId}', '${supplyId}', '${ownerId}');
insert into public.wanted_requests (community_id, requester_id, title, desired_quantity)
select '${communityId}', '${borrowerId}', 'Existing open ' || i, 1 from generate_series(1,8) i;`);

  const createSql = (title) => `begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${borrowerId}', true); select id from public.create_wanted_request('${title}', null, 1, null, null, null); select pg_sleep(0.5); commit;`;
  const firstCreate = runConcurrentSql(createSql("Concurrent tenth A"));
  await delay(80);
  const secondCreate = runConcurrentSql(createSql("Concurrent tenth B"));
  const createResults = await Promise.all([firstCreate, secondCreate]);
  if (createResults.filter((result) => result.status === 0).length !== 1 || createResults.filter((result) => result.stderr.includes("at most ten open wanted requests")).length !== 1) {
    throw new Error(`Wanted open-limit race failed: ${JSON.stringify(createResults)}`);
  }
  const openCount = Number(runSql(`select count(*) from public.wanted_requests where community_id = '${communityId}' and requester_id = '${borrowerId}' and status = 'open';`));
  if (openCount !== 10) throw new Error(`Wanted open-limit evidence failed: ${openCount}`);
  process.stdout.write(`Concurrent wanted creation preserves the ten-open limit: ${openCount}\n`);

  const guidelineEdit = runConcurrentSql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${ownerId}', true); select * from public.set_supply_guidelines('${supplyId}', 1, array['Return clean']); select pg_sleep(0.7); commit;`);
  await delay(80);
  const loanRequest = runConcurrentSql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${borrowerId}', true); select id from public.request_gear_loan('${supplyId}', 1, '2028-06-01', '2028-06-02', null, 1, true); commit;`);
  const [editResult, loanResult] = await Promise.all([guidelineEdit, loanRequest]);
  if (editResult.status !== 0 || loanResult.status === 0 || !loanResult.stderr.includes("current borrowing guidelines must be reviewed and accepted")) {
    throw new Error(`Guideline-versus-loan race failed: ${JSON.stringify({ editResult, loanResult })}`);
  }
  const guidelineEvidence = JSON.parse(runSql(`select json_build_object('version', guideline_version, 'loan_count', (select count(*) from public.gear_loans where community_id = '${communityId}')) from public.supplies where id = '${supplyId}';`));
  if (guidelineEvidence.version !== 2 || guidelineEvidence.loan_count !== 0) throw new Error(`Guideline race evidence failed: ${JSON.stringify(guidelineEvidence)}`);
  process.stdout.write(`Guideline edit makes the concurrent stale loan request fail atomically: ${JSON.stringify(guidelineEvidence)}\n`);

  const unlist = runConcurrentSql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${ownerId}', true); select id from public.update_supply('${supplyId}', 'Inventory race tent', '', 'tents-shelters', 2, 'unlisted', 'good'); select pg_sleep(0.7); commit;`);
  await delay(80);
  const selection = runConcurrentSql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${borrowerId}', true); select id from public.select_wanted_offer('${requestId}', '${offerId}', 1); commit;`);
  const [unlistResult, selectionResult] = await Promise.all([unlist, selection]);
  if (unlistResult.status !== 0 || selectionResult.status === 0 || !selectionResult.stderr.includes("selectable current offer required")) {
    throw new Error(`Selection-versus-unlist race failed: ${JSON.stringify({ unlistResult, selectionResult })}`);
  }
  const selectionEvidence = JSON.parse(runSql(`select json_build_object('request_status', (select status from public.wanted_requests where id = '${requestId}'), 'offer_status', (select status from public.wanted_offers where id = '${offerId}'), 'listing_status', (select listing_status from public.supplies where id = '${supplyId}'));`));
  if (selectionEvidence.request_status !== "open" || selectionEvidence.offer_status !== "invalidated" || selectionEvidence.listing_status !== "unlisted") {
    throw new Error(`Selection race evidence failed: ${JSON.stringify(selectionEvidence)}`);
  }
  process.stdout.write(`Unlisting wins safely over concurrent offer selection: ${JSON.stringify(selectionEvidence)}\n`);
} finally {
  runSql(cleanup);
}
