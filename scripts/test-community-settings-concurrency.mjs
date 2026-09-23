import { spawn, spawnSync } from "node:child_process";

// Exercises community settings and membership lifecycle race conditions.

const projectLabel = "community-gear-lending";
const databaseName = process.env.GEAR_SHARE_TEST_DATABASE || "postgres";
const communityId = "9e000000-0000-4000-8000-000000000001";
const adminId = "9e100000-0000-4000-8000-000000000001";
const targetId = "9e100000-0000-4000-8000-000000000002";
const successorId = "9e100000-0000-4000-8000-000000000003";
const otherId = "9e100000-0000-4000-8000-000000000004";
const supplyId = "9e200000-0000-4000-8000-000000000001";

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
alter table public.membership_reactivation_audit disable trigger reactivation_audit_protected;
alter table public.membership_deactivation_consequences disable trigger deactivation_consequences_protected;
alter table public.community_settings disable trigger community_settings_protected;
alter table public.administrator_ai_setting_audit disable trigger administrator_ai_setting_audit_protected;
alter table public.community_setting_versions disable trigger community_setting_versions_protected;
delete from public.notification_delivery_attempts where outbox_id in (select id from public.transactional_email_outbox where community_id = '${communityId}');
delete from public.transactional_email_outbox where community_id = '${communityId}';
delete from public.private_notifications where community_id = '${communityId}';
delete from public.membership_reactivation_audit where community_id = '${communityId}';
delete from public.membership_deactivation_consequences where community_id = '${communityId}';
delete from public.administrator_ai_setting_audit where community_id = '${communityId}';
delete from public.community_settings where community_id = '${communityId}';
delete from public.community_setting_versions where community_id = '${communityId}';
alter table public.notification_delivery_attempts enable trigger notification_delivery_attempts_protected;
alter table public.transactional_email_outbox enable trigger transactional_email_outbox_protected;
alter table public.private_notifications enable trigger private_notifications_protected;
alter table public.membership_reactivation_audit enable trigger reactivation_audit_protected;
alter table public.membership_deactivation_consequences enable trigger deactivation_consequences_protected;
alter table public.community_settings enable trigger community_settings_protected;
alter table public.administrator_ai_setting_audit enable trigger administrator_ai_setting_audit_protected;
alter table public.community_setting_versions enable trigger community_setting_versions_protected;
delete from public.supply_donation_audit where community_id = '${communityId}';
delete from public.supplies where community_id = '${communityId}';
delete from public.role_audit where community_id = '${communityId}';
delete from public.community_roles where community_id = '${communityId}';
delete from public.profiles where community_id = '${communityId}';
delete from auth.users where id in ('${adminId}', '${targetId}', '${successorId}', '${otherId}');
delete from public.communities where id = '${communityId}';
commit;`;

try {
  runSql(`${cleanup}
insert into public.communities (id, slug, name) values ('${communityId}', 'settings-races', 'Settings Races');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '${adminId}', 'authenticated', 'authenticated', 'settings-race-admin@example.test', '', now(), now(), now(), '{"display_name":"M6 Race Administrator"}'),
  ('00000000-0000-0000-0000-000000000000', '${targetId}', 'authenticated', 'authenticated', 'settings-race-target@example.test', '', now(), now(), now(), '{"display_name":"M6 Race Target"}'),
  ('00000000-0000-0000-0000-000000000000', '${successorId}', 'authenticated', 'authenticated', 'settings-race-successor@example.test', '', now(), now(), now(), '{"display_name":"M6 Race Successor"}'),
  ('00000000-0000-0000-0000-000000000000', '${otherId}', 'authenticated', 'authenticated', 'settings-race-other@example.test', '', now(), now(), now(), '{"display_name":"M6 Race Other"}');
alter table public.profiles disable trigger profile_membership_notification;
update public.profiles set community_id = '${communityId}', membership_status = 'active', approved_by = '${adminId}', approved_at = now() where id in ('${adminId}', '${targetId}', '${successorId}', '${otherId}');
alter table public.profiles enable trigger profile_membership_notification;
insert into public.community_roles (community_id, user_id, role, granted_by)
values
  ('${communityId}', '${adminId}', 'member', '${adminId}'), ('${communityId}', '${adminId}', 'steward', '${adminId}'),
  ('${communityId}', '${targetId}', 'member', '${adminId}'), ('${communityId}', '${successorId}', 'member', '${adminId}'),
  ('${communityId}', '${otherId}', 'member', '${adminId}');
