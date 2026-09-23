import { spawn, spawnSync } from "node:child_process";

const projectLabel = "community-gear-lending";
const databaseName = process.env.GEAR_SHARE_TEST_DATABASE || "postgres";
const communityId = "9c000000-0000-4000-8000-000000000001";
const administratorId = "9c100000-0000-4000-8000-000000000001";
const custodianOneId = "9c100000-0000-4000-8000-000000000002";
const custodianTwoId = "9c100000-0000-4000-8000-000000000003";
const borrowerId = "9c100000-0000-4000-8000-000000000004";
const supplyId = "9c200000-0000-4000-8000-000000000001";
const approvalLoanId = "9c300000-0000-4000-8000-000000000001";
const reminderLoanId = "9c300000-0000-4000-8000-000000000002";
const idempotentLoanId = "9c300000-0000-4000-8000-000000000003";
const handoffLoanId = "9c300000-0000-4000-8000-000000000004";

const discovery = spawnSync("docker", [
  "ps",
  "--filter", `label=com.supabase.cli.project=${projectLabel}`,
  "--filter", "name=supabase_db_",
  "--format", "{{.Names}}",
], { encoding: "utf8" });
if (discovery.status !== 0) throw new Error(`Unable to inspect local Supabase: ${discovery.stderr.trim()}`);
const containers = discovery.stdout.trim().split("\n").filter(Boolean);
if (containers.length !== 1) throw new Error(`Expected one local gear share database container; found ${containers.length}.`);
const container = containers[0];

function psqlArgs() {
  return ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", databaseName];
}

