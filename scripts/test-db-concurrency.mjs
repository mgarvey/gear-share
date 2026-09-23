import { spawn, spawnSync } from "node:child_process";

const projectLabel = "community-gear-lending";
const databaseName = process.env.GEAR_SHARE_TEST_DATABASE || "postgres";
const concurrencyCommunityId = "9b000000-0000-4000-8000-000000000001";
const concurrencyCommunitySlug = "concurrency-test-community";
const stewardId = "90000000-0000-4000-8000-000000000001";
const borrowerOneId = "90000000-0000-4000-8000-000000000002";
const borrowerTwoId = "90000000-0000-4000-8000-000000000003";
const successorId = "90000000-0000-4000-8000-000000000004";
const individualOwnerId = "90000000-0000-4000-8000-000000000005";
const requestOwnerId = "90000000-0000-4000-8000-000000000006";
const assignmentTargetId = "90000000-0000-4000-8000-000000000007";
const creationOwnerId = "90000000-0000-4000-8000-000000000008";
const authorityStewardId = "90000000-0000-4000-8000-000000000009";
const transitionOwnerId = "90000000-0000-4000-8000-000000000010";
const roleRaceCustodianId = "90000000-0000-4000-8000-000000000011";
const supplyId = "91000000-0000-4000-8000-000000000001";
const loanOneId = "92000000-0000-4000-8000-000000000001";
const loanTwoId = "92000000-0000-4000-8000-000000000002";
const individualSupplyId = "93000000-0000-4000-8000-000000000001";
const individualLoanId = "94000000-0000-4000-8000-000000000001";
const requestSupplyId = "93000000-0000-4000-8000-000000000002";
const transitionSupplyId = "93000000-0000-4000-8000-000000000003";
const transitionLoanId = "94000000-0000-4000-8000-000000000002";
const roleRaceSupplyId = "93000000-0000-4000-8000-000000000004";
const roleRaceLoanId = "94000000-0000-4000-8000-000000000003";

const discovery = spawnSync("docker", [
  "ps",
  "--filter", `label=com.supabase.cli.project=${projectLabel}`,
  "--filter", "name=supabase_db_",
  "--format", "{{.Names}}",
], { encoding: "utf8" });

if (discovery.status !== 0) {
  throw new Error(`Unable to inspect the local Supabase containers: ${discovery.stderr.trim()}`);
}

const containers = discovery.stdout.trim().split("\n").filter(Boolean);
if (containers.length !== 1) {
  throw new Error(`Expected one running ${projectLabel} database container; found ${containers.length}. Run npm run db:start first.`);
}
const container = containers[0];

function psqlArgs() {
  return ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", databaseName];
}

