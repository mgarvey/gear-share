import { spawn, spawnSync } from "node:child_process";

// Exercises AI drafting reservation and accounting race conditions.
const label = "community-gear-lending"; const database = process.env.GEAR_SHARE_TEST_DATABASE || "postgres";
const community = "da000000-0000-4000-8000-000000000001"; const admin = "da100000-0000-4000-8000-000000000001"; const member = "da100000-0000-4000-8000-000000000002";
const found = spawnSync("docker", ["ps","--filter",`label=com.supabase.cli.project=${label}`,"--filter","name=supabase_db_","--format","{{.Names}}"], { encoding: "utf8" });
if (found.status !== 0) throw new Error(found.stderr.trim()); const containers = found.stdout.trim().split("\n").filter(Boolean); if (containers.length !== 1) throw new Error(`Expected one local gear share database; found ${containers.length}.`); const container = containers[0];
const args = ["exec","-i",container,"psql","-X","-qAt","-v","ON_ERROR_STOP=1","-U","postgres","-d",database];
function run(sql) { const result = spawnSync("docker", args, { input: sql, encoding: "utf8" }); if (result.status !== 0) throw new Error(result.stderr.trim()); return result.stdout.trim(); }
function concurrent(sql) { return new Promise((resolve) => { const child = spawn("docker", args, { stdio: ["pipe","pipe","pipe"] }); let stdout="",stderr=""; child.stdout.setEncoding("utf8").on("data",(x)=>stdout+=x); child.stderr.setEncoding("utf8").on("data",(x)=>stderr+=x); child.on("close",(status)=>resolve({status,stdout:stdout.trim(),stderr:stderr.trim()})); child.stdin.end(sql); }); }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanup = `
begin;
alter table public.ai_draft_attempts disable trigger ai_draft_attempts_protected;
alter table public.ai_activation_evidence disable trigger ai_activation_evidence_immutable;
alter table public.ai_model_price_snapshots disable trigger ai_price_snapshots_immutable;
alter table public.administrator_ai_setting_audit disable trigger administrator_ai_setting_audit_protected;
alter table public.community_settings disable trigger community_settings_protected;
alter table public.community_setting_versions disable trigger community_setting_versions_protected;
alter table public.notification_delivery_attempts disable trigger notification_delivery_attempts_protected;
alter table public.transactional_email_outbox disable trigger transactional_email_outbox_protected;
alter table public.private_notifications disable trigger private_notifications_protected;
alter table public.membership_deactivation_consequences disable trigger deactivation_consequences_protected;
delete from public.notification_delivery_attempts where outbox_id in (select id from public.transactional_email_outbox where community_id='${community}');
delete from public.transactional_email_outbox where community_id='${community}';
delete from public.private_notifications where community_id='${community}';
delete from public.membership_deactivation_consequences where community_id='${community}';
delete from public.ai_draft_attempts where community_id='${community}'; delete from public.ai_activation_evidence where community_id='${community}'; delete from public.ai_model_price_snapshots where recorded_by='ai-concurrency';
delete from public.administrator_ai_setting_audit where community_id='${community}'; delete from public.community_settings where community_id='${community}'; delete from public.community_setting_versions where community_id='${community}';
delete from public.community_roles where community_id='${community}'; delete from public.profiles where community_id='${community}'; delete from auth.users where id in ('${admin}','${member}'); delete from public.communities where id='${community}';
alter table public.ai_draft_attempts enable trigger ai_draft_attempts_protected; alter table public.ai_activation_evidence enable trigger ai_activation_evidence_immutable; alter table public.ai_model_price_snapshots enable trigger ai_price_snapshots_immutable;
alter table public.administrator_ai_setting_audit enable trigger administrator_ai_setting_audit_protected; alter table public.community_settings enable trigger community_settings_protected; alter table public.community_setting_versions enable trigger community_setting_versions_protected;
alter table public.notification_delivery_attempts enable trigger notification_delivery_attempts_protected; alter table public.transactional_email_outbox enable trigger transactional_email_outbox_protected; alter table public.private_notifications enable trigger private_notifications_protected; alter table public.membership_deactivation_consequences enable trigger deactivation_consequences_protected;
commit;`;
const service = (body) => `begin; set local role service_role; select set_config('request.jwt.claim.role','service_role',true); ${body} commit;`;
try {
  run(`${cleanup}
insert into public.communities(id,slug,name) values('${community}','ai-races','AI Races'); begin; select set_config('app.milestone_six_internal_change','allowed',true);
insert into public.community_setting_versions(community_id,version,display_name,ai_drafting_enabled,operator_identifier) values('${community}',1,'AI Races',false,'milestone-6-migration'); insert into public.community_settings(community_id,current_version,display_name,ai_drafting_enabled) values('${community}',1,'AI Races',false); commit;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_user_meta_data) values('00000000-0000-0000-0000-000000000000','${admin}','authenticated','authenticated','m8-race-admin@example.test','',now(),now(),now(),'{}'),('00000000-0000-0000-0000-000000000000','${member}','authenticated','authenticated','m8-race-member@example.test','',now(),now(),now(),'{}');
alter table public.profiles disable trigger profile_membership_notification; update public.profiles set community_id='${community}',membership_status='active',approved_by='${admin}',approved_at=now() where id in ('${admin}','${member}'); alter table public.profiles enable trigger profile_membership_notification;
insert into public.community_roles(community_id,user_id,role,granted_by) values('${community}','${admin}','member','${admin}'),('${community}','${admin}','steward','${admin}'),('${community}','${member}','member','${admin}');
insert into public.ai_model_price_snapshots(id,model,service_tier,currency,input_microdollars_per_million,cached_input_microdollars_per_million,output_microdollars_per_million,worst_case_microdollars_per_draft,source_reference,effective_at,observed_at,expires_at,recorded_by) values('da300000-0000-4000-8000-000000000001','gpt-5.6-luna','standard','USD',1000000,500000,6000000,100000,'concurrency fixture',now(),now(),now()+interval '1 day','ai-concurrency');
insert into public.ai_activation_evidence(id,community_id,price_snapshot_id,model,service_tier,model_access_confirmed,secret_present,image_input_supported,structured_output_supported,data_controls_reviewed,dashboard_price_confirmed,evaluation_set_version,evaluation_manifest_sha256,evaluation_scores_sha256,evaluation_passed,reviewer_one,reviewer_two,reviewer_one_passed,reviewer_two_passed,overall_approved,expires_at,recorded_by,activation_check_passed,provider_response_id,checked_by) values('da400000-0000-4000-8000-000000000001','${community}','da300000-0000-4000-8000-000000000001','gpt-5.6-luna','standard',true,true,true,true,false,false,'ai-v1',repeat('a',64),repeat('b',64),false,'automated-smoke-check','administrator-request',false,false,true,now()+interval '1 hour','ai-concurrency',true,'resp_concurrency_activation','${admin}');
begin; set local role authenticated; select set_config('request.jwt.claim.sub','${admin}',true); select * from public.set_ai_drafting_enabled(true,1); commit;
${service(`select * from public.reserve_ai_drafting_attempt('${member}','da500000-0000-4000-8000-000000000001','single',1,4); select * from public.reserve_ai_drafting_attempt('${member}','da500000-0000-4000-8000-000000000002','single',1,4);`)}
`);
  const reserve = (id) => service(`select * from public.reserve_ai_drafting_attempt('${member}','${id}','single',1,4);`);
  const [a,b] = await Promise.all([concurrent(reserve("da500000-0000-4000-8000-000000000003")),concurrent(reserve("da500000-0000-4000-8000-000000000004"))]);
  if ([a,b].filter((x)=>x.status===0).length !== 1 || [a,b].filter((x)=>x.stderr.includes("rate limit")).length !== 1) throw new Error(`Minute ceiling race failed: ${JSON.stringify({a,b})}`);
  process.stdout.write("Concurrent fourth request preserves the three-per-minute ceiling.\n");
  run(`begin; select set_config('request.jwt.claim.role','service_role',true); select public.complete_ai_drafting_attempt(id,'completed',100,10,20,4,null,'resp_concurrency') from public.ai_draft_attempts where requester_id='${member}' and status='reserved'; commit;`);
  const reserveBeforeDisable = concurrent(service(`select * from public.reserve_ai_drafting_attempt('${admin}','da500000-0000-4000-8000-000000000005','single',1,4); select pg_sleep(0.6);`));
  await delay(80);
  const disable = concurrent(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${admin}',true); select already_reserved_requests from public.set_ai_drafting_enabled(false,2); commit;`);
  const [reserved,disabled] = await Promise.all([reserveBeforeDisable,disable]);
  if (reserved.status !== 0 || disabled.status !== 0 || Number(disabled.stdout.split("\n").filter(Boolean).at(-1)) !== 1) throw new Error(`Disable/reserve race failed: ${JSON.stringify({reserved,disabled})}`);
  const post = concurrent(service(`select * from public.reserve_ai_drafting_attempt('${admin}','da500000-0000-4000-8000-000000000006','single',1,4);`)); const postResult = await post;
  if (postResult.status === 0 || !postResult.stderr.includes("unavailable")) throw new Error(`Post-disable reservation unexpectedly succeeded: ${JSON.stringify(postResult)}`);
  process.stdout.write("Disable serializes with reservation and reports the one already-authorized request.\n");
  run(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${admin}',true); select * from public.set_ai_drafting_enabled(true,3); commit;`);
  const deactivation = concurrent(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${admin}',true); select public.deactivate_member('${member}','${admin}'); select pg_sleep(0.6); commit;`);
  await delay(80);
  const staleMemberReservation = concurrent(service(`select * from public.reserve_ai_drafting_attempt('${member}','da500000-0000-4000-8000-000000000007','single',1,1);`));
  const [deactivated, staleReservation] = await Promise.all([deactivation, staleMemberReservation]);
  if (deactivated.status !== 0 || staleReservation.status === 0 || !staleReservation.stderr.includes("active member required")) throw new Error(`Deactivation/reservation race failed: ${JSON.stringify({deactivated,staleReservation})}`);
  if (run(`select count(*) from public.ai_draft_attempts where id='da500000-0000-4000-8000-000000000007'`) !== "0") throw new Error("Inactive member obtained provider authorization after deactivation.");
  process.stdout.write("Deactivation serializes before reservation and the post-lock membership recheck fails closed.\n");
} finally { run(cleanup); }
