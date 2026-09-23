import { spawn, spawnSync } from "node:child_process";

const projectLabel = "community-gear-lending";
const databaseName = process.env.GEAR_SHARE_TEST_DATABASE || "postgres";
const communityId = "9d000000-0000-4000-8000-000000000001";
const memberId = "9d100000-0000-4000-8000-000000000001";
const secondMemberId = "9d100000-0000-4000-8000-000000000002";
const feedbackRaceMemberId = "9d100000-0000-4000-8000-000000000003";
const workerOne = "9d200000-0000-4000-8000-000000000001";
const workerTwo = "9d200000-0000-4000-8000-000000000002";

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
delete from public.community_roles where community_id = '${communityId}';
delete from public.profiles where community_id = '${communityId}';
delete from auth.users where id in ('${memberId}', '${secondMemberId}', '${feedbackRaceMemberId}');
delete from public.communities where id = '${communityId}';
commit;`;

try {
  runSql(`${cleanup}
insert into public.communities (id, slug, name) values ('${communityId}', 'notification-races', 'Notification Races');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000', '${memberId}', 'authenticated', 'authenticated', 'notification-race@example.test', '', now(), now(), now(), '{"display_name":"Notification Race Member"}');
update public.profiles set community_id = '${communityId}', membership_status = 'active', approved_by = '${memberId}', approved_at = now() where id = '${memberId}';`);
  runSql(`insert into public.community_roles (community_id, user_id, role, granted_by) values ('${communityId}', '${memberId}', 'member', '${memberId}'), ('${communityId}', '${memberId}', 'steward', '${memberId}');`);

  const claim = (worker) => `begin; select concat(outbox_id, '|', claim_token) from public.claim_transactional_notifications('${worker}', 1); select pg_sleep(0.6); commit;`;
  const claims = await Promise.all([runConcurrentSql(claim(workerOne)), runConcurrentSql(claim(workerTwo))]);
  if (claims.some((result) => result.status !== 0)) throw new Error(`Concurrent claims failed: ${JSON.stringify(claims)}`);
  const claimedRows = claims.flatMap((result) => result.stdout.split("\n").filter((line) => line.includes("|")));
  if (claimedRows.length !== 1) throw new Error(`Expected exactly one claim: ${JSON.stringify(claims)}`);
  const [outboxId, claimToken] = claimedRows[0].split("|");
  runSql(`select public.complete_transactional_notification_delivery('${outboxId}', '${claimToken}', 'delivered', 'ses-race-message', null);`);
  const feedback = `select public.apply_verified_ses_feedback('arn:aws:sns:us-east-1:123456789012:gear-share', 'sns-race-message', 'complaint', 'ses-race-message', 'notification-race@example.test', (select delivery_tag from public.transactional_email_outbox where id = '${outboxId}'), clock_timestamp());`;
  const feedbackResults = await Promise.all([runConcurrentSql(feedback), runConcurrentSql(feedback)]);
  if (feedbackResults.some((result) => result.status !== 0) || feedbackResults.map((result) => result.stdout).sort().join(",") !== "duplicate,processed") throw new Error(`Feedback replay race failed: ${JSON.stringify(feedbackResults)}`);
  const evidence = JSON.parse(runSql(`select json_build_object(
    'claimed_once', (select attempt_count from public.transactional_email_outbox where id = '${outboxId}'),
    'feedback_count', (select count(*) from public.ses_feedback_events where outbox_id = '${outboxId}'),
    'suppression_count', (select count(*) from public.transactional_email_suppressions where recipient_user_id = '${memberId}' and cleared_at is null),
    'source_notice_count', (select count(*) from public.private_notifications where community_id = '${communityId}' and event_type = 'membership_approved')
  );`));
  if (evidence.claimed_once !== 1 || evidence.feedback_count !== 1 || evidence.suppression_count !== 1 || evidence.source_notice_count !== 1) throw new Error(`Notification concurrency evidence failed: ${JSON.stringify(evidence)}`);
  process.stdout.write(`Concurrent notification claim and feedback replay invariants OK: ${JSON.stringify(evidence)}\n`);

  runSql(`
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000', '${secondMemberId}', 'authenticated', 'authenticated', 'notification-stale@example.test', '', now(), now(), now(), '{"display_name":"Stale Claim Member"}');
update public.profiles set community_id = '${communityId}', membership_status = 'active', approved_by = '${memberId}', approved_at = now() where id = '${secondMemberId}';
select * from public.claim_transactional_notifications('${workerOne}', 1);`);
  runSql(`alter table public.transactional_email_outbox disable trigger transactional_email_outbox_protected; update public.transactional_email_outbox set claimed_at = clock_timestamp() - interval '11 minutes' where recipient_user_id = '${secondMemberId}'; alter table public.transactional_email_outbox enable trigger transactional_email_outbox_protected;`);
  runSql(`select * from public.claim_transactional_notifications('${workerTwo}', 1);`);
  const stale = JSON.parse(runSql(`select json_build_object('status', status, 'ambiguous_attempts', (select count(*) from public.notification_delivery_attempts a where a.outbox_id = o.id and a.outcome = 'ambiguous')) from public.transactional_email_outbox o where recipient_user_id = '${secondMemberId}';`));
  if (stale.status !== "ambiguous" || stale.ambiguous_attempts !== 1) throw new Error(`Stale claim evidence failed: ${JSON.stringify(stale)}`);
  process.stdout.write(`Stale claims become terminally ambiguous: ${JSON.stringify(stale)}\n`);

  runSql(`select public.emit_private_notification('loan_requested', 'preference-race', 1, '${communityId}', '${secondMemberId}', '{"schema_version":1}', clock_timestamp());`);
  const preferenceSession = runConcurrentSql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${secondMemberId}', true); select public.update_my_transactional_email_preferences(false, true, true); select pg_sleep(1); commit;`);
  await delay(100);
  const preferenceClaim = runConcurrentSql(`select * from public.claim_transactional_notifications('${workerOne}', 1);`);
  const [preferenceResult, preferenceClaimResult] = await Promise.all([preferenceSession, preferenceClaim]);
  if (preferenceResult.status !== 0 || preferenceClaimResult.status !== 0 || preferenceClaimResult.stdout) throw new Error(`Preference/claim race failed: ${JSON.stringify({ preferenceResult, preferenceClaimResult })}`);
  const preferenceStatus = runSql(`select status from public.transactional_email_outbox where authoritative_record_id = 'preference-race';`);
  if (preferenceStatus !== "preference_suppressed") throw new Error(`Preference/claim result was ${preferenceStatus}`);
  process.stdout.write(`Concurrent preference update wins before provider claim: ${preferenceStatus}\n`);

  runSql(`select public.emit_private_notification('membership_approved', 'suppression-race', 1, '${communityId}', '${secondMemberId}', '{"schema_version":1}', clock_timestamp());`);
  const suppressionSession = runConcurrentSql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${memberId}', true); select public.set_administrator_email_suppression('${secondMemberId}', true); select pg_sleep(1); commit;`);
  await delay(100);
  const suppressionClaim = runConcurrentSql(`select * from public.claim_transactional_notifications('${workerTwo}', 1);`);
  const [suppressionResult, suppressionClaimResult] = await Promise.all([suppressionSession, suppressionClaim]);
  if (suppressionResult.status !== 0 || suppressionClaimResult.status !== 0 || suppressionClaimResult.stdout) throw new Error(`Suppression/claim race failed: ${JSON.stringify({ suppressionResult, suppressionClaimResult })}`);
  const suppressionStatus = runSql(`select status from public.transactional_email_outbox where authoritative_record_id = 'suppression-race';`);
  if (suppressionStatus !== "address_suppressed") throw new Error(`Suppression/claim result was ${suppressionStatus}`);
  process.stdout.write(`Concurrent Administrator suppression wins before provider claim: ${suppressionStatus}\n`);

  runSql(`
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000', '${feedbackRaceMemberId}', 'authenticated', 'authenticated', 'notification-feedback-race@example.test', '', now(), now(), now(), '{"display_name":"Feedback Race Member"}');
update public.profiles set community_id = '${communityId}', membership_status = 'active', approved_by = '${memberId}', approved_at = now() where id = '${feedbackRaceMemberId}';
insert into public.community_roles (community_id, user_id, role, granted_by) values ('${communityId}', '${feedbackRaceMemberId}', 'member', '${memberId}');
select public.emit_private_notification('membership_approved', 'feedback-admin-race', 1, '${communityId}', '${feedbackRaceMemberId}', '{"schema_version":1}', clock_timestamp());
select * from public.claim_transactional_notifications('${workerOne}', 25);
select public.complete_transactional_notification_delivery(
  (select id from public.transactional_email_outbox where authoritative_record_id = 'feedback-admin-race'),
  (select claim_token from public.transactional_email_outbox where authoritative_record_id = 'feedback-admin-race'),
  'delivered', 'ses-feedback-admin-race', null
);`);
  const feedbackAdminRace = runConcurrentSql(`begin;
select public.apply_verified_ses_feedback(
  'arn:aws:sns:us-east-1:123456789012:gear-share', 'sns-feedback-admin-race', 'complaint',
  'ses-feedback-admin-race', 'notification-feedback-race@example.test',
  (select delivery_tag from public.transactional_email_outbox where authoritative_record_id = 'feedback-admin-race'),
  clock_timestamp()
);
select pg_sleep(1);
commit;`);
  await delay(100);
  const administratorRace = runConcurrentSql(`begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${memberId}', true);
select public.set_administrator_email_suppression('${feedbackRaceMemberId}', true);
commit;`);
  const [feedbackRaceResult, administratorRaceResult] = await Promise.all([feedbackAdminRace, administratorRace]);
  if (feedbackRaceResult.status !== 0 || administratorRaceResult.status === 0 || !administratorRaceResult.stderr.includes("provider suppression cannot be changed by Administrator")) throw new Error(`Feedback/Administrator race failed: ${JSON.stringify({ feedbackRaceResult, administratorRaceResult })}`);
  const feedbackRaceEvidence = JSON.parse(runSql(`select json_build_object(
    'reason', (select reason from public.transactional_email_suppressions where recipient_user_id = '${feedbackRaceMemberId}' and cleared_at is null),
    'administrator_audit_count', (select count(*) from public.transactional_email_suppression_audit where recipient_user_id = '${feedbackRaceMemberId}'),
    'recipient_notice_count', (select count(*) from public.private_notifications where recipient_user_id = '${feedbackRaceMemberId}' and event_type = 'email_delivery_suppressed')
  );`));
  if (feedbackRaceEvidence.reason !== "complaint" || feedbackRaceEvidence.administrator_audit_count !== 0 || feedbackRaceEvidence.recipient_notice_count !== 1) throw new Error(`Feedback/Administrator race evidence failed: ${JSON.stringify(feedbackRaceEvidence)}`);
  process.stdout.write(`Verified provider feedback wins concurrent Administrator pause: ${JSON.stringify(feedbackRaceEvidence)}\n`);
} finally {
  runSql(cleanup);
}