function runSql(sql) {
  const result = spawnSync("docker", psqlArgs(), { input: sql, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`PostgreSQL command failed:\n${result.stderr.trim()}`);
  }
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

const cleanupSql = `
begin;
alter table public.ses_feedback_events disable trigger ses_feedback_events_protected;
alter table public.notification_delivery_attempts disable trigger notification_delivery_attempts_protected;
alter table public.transactional_email_outbox disable trigger transactional_email_outbox_protected;
alter table public.transactional_email_suppressions disable trigger transactional_email_suppressions_protected;
alter table public.transactional_email_preferences disable trigger transactional_email_preferences_protected;
alter table public.transactional_email_suppression_audit disable trigger transactional_email_suppression_audit_protected;
alter table public.transactional_email_preference_audit disable trigger transactional_email_preference_audit_protected;
alter table public.private_notifications disable trigger private_notifications_protected;
alter table public.membership_reactivation_audit disable trigger reactivation_audit_protected;
alter table public.membership_deactivation_consequences disable trigger deactivation_consequences_protected;
delete from public.ses_feedback_events where outbox_id in (select id from public.transactional_email_outbox where community_id = '${concurrencyCommunityId}');
delete from public.notification_delivery_attempts where outbox_id in (select id from public.transactional_email_outbox where community_id = '${concurrencyCommunityId}');
delete from public.transactional_email_suppressions where community_id = '${concurrencyCommunityId}';
delete from public.transactional_email_preferences where community_id = '${concurrencyCommunityId}';
delete from public.transactional_email_suppression_audit where community_id = '${concurrencyCommunityId}';
delete from public.transactional_email_preference_audit where community_id = '${concurrencyCommunityId}';
delete from public.transactional_email_outbox where community_id = '${concurrencyCommunityId}';
delete from public.private_notifications where community_id = '${concurrencyCommunityId}';
delete from public.membership_reactivation_audit where community_id = '${concurrencyCommunityId}';
delete from public.membership_deactivation_consequences where community_id = '${concurrencyCommunityId}';
alter table public.ses_feedback_events enable trigger ses_feedback_events_protected;
alter table public.notification_delivery_attempts enable trigger notification_delivery_attempts_protected;
alter table public.transactional_email_outbox enable trigger transactional_email_outbox_protected;
alter table public.transactional_email_suppressions enable trigger transactional_email_suppressions_protected;
alter table public.transactional_email_preferences enable trigger transactional_email_preferences_protected;
alter table public.transactional_email_suppression_audit enable trigger transactional_email_suppression_audit_protected;
alter table public.transactional_email_preference_audit enable trigger transactional_email_preference_audit_protected;
alter table public.private_notifications enable trigger private_notifications_protected;
alter table public.membership_reactivation_audit enable trigger reactivation_audit_protected;
alter table public.membership_deactivation_consequences enable trigger deactivation_consequences_protected;
delete from public.gear_loans where id in ('${loanOneId}', '${loanTwoId}', '${individualLoanId}', '${transitionLoanId}', '${roleRaceLoanId}')
  or supply_id in ('${supplyId}', '${individualSupplyId}', '${requestSupplyId}', '${transitionSupplyId}', '${roleRaceSupplyId}')
  or supply_id in (select id from public.supplies where title in ('Concurrent assignment stove', 'Concurrent creation tent', 'Stale authority group tent'));
-- This harness runs only against the disposable local stack. Temporarily disable
-- the audit rewrite guard so repeated runs can remove their own scoped fixtures.
alter table public.supply_condition_history disable trigger supply_condition_history_immutable;
delete from public.supply_condition_history
where community_id = '${concurrencyCommunityId}'
   or supply_id in ('${supplyId}', '${individualSupplyId}', '${requestSupplyId}', '${transitionSupplyId}', '${roleRaceSupplyId}')
   or supply_id in (select id from public.supplies where title in ('Concurrent assignment stove', 'Concurrent creation tent', 'Stale authority group tent'));
alter table public.supply_condition_history enable trigger supply_condition_history_immutable;
delete from public.supplies where id in ('${supplyId}', '${individualSupplyId}', '${requestSupplyId}', '${transitionSupplyId}', '${roleRaceSupplyId}') or title in ('Concurrent assignment stove', 'Concurrent creation tent', 'Stale authority group tent');
delete from public.role_audit where target_user_id in ('${stewardId}', '${successorId}', '${authorityStewardId}', '${roleRaceCustodianId}') or actor_user_id in ('${stewardId}', '${successorId}', '${authorityStewardId}', '${roleRaceCustodianId}');
delete from public.profiles where id in ('${stewardId}', '${borrowerOneId}', '${borrowerTwoId}', '${successorId}', '${individualOwnerId}', '${requestOwnerId}', '${assignmentTargetId}', '${creationOwnerId}', '${authorityStewardId}', '${transitionOwnerId}', '${roleRaceCustodianId}');
delete from auth.users where id in ('${stewardId}', '${borrowerOneId}', '${borrowerTwoId}', '${successorId}', '${individualOwnerId}', '${requestOwnerId}', '${assignmentTargetId}', '${creationOwnerId}', '${authorityStewardId}', '${transitionOwnerId}', '${roleRaceCustodianId}');
delete from public.communities where id = '${concurrencyCommunityId}' or slug = '${concurrencyCommunitySlug}';
commit;
`;

try {
  runSql(`${cleanupSql}
insert into public.communities (id, slug, name)
values ('${concurrencyCommunityId}', '${concurrencyCommunitySlug}', 'Concurrency Test Community');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '${stewardId}', 'authenticated', 'authenticated', 'concurrency-administrator@example.test', '', now(), now(), now(), '{"display_name":"Concurrency Administrator"}'),
  ('00000000-0000-0000-0000-000000000000', '${borrowerOneId}', 'authenticated', 'authenticated', 'concurrency-one@example.test', '', now(), now(), now(), '{"display_name":"Concurrency Borrower One"}'),
  ('00000000-0000-0000-0000-000000000000', '${borrowerTwoId}', 'authenticated', 'authenticated', 'concurrency-two@example.test', '', now(), now(), now(), '{"display_name":"Concurrency Borrower Two"}'),
  ('00000000-0000-0000-0000-000000000000', '${successorId}', 'authenticated', 'authenticated', 'concurrency-successor@example.test', '', now(), now(), now(), '{"display_name":"Concurrency Successor"}'),
  ('00000000-0000-0000-0000-000000000000', '${individualOwnerId}', 'authenticated', 'authenticated', 'concurrency-individual@example.test', '', now(), now(), now(), '{"display_name":"Concurrency Individual"}'),
  ('00000000-0000-0000-0000-000000000000', '${requestOwnerId}', 'authenticated', 'authenticated', 'concurrency-request-owner@example.test', '', now(), now(), now(), '{"display_name":"Concurrency Request Owner"}'),
  ('00000000-0000-0000-0000-000000000000', '${assignmentTargetId}', 'authenticated', 'authenticated', 'concurrency-assignment@example.test', '', now(), now(), now(), '{"display_name":"Concurrency Assignment Target"}'),
  ('00000000-0000-0000-0000-000000000000', '${creationOwnerId}', 'authenticated', 'authenticated', 'concurrency-creation@example.test', '', now(), now(), now(), '{"display_name":"Concurrency Creation Owner"}'),
  ('00000000-0000-0000-0000-000000000000', '${authorityStewardId}', 'authenticated', 'authenticated', 'concurrency-authority-administrator@example.test', '', now(), now(), now(), '{"display_name":"Concurrency Authority Administrator"}'),
  ('00000000-0000-0000-0000-000000000000', '${transitionOwnerId}', 'authenticated', 'authenticated', 'concurrency-transition-owner@example.test', '', now(), now(), now(), '{"display_name":"Concurrency Transition Owner"}'),
  ('00000000-0000-0000-0000-000000000000', '${roleRaceCustodianId}', 'authenticated', 'authenticated', 'concurrency-role-custodian@example.test', '', now(), now(), now(), '{"display_name":"Concurrency Role Custodian"}');

update public.profiles
set community_id = '${concurrencyCommunityId}', membership_status = 'active', approved_by = '${stewardId}', approved_at = now()
where id in ('${stewardId}', '${borrowerOneId}', '${borrowerTwoId}', '${successorId}', '${individualOwnerId}', '${requestOwnerId}', '${assignmentTargetId}', '${creationOwnerId}', '${authorityStewardId}', '${transitionOwnerId}', '${roleRaceCustodianId}');

insert into public.community_roles (community_id, user_id, role, granted_by)
select id, '${stewardId}'::uuid, 'member'::public.app_role, '${stewardId}'::uuid from public.communities where slug = '${concurrencyCommunitySlug}'
union all
select id, '${stewardId}'::uuid, 'steward'::public.app_role, '${stewardId}'::uuid from public.communities where slug = '${concurrencyCommunitySlug}';

insert into public.community_roles (community_id, user_id, role, granted_by)
select c.id, fixture.user_id, fixture.role, '${stewardId}'::uuid
from public.communities c
cross join (values
  ('${borrowerOneId}'::uuid, 'member'::public.app_role),
  ('${borrowerTwoId}'::uuid, 'member'::public.app_role),
  ('${successorId}'::uuid, 'member'::public.app_role),
  ('${successorId}'::uuid, 'steward'::public.app_role),
  ('${individualOwnerId}'::uuid, 'member'::public.app_role),
  ('${requestOwnerId}'::uuid, 'member'::public.app_role),
  ('${assignmentTargetId}'::uuid, 'member'::public.app_role),
  ('${creationOwnerId}'::uuid, 'member'::public.app_role),
  ('${authorityStewardId}'::uuid, 'member'::public.app_role),
  ('${authorityStewardId}'::uuid, 'steward'::public.app_role),
  ('${transitionOwnerId}'::uuid, 'member'::public.app_role),
  ('${roleRaceCustodianId}'::uuid, 'member'::public.app_role),
  ('${roleRaceCustodianId}'::uuid, 'custodian'::public.app_role)
) fixture(user_id, role)
where c.slug = '${concurrencyCommunitySlug}';

insert into public.supplies (id, community_id, title, description, category, condition, ownership_kind, owner_id, custodian_id, quantity_total, listing_status, created_by)
select '${supplyId}', id, 'Six concurrency tents', 'True concurrent approval fixture', 'tents-shelters', 'good', 'group', null, '${stewardId}', 6, 'listed', '${stewardId}'
from public.communities where slug = '${concurrencyCommunitySlug}';

insert into public.gear_loans (id, community_id, supply_id, borrower_id, custodian_at_request_id, quantity, start_date, end_date, borrower_note)
select fixture.loan_id, c.id, '${supplyId}', fixture.borrower_id, '${stewardId}', 4, date '2027-08-06', date '2027-08-08', fixture.note
from public.communities c
cross join (values
  ('${loanOneId}'::uuid, '${borrowerOneId}'::uuid, 'concurrency request one'),
  ('${loanTwoId}'::uuid, '${borrowerTwoId}'::uuid, 'concurrency request two')
) fixture(loan_id, borrower_id, note)
where c.slug = '${concurrencyCommunitySlug}';
`);

  const session = (loanId) => `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${stewardId}', true);
select status from public.approve_gear_loan('${loanId}');
select pg_sleep(1.5);
commit;
`;

  const results = await Promise.all([
    runConcurrentSql(session(loanOneId)),
    runConcurrentSql(session(loanTwoId)),
  ]);
  const succeeded = results.filter((result) => result.status === 0);
  const conflicted = results.filter((result) => result.status !== 0);

  if (succeeded.length !== 1 || conflicted.length !== 1) {
    throw new Error(`Expected one approval and one conflict; results were ${JSON.stringify(results)}`);
  }
  if (!conflicted[0].stderr.includes("insufficient date-sensitive availability")) {
    throw new Error(`Losing approval returned an unexpected error: ${conflicted[0].stderr}`);
  }

  const evidence = JSON.parse(runSql(`
select json_build_object(
  'approved_count', count(*) filter (where status = 'approved'),
  'pending_count', count(*) filter (where status = 'pending'),
  'approved_quantity', coalesce(sum(quantity) filter (where status = 'approved'), 0),
  'pending_unchanged', bool_and(
    case when status = 'pending'
      then decided_by is null and decided_at is null and checked_out_by is null and checked_out_at is null
      else true
    end
  )
)
from public.gear_loans
where id in ('${loanOneId}', '${loanTwoId}');
`));

  if (evidence.approved_count !== 1 || evidence.pending_count !== 1 || evidence.approved_quantity !== 4 || evidence.pending_unchanged !== true) {
    throw new Error(`Concurrent approval invariant failed: ${JSON.stringify(evidence)}`);
  }
  process.stdout.write(`Concurrent approval invariant OK: ${JSON.stringify(evidence)}\n`);

  runSql(`
delete from public.gear_loans where id in ('${loanOneId}', '${loanTwoId}');
update public.supplies set quantity_total = 6 where id = '${supplyId}';
insert into public.gear_loans (id, community_id, supply_id, borrower_id, custodian_at_request_id, quantity, start_date, end_date, borrower_note)
select '${loanOneId}', community_id, id, '${borrowerOneId}', '${stewardId}', 4, date '2027-09-03', date '2027-09-05', 'quantity race request'
from public.supplies where id = '${supplyId}';
`);

  const approvalSession = session(loanOneId);
  const reductionSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${stewardId}', true);
select quantity_total from public.update_supply(
  '${supplyId}', 'Six concurrency tents', 'True concurrent approval fixture',
  'tents-shelters', 3, 'listed', 'good'
);
select pg_sleep(1.5);
commit;
`;
  const quantityResults = await Promise.all([
    runConcurrentSql(approvalSession),
    runConcurrentSql(reductionSession),
  ]);
  const quantitySucceeded = quantityResults.filter((result) => result.status === 0);
  const quantityConflicted = quantityResults.filter((result) => result.status !== 0);
  if (quantitySucceeded.length !== 1 || quantityConflicted.length !== 1) {
    throw new Error(`Expected one quantity-race winner and one conflict; results were ${JSON.stringify(quantityResults)}`);
  }
  if (!quantityConflicted[0].stderr.includes("insufficient date-sensitive availability")
      && !quantityConflicted[0].stderr.includes("quantity conflicts with committed loans")) {
    throw new Error(`Quantity race returned an unexpected error: ${quantityConflicted[0].stderr}`);
  }

  const quantityEvidence = JSON.parse(runSql(`
select json_build_object(
  'quantity_total', s.quantity_total,
  'loan_status', gl.status,
  'committed_quantity', case when gl.status in ('approved', 'checked_out') then gl.quantity else 0 end,
  'pending_unchanged', case when gl.status = 'pending' then gl.decided_by is null and gl.decided_at is null else true end
)
from public.supplies s
join public.gear_loans gl on gl.supply_id = s.id
where s.id = '${supplyId}' and gl.id = '${loanOneId}';
`));
  const reductionWon = quantityEvidence.quantity_total === 3 && quantityEvidence.loan_status === "pending";
  const approvalWon = quantityEvidence.quantity_total === 6 && quantityEvidence.loan_status === "approved";
  if ((!reductionWon && !approvalWon)
      || quantityEvidence.committed_quantity > quantityEvidence.quantity_total
      || quantityEvidence.pending_unchanged !== true) {
    throw new Error(`Quantity race invariant failed: ${JSON.stringify(quantityEvidence)}`);
  }
  process.stdout.write(`Concurrent quantity invariant OK: ${JSON.stringify(quantityEvidence)}\n`);

  runSql(`
delete from public.gear_loans where borrower_note = 'request-unlist race';
update public.supplies set listing_status = 'listed' where id = '${supplyId}';
`);
  const requestUnlistSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${borrowerTwoId}', true);
select status from public.request_gear_loan('${supplyId}', 1, date '2028-01-01', date '2028-01-02', 'request-unlist race');
select pg_sleep(1.5);
commit;
`;
  const unlistSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${stewardId}', true);
select listing_status from public.update_supply('${supplyId}', 'Six concurrency tents', 'True concurrent approval fixture', 'tents-shelters', 6, 'unlisted', 'good');
select pg_sleep(1.5);
commit;
`;
  const requestUnlistResults = await Promise.all([runConcurrentSql(requestUnlistSession), runConcurrentSql(unlistSession)]);
  if (requestUnlistResults[1].status !== 0) throw new Error(`Unlist side of request race failed: ${JSON.stringify(requestUnlistResults)}`);
  if (requestUnlistResults[0].status !== 0 && !requestUnlistResults[0].stderr.includes("listing is not available for requests")) {
    throw new Error(`Request side of unlist race returned an unexpected error: ${requestUnlistResults[0].stderr}`);
  }
  const requestUnlistEvidence = JSON.parse(runSql(`select json_build_object(
    'listing_status', (select listing_status from public.supplies where id = '${supplyId}'),
    'request_count', (select count(*) from public.gear_loans where borrower_note = 'request-unlist race')
  );`));
  if (requestUnlistEvidence.listing_status !== "unlisted" || requestUnlistEvidence.request_count > 1) {
    throw new Error(`Request/unlist invariant failed: ${JSON.stringify(requestUnlistEvidence)}`);
  }
  process.stdout.write(`Concurrent request/unlist invariant OK: ${JSON.stringify(requestUnlistEvidence)}\n`);

  runSql(`
insert into public.supplies (id, community_id, title, description, category, condition, ownership_kind, owner_id, custodian_id, quantity_total, listing_status, created_by)
select '${requestSupplyId}', id, 'Request deactivation tent', 'Request/deactivation race fixture', 'tents-shelters', 'good', 'individual', '${requestOwnerId}', '${requestOwnerId}', 1, 'listed', '${requestOwnerId}'
from public.communities where slug = '${concurrencyCommunitySlug}';
`);
  const requestDeactivationSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${borrowerTwoId}', true);
select status from public.request_gear_loan('${requestSupplyId}', 1, date '2028-02-01', date '2028-02-02', 'request-deactivation race');
select pg_sleep(1.5);
commit;
`;
  const requestOwnerDeactivationSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${stewardId}', true);
select public.deactivate_member('${requestOwnerId}', '${successorId}');
select pg_sleep(1.5);
commit;
`;
  const requestDeactivationResults = await Promise.all([runConcurrentSql(requestDeactivationSession), runConcurrentSql(requestOwnerDeactivationSession)]);
  if (requestDeactivationResults[1].status !== 0) throw new Error(`Deactivation side of request race failed: ${JSON.stringify(requestDeactivationResults)}`);
  if (requestDeactivationResults[0].status !== 0
      && !requestDeactivationResults[0].stderr.includes("listing is not available for requests")
      && !requestDeactivationResults[0].stderr.includes("inactive-owner individual gear cannot accept requests")) {
    throw new Error(`Request side of deactivation race returned an unexpected error: ${requestDeactivationResults[0].stderr}`);
  }
  const requestDeactivationEvidence = JSON.parse(runSql(`select json_build_object(
    'membership_status', (select membership_status from public.profiles where id = '${requestOwnerId}'),
    'listing_status', (select listing_status from public.supplies where id = '${requestSupplyId}'),
    'open_requests', (select count(*) from public.gear_loans where supply_id = '${requestSupplyId}' and status in ('pending', 'approved'))
  );`));
  if (requestDeactivationEvidence.membership_status !== "deactivated"
      || requestDeactivationEvidence.listing_status !== "unlisted"
      || requestDeactivationEvidence.open_requests !== 0) {
    throw new Error(`Request/deactivation invariant failed: ${JSON.stringify(requestDeactivationEvidence)}`);
  }
  process.stdout.write(`Concurrent request/deactivation invariant OK: ${JSON.stringify(requestDeactivationEvidence)}\n`);

  const assignmentSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${stewardId}', true);
select id from public.create_group_supply('Concurrent assignment stove', 'Assignment/deactivation fixture', 'camp-kitchen', 1, '${assignmentTargetId}', 'listed', 'good');
select pg_sleep(1.5);
commit;
`;
  const assignmentDeactivationSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${stewardId}', true);
select public.deactivate_member('${assignmentTargetId}', '${successorId}');
select pg_sleep(1.5);
commit;
`;
  const assignmentResults = await Promise.all([runConcurrentSql(assignmentSession), runConcurrentSql(assignmentDeactivationSession)]);
  if (assignmentResults[1].status !== 0) throw new Error(`Deactivation side of assignment race failed: ${JSON.stringify(assignmentResults)}`);
  if (assignmentResults[0].status !== 0 && !assignmentResults[0].stderr.includes("active same-community contact required")) {
    throw new Error(`Assignment side of deactivation race returned an unexpected error: ${assignmentResults[0].stderr}`);
  }
  const assignmentEvidence = JSON.parse(runSql(`select json_build_object(
    'membership_status', (select membership_status from public.profiles where id = '${assignmentTargetId}'),
    'inactive_contact_count', (select count(*) from public.supplies where custodian_id = '${assignmentTargetId}')
  );`));
  if (assignmentEvidence.membership_status !== "deactivated" || assignmentEvidence.inactive_contact_count !== 0) {
    throw new Error(`Stored with assignment/deactivation invariant failed: ${JSON.stringify(assignmentEvidence)}`);
  }
  process.stdout.write(`Concurrent Stored with assignment invariant OK: ${JSON.stringify(assignmentEvidence)}\n`);

  const creationSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${creationOwnerId}', true);
select id from public.create_individual_supply('Concurrent creation tent', 'Creation/deactivation fixture', 'tents-shelters', 1, 'listed', 'good');
select pg_sleep(1.5);
commit;
`;
  const creationDeactivationSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${stewardId}', true);
select public.deactivate_member('${creationOwnerId}', '${successorId}');
select pg_sleep(1.5);
commit;
`;
  const creationResults = await Promise.all([runConcurrentSql(creationSession), runConcurrentSql(creationDeactivationSession)]);
  if (creationResults[1].status !== 0) throw new Error(`Deactivation side of creation race failed: ${JSON.stringify(creationResults)}`);
  if (creationResults[0].status !== 0 && !creationResults[0].stderr.includes("active member required")) {
    throw new Error(`Creation side of deactivation race returned an unexpected error: ${creationResults[0].stderr}`);
  }
  const creationEvidence = JSON.parse(runSql(`select json_build_object(
    'membership_status', (select membership_status from public.profiles where id = '${creationOwnerId}'),
    'created_count', (select count(*) from public.supplies where owner_id = '${creationOwnerId}'),
    'listed_count', (select count(*) from public.supplies where owner_id = '${creationOwnerId}' and listing_status = 'listed'),
    'successor_contact_count', (select count(*) from public.supplies where owner_id = '${creationOwnerId}' and custodian_id = '${successorId}')
  );`));
  if (creationEvidence.membership_status !== "deactivated"
      || creationEvidence.listed_count !== 0
      || creationEvidence.successor_contact_count !== creationEvidence.created_count) {
    throw new Error(`Individual creation/deactivation invariant failed: ${JSON.stringify(creationEvidence)}`);
  }
  process.stdout.write(`Concurrent individual-creation invariant OK: ${JSON.stringify(creationEvidence)}\n`);

  runSql(`
insert into public.supplies (id, community_id, title, description, category, condition, ownership_kind, owner_id, custodian_id, quantity_total, listing_status, created_by)
select '${individualSupplyId}', id, 'Concurrent individual stove', 'Deactivation race fixture', 'camp-kitchen', 'good', 'individual', '${individualOwnerId}', '${individualOwnerId}', 1, 'listed', '${individualOwnerId}'
from public.communities where slug = '${concurrencyCommunitySlug}';
insert into public.gear_loans (id, community_id, supply_id, borrower_id, custodian_at_request_id, quantity, start_date, end_date, borrower_note)
select '${individualLoanId}', community_id, id, '${borrowerOneId}', '${individualOwnerId}', 1, date '2027-10-01', date '2027-10-03', 'deactivation race request'
from public.supplies where id = '${individualSupplyId}';
`);

  const individualApprovalSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${individualOwnerId}', true);
select status from public.approve_gear_loan('${individualLoanId}');
select pg_sleep(1.5);
commit;
`;
  const deactivationSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${stewardId}', true);
select public.deactivate_member('${individualOwnerId}', '${successorId}');
select pg_sleep(1.5);
commit;
`;
  const deactivationResults = await Promise.all([
    runConcurrentSql(individualApprovalSession),
    runConcurrentSql(deactivationSession),
  ]);
  if (deactivationResults[1].status !== 0) {
    throw new Error(`Deactivation side of the race failed: ${JSON.stringify(deactivationResults)}`);
  }
  if (deactivationResults[0].status !== 0
      && !deactivationResults[0].stderr.includes("request is no longer pending")
      && !deactivationResults[0].stderr.includes("current authorized manager required")) {
    throw new Error(`Approval side of deactivation race returned an unexpected error: ${deactivationResults[0].stderr}`);
  }
  const deactivationEvidence = JSON.parse(runSql(`
select json_build_object(
  'membership_status', p.membership_status,
  'listing_status', s.listing_status,
  'owner_preserved', s.owner_id = '${individualOwnerId}',
  'successor_contact', s.custodian_id = '${successorId}',
  'loan_status', gl.status,
  'cancellation_reason', gl.cancellation_reason,
  'no_approved_individual_loan', not exists (
    select 1 from public.gear_loans x where x.supply_id = s.id and x.status = 'approved'
  )
)
from public.profiles p
join public.supplies s on s.owner_id = p.id
join public.gear_loans gl on gl.supply_id = s.id
where p.id = '${individualOwnerId}' and s.id = '${individualSupplyId}' and gl.id = '${individualLoanId}';
`));
  if (deactivationEvidence.membership_status !== "deactivated"
      || deactivationEvidence.listing_status !== "unlisted"
      || deactivationEvidence.owner_preserved !== true
      || deactivationEvidence.successor_contact !== true
      || deactivationEvidence.loan_status !== "cancelled"
      || deactivationEvidence.cancellation_reason !== "owner membership deactivated"
      || deactivationEvidence.no_approved_individual_loan !== true) {
    throw new Error(`Deactivation race invariant failed: ${JSON.stringify(deactivationEvidence)}`);
  }
  process.stdout.write(`Concurrent deactivation invariant OK: ${JSON.stringify(deactivationEvidence)}\n`);

  runSql(`
insert into public.supplies (id, community_id, title, description, category, condition, ownership_kind, owner_id, custodian_id, quantity_total, listing_status, created_by)
select '${roleRaceSupplyId}', id, 'Custodian role-race tent', 'Role-removal serialization fixture',
  'tents-shelters', 'good', 'group', null, '${borrowerOneId}', 1, 'listed', '${stewardId}'
from public.communities where slug = '${concurrencyCommunitySlug}';
insert into public.gear_loans (
  id, community_id, supply_id, borrower_id, custodian_at_request_id, quantity,
  start_date, end_date, status, borrower_note
)
select '${roleRaceLoanId}', community_id, id, '${borrowerTwoId}', '${borrowerOneId}', 1,
  date '2028-04-01', date '2028-04-02', 'pending', 'custodian-role-removal race'
from public.supplies where id = '${roleRaceSupplyId}';
`);
  const custodianApprovalSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${roleRaceCustodianId}', true);
select status from public.approve_gear_loan('${roleRaceLoanId}');
select pg_sleep(1.5);
commit;
`;
  const custodianRemovalSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${stewardId}', true);
select public.set_access_level('${roleRaceCustodianId}', 'member');
select pg_sleep(1.5);
commit;
`;
  const custodianRoleResults = await Promise.all([
    runConcurrentSql(custodianApprovalSession),
    runConcurrentSql(custodianRemovalSession),
  ]);
  if (custodianRoleResults[1].status !== 0) {
    throw new Error(`Custodian role removal failed: ${JSON.stringify(custodianRoleResults)}`);
  }
  if (custodianRoleResults[0].status !== 0
      && !custodianRoleResults[0].stderr.includes("current authorized manager required")) {
    throw new Error(`Custodian approval after role removal returned an unexpected error: ${custodianRoleResults[0].stderr}`);
  }
  const custodianRoleEvidence = JSON.parse(runSql(`select json_build_object(
    'custodian_role_count', (select count(*) from public.community_roles where user_id = '${roleRaceCustodianId}' and role = 'custodian'),
    'loan_status', (select status from public.gear_loans where id = '${roleRaceLoanId}'),
    'decided_by_removed_custodian', coalesce((select decided_by = '${roleRaceCustodianId}' from public.gear_loans where id = '${roleRaceLoanId}'), false)
  );`));
  const approvalCommittedBeforeRoleRemoval = custodianRoleResults[0].status === 0
    && custodianRoleEvidence.loan_status === "approved"
    && custodianRoleEvidence.decided_by_removed_custodian === true;
  const approvalRejectedAfterRoleRemoval = custodianRoleResults[0].status !== 0
    && custodianRoleEvidence.loan_status === "pending"
    && custodianRoleEvidence.decided_by_removed_custodian === false;
  if (custodianRoleEvidence.custodian_role_count !== 0
      || (!approvalCommittedBeforeRoleRemoval && !approvalRejectedAfterRoleRemoval)) {
    throw new Error(`Custodian role-removal invariant failed: ${JSON.stringify({ custodianRoleResults, custodianRoleEvidence })}`);
  }
  process.stdout.write(`Concurrent Custodian role-removal invariant OK: ${JSON.stringify(custodianRoleEvidence)}\n`);

  const staleAdministratorMutationSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${authorityStewardId}', true);
select id from public.create_group_supply(
  'Stale authority group tent', 'Actor deactivation serialization fixture',
  'tents-shelters', 1, '${borrowerOneId}', 'listed', 'good'
);
select pg_sleep(1.5);
commit;
`;
  const staleAdministratorDeactivationSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${stewardId}', true);
select public.deactivate_member('${authorityStewardId}', '${successorId}');
select pg_sleep(1.5);
commit;
`;
  const staleAdministratorResults = await Promise.all([
    runConcurrentSql(staleAdministratorMutationSession),
    runConcurrentSql(staleAdministratorDeactivationSession),
  ]);
  if (staleAdministratorResults[1].status !== 0) {
    throw new Error(`Acting-Administrator deactivation failed: ${JSON.stringify(staleAdministratorResults)}`);
  }
  if (staleAdministratorResults[0].status !== 0 && !staleAdministratorResults[0].stderr.includes("active inventory manager required")) {
    throw new Error(`Stale Administrator mutation returned an unexpected error: ${staleAdministratorResults[0].stderr}`);
  }
  const staleAdministratorEvidence = JSON.parse(runSql(`select json_build_object(
    'membership_status', (select membership_status from public.profiles where id = '${authorityStewardId}'),
    'administrator_role_count', (select count(*) from public.community_roles where user_id = '${authorityStewardId}' and role = 'steward'),
    'created_count', (select count(*) from public.supplies where title = 'Stale authority group tent')
  );`));
  const mutationCommittedBeforeRemoval = staleAdministratorResults[0].status === 0 && staleAdministratorEvidence.created_count === 1;
  const mutationRejectedAfterRemoval = staleAdministratorResults[0].status !== 0 && staleAdministratorEvidence.created_count === 0;
  if (staleAdministratorEvidence.membership_status !== "deactivated"
      || staleAdministratorEvidence.administrator_role_count !== 0
      || (!mutationCommittedBeforeRemoval && !mutationRejectedAfterRemoval)) {
    throw new Error(`Acting-Administrator authorization invariant failed: ${JSON.stringify({ staleAdministratorResults, staleAdministratorEvidence })}`);
  }
  process.stdout.write(`Concurrent acting-Administrator invariant OK: ${JSON.stringify(staleAdministratorEvidence)}\n`);

  runSql(`
insert into public.supplies (id, community_id, title, description, category, condition, ownership_kind, owner_id, custodian_id, quantity_total, listing_status, created_by)
select '${transitionSupplyId}', id, 'Transition authority stove', 'Return/deactivation serialization fixture',
  'camp-kitchen', 'good', 'individual', '${transitionOwnerId}', '${transitionOwnerId}', 1, 'listed', '${transitionOwnerId}'
from public.communities where slug = '${concurrencyCommunitySlug}';
insert into public.gear_loans (
  id, community_id, supply_id, borrower_id, custodian_at_request_id, quantity,
  start_date, end_date, status, borrower_note, decided_by, decided_at, checked_out_by, checked_out_at
)
select '${transitionLoanId}', community_id, id, '${borrowerTwoId}', '${transitionOwnerId}', 1,
  date '2028-03-01', date '2028-03-03', 'checked_out', 'return-deactivation race',
  '${transitionOwnerId}', now(), '${transitionOwnerId}', now()
from public.supplies where id = '${transitionSupplyId}';
`);
  const returnSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${transitionOwnerId}', true);
select status from public.return_gear_loan('${transitionLoanId}');
select pg_sleep(1.5);
commit;
`;
  const transitionDeactivationSession = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${stewardId}', true);
select public.deactivate_member('${transitionOwnerId}', '${successorId}');
select pg_sleep(1.5);
commit;
`;
  const transitionResults = await Promise.all([
    runConcurrentSql(returnSession),
    runConcurrentSql(transitionDeactivationSession),
  ]);
  if (transitionResults[1].status !== 0) {
    throw new Error(`Transition-actor deactivation failed: ${JSON.stringify(transitionResults)}`);
  }
  if (transitionResults[0].status !== 0
      && !transitionResults[0].stderr.includes("checked-out loan and current authorized manager required")) {
    throw new Error(`Return side of actor-deactivation race returned an unexpected error: ${transitionResults[0].stderr}`);
  }
  const transitionAuthorityEvidence = JSON.parse(runSql(`select json_build_object(
    'membership_status', p.membership_status,
    'listing_status', s.listing_status,
    'successor_contact', s.custodian_id = '${successorId}',
    'loan_status', gl.status,
    'returned_by_former_owner', coalesce(gl.returned_by = '${transitionOwnerId}', false)
  )
  from public.profiles p
  join public.supplies s on s.owner_id = p.id
  join public.gear_loans gl on gl.supply_id = s.id
  where p.id = '${transitionOwnerId}' and s.id = '${transitionSupplyId}' and gl.id = '${transitionLoanId}';`));
  const returnCommittedBeforeRemoval = transitionResults[0].status === 0
    && transitionAuthorityEvidence.loan_status === "returned"
    && transitionAuthorityEvidence.returned_by_former_owner === true;
  const returnRejectedAfterRemoval = transitionResults[0].status !== 0
    && transitionAuthorityEvidence.loan_status === "checked_out"
    && transitionAuthorityEvidence.returned_by_former_owner === false;
  if (transitionAuthorityEvidence.membership_status !== "deactivated"
      || transitionAuthorityEvidence.listing_status !== "unlisted"
      || transitionAuthorityEvidence.successor_contact !== true
      || (!returnCommittedBeforeRemoval && !returnRejectedAfterRemoval)) {
    throw new Error(`Transition authorization invariant failed: ${JSON.stringify({ transitionResults, transitionAuthorityEvidence })}`);
  }
  process.stdout.write(`Concurrent transition-authorization invariant OK: ${JSON.stringify(transitionAuthorityEvidence)}\n`);

  const demotionSession = (actorId) => `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${actorId}', true);
select public.set_steward('${actorId}', false);
select pg_sleep(1.5);
commit;
`;
  const demotionResults = await Promise.all([
    runConcurrentSql(demotionSession(stewardId)),
    runConcurrentSql(demotionSession(successorId)),
  ]);
  const demotionSucceeded = demotionResults.filter((result) => result.status === 0);
  const demotionConflicted = demotionResults.filter((result) => result.status !== 0);
  if (demotionSucceeded.length !== 1 || demotionConflicted.length !== 1
      || !demotionConflicted[0].stderr.includes("cannot remove the last active administrator")) {
    throw new Error(`Concurrent Administrator demotion invariant failed: ${JSON.stringify(demotionResults)}`);
  }
  const remainingAdministrators = Number(runSql(`
select count(*)
from public.community_roles r
join public.profiles p on p.id = r.user_id and p.community_id = r.community_id
where r.role = 'steward' and p.membership_status = 'active'
  and r.user_id in ('${stewardId}', '${successorId}');
`));
  if (remainingAdministrators !== 1) {
    throw new Error(`Expected exactly one active Administrator after concurrent demotions; found ${remainingAdministrators}`);
  }
  process.stdout.write(`Concurrent last-Administrator invariant OK: ${JSON.stringify({ remaining_administrators: remainingAdministrators })}\n`);
} finally {
  runSql(cleanupSql);
}