begin;
select set_config('app.milestone_six_internal_change', 'allowed', true);
insert into public.community_setting_versions (community_id, version, display_name, ai_drafting_enabled, operator_identifier) values ('${communityId}', 1, 'Settings Races', false, 'community-settings-migration');
insert into public.community_settings (community_id, current_version, display_name, ai_drafting_enabled) values ('${communityId}', 1, 'Settings Races', false);
commit;`);

  const rename = (name) => `begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${adminId}', true); select display_name from public.update_community_display_name('${name}', 1); select pg_sleep(0.7); commit;`;
  const firstRename = runConcurrentSql(rename("Settings First Name"));
  await delay(100);
  const secondRename = runConcurrentSql(rename("Settings Second Name"));
  const renameResults = await Promise.all([firstRename, secondRename]);
  if (renameResults.filter((result) => result.status === 0).length !== 1 || renameResults.filter((result) => result.stderr.includes("community settings changed; reload before saving")).length !== 1) {
    throw new Error(`Concurrent settings version guard failed: ${JSON.stringify(renameResults)}`);
  }
  const settingsEvidence = JSON.parse(runSql(`select json_build_object('version', current_version, 'name', display_name, 'version_rows', (select count(*) from public.community_setting_versions where community_id = '${communityId}')) from public.community_settings where community_id = '${communityId}';`));
  if (settingsEvidence.version !== 2 || settingsEvidence.version_rows !== 2) throw new Error(`Settings version evidence failed: ${JSON.stringify(settingsEvidence)}`);
  process.stdout.write(`Concurrent settings updates serialize with one accepted version: ${JSON.stringify(settingsEvidence)}\n`);

  const nullVersionAttempt = await runConcurrentSql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${adminId}', true); select display_name from public.update_community_display_name('Settings Null Bypass', null); commit;`);
  if (nullVersionAttempt.status === 0 || !nullVersionAttempt.stderr.includes("positive expected settings version required")) {
    throw new Error(`NULL settings-version bypass was not rejected: ${JSON.stringify(nullVersionAttempt)}`);
  }
  const nullVersionEvidence = JSON.parse(runSql(`select json_build_object('version', current_version, 'name', display_name, 'version_rows', (select count(*) from public.community_setting_versions where community_id = '${communityId}')) from public.community_settings where community_id = '${communityId}';`));
  if (nullVersionEvidence.version !== 2 || nullVersionEvidence.version_rows !== 2 || nullVersionEvidence.name === "Settings Null Bypass") {
    throw new Error(`NULL settings-version attempt mutated state: ${JSON.stringify(nullVersionEvidence)}`);
  }
  process.stdout.write(`NULL cannot bypass the settings concurrency guard: ${JSON.stringify(nullVersionEvidence)}\n`);

  runSql(`
insert into public.supplies (id, community_id, title, description, category, condition, ownership_kind, owner_id, custodian_id, quantity_total, listing_status, created_by)
values ('${supplyId}', '${communityId}', 'Settings race pack', '', 'packs-storage', 'good', 'individual', '${targetId}', '${targetId}', 1, 'listed', '${targetId}');
begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${adminId}', true); select public.deactivate_member('${targetId}', '${successorId}'); commit;`);
  const preview = runSql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${adminId}', true); select preview_version from public.reactivation_impact('${targetId}'); commit;`).split("\n").at(-1);
  const authorityChange = runConcurrentSql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${adminId}', true); select id from public.convert_individual_donation('${supplyId}', '${otherId}'); select pg_sleep(0.8); commit;`);
  await delay(100);
  const reactivation = runConcurrentSql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${adminId}', true); select public.reactivate_member('${targetId}', '${preview}', 'Reviewed before concurrent reassignment'); commit;`);
  const [authorityResult, reactivationResult] = await Promise.all([authorityChange, reactivation]);
  if (authorityResult.status !== 0 || reactivationResult.status === 0 || !reactivationResult.stderr.includes("reactivation impact changed; reload before confirming")) {
    throw new Error(`Reactivation stale-impact race failed: ${JSON.stringify({ authorityResult, reactivationResult })}`);
  }
  const reactivationEvidence = JSON.parse(runSql(`select json_build_object(
    'membership_status', (select membership_status from public.profiles where id = '${targetId}'),
    'custodian_id', (select custodian_id from public.supplies where id = '${supplyId}'),
    'ownership_kind', (select ownership_kind from public.supplies where id = '${supplyId}'),
    'audit_count', (select count(*) from public.membership_reactivation_audit where profile_id = '${targetId}'),
    'reactivation_notice_count', (select count(*) from public.private_notifications where recipient_user_id = '${targetId}' and event_type = 'membership_reactivated')
  );`));
  if (reactivationEvidence.membership_status !== "deactivated" || reactivationEvidence.custodian_id !== otherId || reactivationEvidence.ownership_kind !== "group" || reactivationEvidence.audit_count !== 0 || reactivationEvidence.reactivation_notice_count !== 0) {
    throw new Error(`Reactivation race evidence failed: ${JSON.stringify(reactivationEvidence)}`);
  }
  process.stdout.write(`Concurrent authority change invalidates reactivation preview atomically: ${JSON.stringify(reactivationEvidence)}\n`);
} finally {
  runSql(cleanup);
}