function runSql(sql) {
  const result = spawnSync("docker", psqlArgs(), { input: sql, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`PostgreSQL command failed:\n${result.stderr.trim()}`);
  return result.stdout.trim();
}

function runConcurrentSql(sql) {
  return new Promise((resolve) => {
    const child = spawn("docker", psqlArgs(), { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(sql);
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const cleanup = `
begin;
alter table public.ses_feedback_events disable trigger ses_feedback_events_protected;
alter table public.notification_delivery_attempts disable trigger notification_delivery_attempts_protected;
alter table public.transactional_email_outbox disable trigger transactional_email_outbox_protected;
alter table public.transactional_email_suppressions disable trigger transactional_email_suppressions_protected;
alter table public.transactional_email_preferences disable trigger transactional_email_preferences_protected;
alter table public.transactional_email_suppression_audit disable trigger transactional_email_suppression_audit_protected;
alter table public.transactional_email_preference_audit disable trigger transactional_email_preference_audit_protected;
alter table public.private_notifications disable trigger private_notifications_protected;
delete from public.ses_feedback_events where outbox_id in (select id from public.transactional_email_outbox where community_id = '${communityId}');
delete from public.notification_delivery_attempts where outbox_id in (select id from public.transactional_email_outbox where community_id = '${communityId}');
delete from public.transactional_email_suppressions where community_id = '${communityId}';
delete from public.transactional_email_preferences where community_id = '${communityId}';
delete from public.transactional_email_suppression_audit where community_id = '${communityId}';
delete from public.transactional_email_preference_audit where community_id = '${communityId}';
delete from public.transactional_email_outbox where community_id = '${communityId}';
delete from public.private_notifications where community_id = '${communityId}';
alter table public.ses_feedback_events enable trigger ses_feedback_events_protected;
alter table public.notification_delivery_attempts enable trigger notification_delivery_attempts_protected;
alter table public.transactional_email_outbox enable trigger transactional_email_outbox_protected;
alter table public.transactional_email_suppressions enable trigger transactional_email_suppressions_protected;
alter table public.transactional_email_preferences enable trigger transactional_email_preferences_protected;
alter table public.transactional_email_suppression_audit enable trigger transactional_email_suppression_audit_protected;
alter table public.transactional_email_preference_audit enable trigger transactional_email_preference_audit_protected;
alter table public.private_notifications enable trigger private_notifications_protected;
alter table public.loan_reminder_events disable trigger loan_reminder_events_immutable;
alter table public.loan_handoff_audit disable trigger loan_handoff_audit_immutable;
alter table public.supply_attention_audit disable trigger supply_attention_audit_immutable;
delete from public.loan_reminder_events where community_id = '${communityId}';
delete from public.loan_handoff_audit where community_id = '${communityId}';
delete from public.supply_attention_audit where community_id = '${communityId}';
alter table public.loan_reminder_events enable trigger loan_reminder_events_immutable;
alter table public.loan_handoff_audit enable trigger loan_handoff_audit_immutable;
alter table public.supply_attention_audit enable trigger supply_attention_audit_immutable;
delete from public.loan_reminder_policies where community_id = '${communityId}';
delete from public.gear_loans where community_id = '${communityId}';
delete from public.supplies where community_id = '${communityId}';
delete from public.role_audit where community_id = '${communityId}';
delete from public.community_roles where community_id = '${communityId}';
delete from public.profiles where community_id = '${communityId}';
delete from auth.users where id in ('${administratorId}', '${custodianOneId}', '${custodianTwoId}', '${borrowerId}');
delete from public.communities where id = '${communityId}';
commit;
`;

try {
  runSql(`${cleanup}
insert into public.communities (id, slug, name) values ('${communityId}', 'loan-operation-races', 'Loan Operation Races');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '${administratorId}', 'authenticated', 'authenticated', 'race-admin@example.test', '', now(), now(), now(), '{"display_name":"Race Administrator"}'),
  ('00000000-0000-0000-0000-000000000000', '${custodianOneId}', 'authenticated', 'authenticated', 'race-one@example.test', '', now(), now(), now(), '{"display_name":"Race Custodian One"}'),
  ('00000000-0000-0000-0000-000000000000', '${custodianTwoId}', 'authenticated', 'authenticated', 'race-two@example.test', '', now(), now(), now(), '{"display_name":"Race Custodian Two"}'),
  ('00000000-0000-0000-0000-000000000000', '${borrowerId}', 'authenticated', 'authenticated', 'race-borrower@example.test', '', now(), now(), now(), '{"display_name":"Race Borrower"}');
update public.profiles set community_id = '${communityId}', membership_status = 'active', approved_by = '${administratorId}', approved_at = now()
where id in ('${administratorId}', '${custodianOneId}', '${custodianTwoId}', '${borrowerId}');
insert into public.community_roles (community_id, user_id, role, granted_by)
values
  ('${communityId}', '${administratorId}', 'member', '${administratorId}'),
  ('${communityId}', '${administratorId}', 'steward', '${administratorId}'),
  ('${communityId}', '${custodianOneId}', 'member', '${administratorId}'),
  ('${communityId}', '${custodianOneId}', 'custodian', '${administratorId}'),
  ('${communityId}', '${custodianTwoId}', 'member', '${administratorId}'),
  ('${communityId}', '${custodianTwoId}', 'custodian', '${administratorId}'),
  ('${communityId}', '${borrowerId}', 'member', '${administratorId}');
insert into public.supplies (id, community_id, title, description, category, condition, ownership_kind, owner_id, custodian_id, quantity_total, listing_status, created_by)
values ('${supplyId}', '${communityId}', 'Race tent', 'Operational race fixture', 'tents-shelters', 'good', 'group', null, '${custodianOneId}', 8, 'listed', '${administratorId}');
insert into public.gear_loans (id, community_id, supply_id, borrower_id, custodian_at_request_id, handoff_contact_id, quantity, start_date, end_date, status, decided_by, decided_at, checked_out_by, checked_out_at)
values
  ('${approvalLoanId}', '${communityId}', '${supplyId}', '${borrowerId}', '${custodianOneId}', null, 1, date '2028-08-01', date '2028-08-02', 'pending', null, null, null, null),
  ('${reminderLoanId}', '${communityId}', '${supplyId}', '${borrowerId}', '${custodianOneId}', '${administratorId}', 1, date '2028-01-01', date '2028-01-02', 'checked_out', '${administratorId}', now(), '${administratorId}', now()),
  ('${idempotentLoanId}', '${communityId}', '${supplyId}', '${borrowerId}', '${custodianOneId}', '${administratorId}', 1, date '2028-01-01', date '2028-01-02', 'checked_out', '${administratorId}', now(), '${administratorId}', now()),
  ('${handoffLoanId}', '${communityId}', '${supplyId}', '${borrowerId}', '${custodianOneId}', '${custodianOneId}', 1, date '2028-09-01', date '2028-09-02', 'approved', '${administratorId}', now(), null, null);
insert into public.loan_reminder_policies (community_id, time_zone, policy_version, enabled, reviewed_at)
values ('${communityId}', 'America/Chicago', 1, true, '2028-01-01 00:00:00+00');
`);

  const holdSession = runConcurrentSql(`
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${administratorId}', true);
select id from public.set_supply_needs_attention('${supplyId}', true, 'Race hold wins');
select pg_sleep(1.5);
commit;
`);
  await delay(100);
  const approvalSession = runConcurrentSql(`
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${administratorId}', true);
select id from public.approve_gear_loan('${approvalLoanId}', '${administratorId}');
commit;
`);
  const [holdResult, approvalResult] = await Promise.all([holdSession, approvalSession]);
  if (holdResult.status !== 0 || approvalResult.status === 0 || !approvalResult.stderr.includes("Needs Attention must be cleared before approval")) {
    throw new Error(`Hold/approval race failed: ${JSON.stringify({ holdResult, approvalResult })}`);
  }
  const holdEvidence = JSON.parse(runSql(`select json_build_object(
    'needs_attention', needs_attention,
    'loan_status', (select status from public.gear_loans where id = '${approvalLoanId}'),
    'audit_count', (select count(*) from public.supply_attention_audit where supply_id = '${supplyId}')
  ) from public.supplies where id = '${supplyId}';`));
  if (!holdEvidence.needs_attention || holdEvidence.loan_status !== "pending" || holdEvidence.audit_count !== 1) {
    throw new Error(`Hold/approval evidence failed: ${JSON.stringify(holdEvidence)}`);
  }
  process.stdout.write(`Concurrent Needs Attention/approval invariant OK: ${JSON.stringify(holdEvidence)}\n`);

  const returnSession = runConcurrentSql(`
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${administratorId}', true);
select id from public.return_gear_loan('${reminderLoanId}');
select pg_sleep(1.5);
commit;
`);
  await delay(100);
  const reminderSession = runConcurrentSql(`begin; select public.enqueue_due_loan_reminders('2028-02-01 12:00:00+00', 500); commit;`);
  const [returnResult, reminderResult] = await Promise.all([returnSession, reminderSession]);
  if (returnResult.status !== 0 || reminderResult.status !== 0) {
    throw new Error(`Return/reminder race execution failed: ${JSON.stringify({ returnResult, reminderResult })}`);
  }
  const returnEvidence = JSON.parse(runSql(`select json_build_object(
    'loan_status', (select status from public.gear_loans where id = '${reminderLoanId}'),
    'reminder_count', (select count(*) from public.loan_reminder_events where loan_id = '${reminderLoanId}')
  );`));
  if (returnEvidence.loan_status !== "returned" || returnEvidence.reminder_count !== 0) {
    throw new Error(`Return/reminder evidence failed: ${JSON.stringify(returnEvidence)}`);
  }
  process.stdout.write(`Concurrent return/reminder invariant OK: ${JSON.stringify(returnEvidence)}\n`);

  const reminderRaceSql = `begin; select public.enqueue_due_loan_reminders('2028-02-01 12:00:00+00', 500); select pg_sleep(0.5); commit;`;
  const reminderRace = await Promise.all([runConcurrentSql(reminderRaceSql), runConcurrentSql(reminderRaceSql)]);
  if (reminderRace.some((result) => result.status !== 0)) throw new Error(`Reminder idempotency race failed: ${JSON.stringify(reminderRace)}`);
  const reminderEvidence = JSON.parse(runSql(`select json_build_object(
    'event_count', count(*), 'recipient_count', count(distinct recipient_user_id),
    'kind_count', count(distinct reminder_kind)
  ) from public.loan_reminder_events where loan_id = '${idempotentLoanId}';`));
  if (reminderEvidence.event_count !== 2 || reminderEvidence.recipient_count !== 2 || reminderEvidence.kind_count !== 1) {
    throw new Error(`Reminder idempotency evidence failed: ${JSON.stringify(reminderEvidence)}`);
  }
  process.stdout.write(`Concurrent reminder idempotency invariant OK: ${JSON.stringify(reminderEvidence)}\n`);

  const handoffSession = (targetId) => `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${custodianOneId}', true);
select id from public.reassign_loan_handoff('${handoffLoanId}', '${targetId}');
select pg_sleep(1.0);
commit;
`;
  const handoffRace = await Promise.all([
    runConcurrentSql(handoffSession(custodianTwoId)),
    runConcurrentSql(handoffSession(administratorId)),
  ]);
  const handoffSucceeded = handoffRace.filter((result) => result.status === 0);
  const handoffRejected = handoffRace.filter((result) => result.status !== 0);
  if (handoffSucceeded.length !== 1 || handoffRejected.length !== 1 || !handoffRejected[0].stderr.includes("active group loan handoff required")) {
    throw new Error(`Handoff reassignment race failed: ${JSON.stringify(handoffRace)}`);
  }
  const handoffEvidence = JSON.parse(runSql(`select json_build_object(
    'handoff_contact_id', handoff_contact_id,
    'audit_count', (select count(*) from public.loan_handoff_audit where loan_id = '${handoffLoanId}')
  ) from public.gear_loans where id = '${handoffLoanId}';`));
  if (![custodianTwoId, administratorId].includes(handoffEvidence.handoff_contact_id) || handoffEvidence.audit_count !== 1) {
    throw new Error(`Handoff reassignment evidence failed: ${JSON.stringify(handoffEvidence)}`);
  }
  process.stdout.write(`Concurrent handoff reassignment invariant OK: ${JSON.stringify(handoffEvidence)}\n`);
} finally {
  runSql(cleanup);
}
