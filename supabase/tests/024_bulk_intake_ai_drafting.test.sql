begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.communities (id, slug, name) values
  ('d8000000-0000-4000-8000-000000000001', 'm8-primary', 'Milestone Eight'),
  ('d8000000-0000-4000-8000-000000000002', 'm8-cross', 'Milestone Eight Cross');
select set_config('app.milestone_six_internal_change','allowed',true);
insert into public.community_setting_versions (community_id,version,display_name,ai_drafting_enabled,operator_identifier) values
  ('d8000000-0000-4000-8000-000000000001',1,'Milestone Eight',false,'milestone-6-migration'),
  ('d8000000-0000-4000-8000-000000000002',1,'Milestone Eight Cross',false,'milestone-6-migration');
insert into public.community_settings (community_id,current_version,display_name,ai_drafting_enabled) values
  ('d8000000-0000-4000-8000-000000000001',1,'Milestone Eight',false),
  ('d8000000-0000-4000-8000-000000000002',1,'Milestone Eight Cross',false);
select set_config('app.milestone_six_internal_change','',true);
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000000','d8100000-0000-4000-8000-000000000001','authenticated','authenticated','m8-admin@example.test','',now(),now(),now(),'{}'),
  ('00000000-0000-0000-0000-000000000000','d8100000-0000-4000-8000-000000000002','authenticated','authenticated','m8-member@example.test','',now(),now(),now(),'{}'),
  ('00000000-0000-0000-0000-000000000000','d8100000-0000-4000-8000-000000000003','authenticated','authenticated','m8-cross@example.test','',now(),now(),now(),'{}');
alter table public.profiles disable trigger profile_membership_notification;
update public.profiles set community_id='d8000000-0000-4000-8000-000000000001', membership_status='active', approved_by='d8100000-0000-4000-8000-000000000001', approved_at=now() where id in ('d8100000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000002');
update public.profiles set community_id='d8000000-0000-4000-8000-000000000002', membership_status='active', approved_by='d8100000-0000-4000-8000-000000000003', approved_at=now() where id='d8100000-0000-4000-8000-000000000003';
alter table public.profiles enable trigger profile_membership_notification;
insert into public.community_roles (community_id,user_id,role,granted_by) values
  ('d8000000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000001','member','d8100000-0000-4000-8000-000000000001'),
  ('d8000000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000001','steward','d8100000-0000-4000-8000-000000000001'),
  ('d8000000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000002','member','d8100000-0000-4000-8000-000000000001'),
  ('d8000000-0000-4000-8000-000000000002','d8100000-0000-4000-8000-000000000003','member','d8100000-0000-4000-8000-000000000003'),
  ('d8000000-0000-4000-8000-000000000002','d8100000-0000-4000-8000-000000000003','steward','d8100000-0000-4000-8000-000000000003');

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
  'public.ai_model_price_snapshots'::regclass,'public.ai_activation_evidence'::regclass,'public.ai_draft_attempts'::regclass
)), 'all AI control relations use forced RLS');
select ok(not has_table_privilege('authenticated','public.ai_draft_attempts','SELECT'), 'members cannot inspect content-free AI attempts');
select ok(not has_function_privilege('authenticated','public.reserve_ai_drafting_attempt(uuid,uuid,text,integer,integer)','EXECUTE'), 'members cannot reserve provider work directly');
select ok(has_function_privilege('service_role','public.reserve_ai_drafting_attempt(uuid,uuid,text,integer,integer)','EXECUTE'), 'only service workflow can reserve provider work');
select ok(not has_function_privilege('authenticated','public.authorize_ai_activation_check(uuid)','EXECUTE'), 'members cannot authorize provider activation checks directly');
select ok(not has_function_privilege('authenticated','public.record_ai_activation_check(uuid,text)','EXECUTE'), 'members cannot record provider activation evidence directly');
select ok(has_function_privilege('service_role','public.authorize_ai_activation_check(uuid)','EXECUTE'), 'service workflow can authorize a bounded Administrator check');
select ok(has_function_privilege('service_role','public.record_ai_activation_check(uuid,text)','EXECUTE'), 'service workflow can record a successful bounded check');
select ok(has_function_privilege('authenticated','public.batch_stage_gear_drafts(jsonb)','EXECUTE'), 'members can invoke bounded bulk staging');

set local role authenticated;
select set_config('request.jwt.claim.sub','d8100000-0000-4000-8000-000000000002',true);
create temporary table m8_bulk_result as select public.batch_stage_gear_drafts(jsonb_build_array(
  jsonb_build_object('attemptId','d8200000-0000-4000-8000-000000000001','title','Member tent','description','','category','tents-shelters','condition','good','quantity',1,'ownershipKind','individual','custodianId',null,'expectedImages',1,'sourceDigest',repeat('a',64),'guidelines',jsonb_build_array('Return dry')),
  jsonb_build_object('attemptId','d8200000-0000-4000-8000-000000000002','title','Forged group stove','description','','category','camp-kitchen','condition','good','quantity',1,'ownershipKind','group','custodianId','d8100000-0000-4000-8000-000000000001','expectedImages',1,'sourceDigest',repeat('b',64),'guidelines','[]'::jsonb)
)) as value;
reset role;
select is((select count(*) from public.supplies where publication_attempt_id='d8200000-0000-4000-8000-000000000001'),1::bigint,'valid sibling creates one ordinary draft');
select is((select listing_status::text from public.supplies where publication_attempt_id='d8200000-0000-4000-8000-000000000001'),'unlisted','bulk staging never publishes');
select is((select count(*) from public.supplies where publication_attempt_id='d8200000-0000-4000-8000-000000000002'),0::bigint,'Regular forged group sibling rolls back independently');
select is((select jsonb_array_length(value) from m8_bulk_result),2,'ordered result preserves every candidate outcome');
select is((select value->1->>'status' from m8_bulk_result),'failed','invalid sibling returns bounded failure');
select is((select count(*) from public.gear_media_upload_attempts where supply_id=(select id from public.supplies where publication_attempt_id='d8200000-0000-4000-8000-000000000001')),1::bigint,'valid candidate preissues one private media slot');

set local role authenticated;
select set_config('request.jwt.claim.sub','d8100000-0000-4000-8000-000000000002',true);
select lives_ok($$ select public.batch_stage_gear_drafts(jsonb_build_array(
  jsonb_build_object('attemptId','d8200000-0000-4000-8000-000000000004','title','Four-photo tent','description','','category','tents-shelters','condition','good','quantity',1,'ownershipKind','individual','custodianId',null,'expectedImages',4,'sourceDigest',repeat('4',64),'guidelines','[]'::jsonb)
)) $$,'bulk intake accepts four photos for one item');
reset role;
select is((select publication_expected_images::integer from public.supplies where publication_attempt_id='d8200000-0000-4000-8000-000000000004'),4,'four-photo item keeps the ordinary listing photo count');

create function pg_temp.m8_reject_after_supply_insert() returns trigger language plpgsql as $$
begin
  if new.title = 'Injected rollback' then raise exception 'test-only post-insert fault'; end if;
  return new;
end;
$$;
create trigger m8_reject_after_supply_insert after insert on public.supplies
for each row execute function pg_temp.m8_reject_after_supply_insert();
set local role authenticated;
select set_config('request.jwt.claim.sub','d8100000-0000-4000-8000-000000000002',true);
create temporary table m8_fault_result as select public.batch_stage_gear_drafts(jsonb_build_array(
  jsonb_build_object('attemptId','d8200000-0000-4000-8000-000000000011','title','Injected rollback','description','','category','tents-shelters','condition','good','quantity',1,'ownershipKind','individual','custodianId',null,'expectedImages',1,'sourceDigest',repeat('d',64),'guidelines','[]'::jsonb),
  jsonb_build_object('attemptId','d8200000-0000-4000-8000-000000000012','title','Committed sibling','description','','category','tents-shelters','condition','good','quantity',1,'ownershipKind','individual','custodianId',null,'expectedImages',1,'sourceDigest',repeat('e',64),'guidelines','[]'::jsonb)
)) as value;
reset role;
drop trigger m8_reject_after_supply_insert on public.supplies;
select is((select count(*) from public.supplies where publication_attempt_id='d8200000-0000-4000-8000-000000000011'),0::bigint,'test-only post-insert failure rolls back that candidate subtransaction');
select is((select count(*) from public.supplies where publication_attempt_id='d8200000-0000-4000-8000-000000000012'),1::bigint,'post-insert failure preserves committed sibling');
select is((select value->0->>'status' from m8_fault_result),'failed','post-insert failure returns a bounded row result');

set local role authenticated;
select set_config('request.jwt.claim.sub','d8100000-0000-4000-8000-000000000002',true);
select throws_ok(
  $$ select public.batch_stage_gear_drafts(jsonb_build_array(
    jsonb_build_object('attemptId','d8200000-0000-4000-8000-000000000021','title','Duplicate one','description','','category','tents-shelters','condition','good','quantity',1,'ownershipKind','individual','custodianId',null,'expectedImages',1,'sourceDigest',repeat('f',64),'guidelines','[]'::jsonb),
    jsonb_build_object('attemptId','d8200000-0000-4000-8000-000000000021','title','Duplicate two','description','','category','tents-shelters','condition','good','quantity',1,'ownershipKind','individual','custodianId',null,'expectedImages',1,'sourceDigest',repeat('0',64),'guidelines','[]'::jsonb)
  )) $$,
  'P0001','bulk candidate attempt identifiers must be unique','duplicate candidate identifiers fail before any write'
);
reset role;
select is((select count(*) from public.supplies where publication_attempt_id='d8200000-0000-4000-8000-000000000021'),0::bigint,'duplicate identifiers create no aliased draft');

set local role authenticated;
select set_config('request.jwt.claim.sub','d8100000-0000-4000-8000-000000000002',true);
select throws_ok(
  $$ select public.batch_stage_gear_drafts((select jsonb_agg(jsonb_build_object('attemptId',gen_random_uuid(),'title','Too many','description','','category','tents-shelters','condition','good','quantity',1,'ownershipKind','individual','custodianId',null,'expectedImages',1,'sourceDigest',repeat('c',64),'guidelines','[]'::jsonb)) from generate_series(1,11))) $$,
  'P0001','one to ten bulk candidates are required','eleven candidates fail before any write'
);
select is((select count(*)::integer from public.private_bulk_draft_attempt_status(array['d8200000-0000-4000-8000-000000000001'::uuid])),1,'creator can recover bounded draft status');
select set_config('request.jwt.claim.sub','d8100000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from public.private_bulk_draft_attempt_status(array['d8200000-0000-4000-8000-000000000001'::uuid])),0,'cross-community member cannot probe draft status');
reset role;

insert into public.ai_model_price_snapshots (id,model,service_tier,currency,input_microdollars_per_million,cached_input_microdollars_per_million,output_microdollars_per_million,worst_case_microdollars_per_draft,source_reference,effective_at,observed_at,expires_at,recorded_by)
values ('d8300000-0000-4000-8000-000000000001','gpt-5.6-luna','standard','USD',1000000,500000,6000000,100000,'test-only dashboard fixture',now(),now(),now()+interval '1 day','pgTAP fixture');
insert into public.ai_activation_evidence (id,community_id,price_snapshot_id,model,service_tier,model_access_confirmed,secret_present,image_input_supported,structured_output_supported,data_controls_reviewed,dashboard_price_confirmed,evaluation_set_version,evaluation_manifest_sha256,evaluation_scores_sha256,evaluation_passed,reviewer_one,reviewer_two,reviewer_one_passed,reviewer_two_passed,overall_approved,expires_at,recorded_by,activation_check_passed,provider_response_id,checked_by)
values ('d8400000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001','d8300000-0000-4000-8000-000000000001','gpt-5.6-luna','standard',true,true,true,true,false,false,'m8-v1',repeat('a',64),repeat('b',64),false,'automated-smoke-check','administrator-request',false,false,true,now()+interval '1 hour','pgTAP fixture',true,'resp_pgtap','d8100000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','d8100000-0000-4000-8000-000000000001',true);
select is((select ai_drafting_enabled from public.set_ai_drafting_enabled(true,(select configuration_version from public.get_my_community_settings()))),true,'Administrator can enable only with all current gates');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$ select * from public.reserve_ai_drafting_attempt('d8100000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000001','single',1,4) $$,'service reserves first bounded attempt');
select lives_ok($$ select * from public.reserve_ai_drafting_attempt('d8100000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000001','single',1,4) $$,'exact request replay is idempotent');
select throws_ok($$ select * from public.reserve_ai_drafting_attempt('d8100000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000001','bulk',2,2) $$,'P0001','AI attempt unavailable','same UUID with changed shape is rejected');
select lives_ok($$ select * from public.reserve_ai_drafting_attempt('d8100000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000002','single',1,4) $$,'second minute-window reservation succeeds');
select lives_ok($$ select * from public.reserve_ai_drafting_attempt('d8100000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000003','single',1,4) $$,'third minute-window reservation succeeds');
select throws_ok($$ select * from public.reserve_ai_drafting_attempt('d8100000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000004','single',1,4) $$,'P0001','AI drafting rate limit reached','fourth minute-window reservation is rejected');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','d8100000-0000-4000-8000-000000000001',true);
select is((select already_reserved_requests from public.set_ai_drafting_enabled(false,(select configuration_version from public.get_my_community_settings()))),3,'disable reports exact already-reserved attempts');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$ select * from public.reserve_ai_drafting_attempt('d8100000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000005','single',1,4) $$,'P0001','AI drafting is unavailable','no reservation linearizes after disable');
select lives_ok($$ select public.complete_ai_drafting_attempt('d8500000-0000-4000-8000-000000000001','completed',100,10,20,4,null,'resp_test') $$,'service records bounded actual usage once');
select lives_ok($$ select public.complete_ai_drafting_attempt('d8500000-0000-4000-8000-000000000001','completed',999,10,999,4,null,'resp_replay') $$,'completion replay cannot rewrite usage');
select throws_ok($$ select public.complete_ai_drafting_attempt('d8500000-0000-4000-8000-000000000002','failed',100,null,20,4,'schema','resp_partial') $$,'P0001','partial provider usage is not accepted','partial usage tuples cannot understate reconciled cost');
reset role;
select is((select input_tokens from public.ai_draft_attempts where id='d8500000-0000-4000-8000-000000000001'),100,'first completion remains authoritative');
select is((select cached_input_tokens from public.ai_draft_attempts where id='d8500000-0000-4000-8000-000000000001'),10,'cached input usage is recorded');
select is((select reasoning_output_tokens from public.ai_draft_attempts where id='d8500000-0000-4000-8000-000000000001'),4,'reasoning usage is recorded without double billing');
select is((select actual_microdollars from public.ai_draft_attempts where id='d8500000-0000-4000-8000-000000000001'),215::bigint,'actual cost reconciles cached input and total output using integer ceiling arithmetic');

set local role authenticated;
select set_config('request.jwt.claim.sub','d8100000-0000-4000-8000-000000000001',true);
select is((select ai_drafting_enabled from public.set_ai_drafting_enabled(true,3)),true,'current gates can re-enable for fixed-window boundary tests');
reset role;
select set_config('app.ai_attempt_internal','allowed',true);
delete from public.ai_draft_attempts where community_id='d8000000-0000-4000-8000-000000000001';
insert into public.ai_draft_attempts (
  id,community_id,requester_id,activation_evidence_id,price_snapshot_id,model,service_tier,
  mode,detail,candidate_count,image_count,reserved_units,reserved_microdollars,status,created_at,completed_at
)
select gen_random_uuid(),'d8000000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000002',
  'd8400000-0000-4000-8000-000000000001','d8300000-0000-4000-8000-000000000001','gpt-5.6-luna','standard',
  'single','low',1,1,1,1,'unknown_usage',clock_timestamp()-interval '2 minutes',clock_timestamp()
from generate_series(1,20);
select set_config('app.ai_attempt_internal','',true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$ select * from public.reserve_ai_drafting_attempt('d8100000-0000-4000-8000-000000000002',gen_random_uuid(),'single',1,1) $$,'P0001','AI drafting rate limit reached','twenty-first fixed-day request is rejected');
reset role;

select set_config('app.ai_attempt_internal','allowed',true);
delete from public.ai_draft_attempts where community_id='d8000000-0000-4000-8000-000000000001';
insert into public.ai_draft_attempts (
  id,community_id,requester_id,activation_evidence_id,price_snapshot_id,model,service_tier,
  mode,detail,candidate_count,image_count,reserved_units,reserved_microdollars,status,created_at,completed_at
)
select gen_random_uuid(),'d8000000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000002',
  'd8400000-0000-4000-8000-000000000001','d8300000-0000-4000-8000-000000000001','gpt-5.6-luna','standard',
  'bulk','low',10,10,10,1,'unknown_usage',date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC' + interval '1 second',clock_timestamp()
from generate_series(1,100);
select set_config('app.ai_attempt_internal','',true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$ select * from public.reserve_ai_drafting_attempt('d8100000-0000-4000-8000-000000000002',gen_random_uuid(),'single',1,1) $$,'P0001','AI drafting monthly ceiling reached','one-thousand-and-first community unit is rejected');
reset role;

select set_config('app.ai_attempt_internal','allowed',true);
delete from public.ai_draft_attempts where community_id='d8000000-0000-4000-8000-000000000001';
insert into public.ai_draft_attempts (
  id,community_id,requester_id,activation_evidence_id,price_snapshot_id,model,service_tier,
  mode,detail,candidate_count,image_count,reserved_units,reserved_microdollars,status,created_at,completed_at
) values (
  gen_random_uuid(),'d8000000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000002',
  'd8400000-0000-4000-8000-000000000001','d8300000-0000-4000-8000-000000000001','gpt-5.6-luna','standard',
  'single','low',1,1,1,4999999,'unknown_usage',date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC' + interval '1 second',clock_timestamp()
);
select set_config('app.ai_attempt_internal','',true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$ select * from public.reserve_ai_drafting_attempt('d8100000-0000-4000-8000-000000000002',gen_random_uuid(),'single',1,1) $$,'P0001','AI drafting monthly ceiling reached','one microdollar beyond the conservative monthly spend ceiling is rejected');
reset role;

select set_config('app.ai_attempt_internal','allowed',true);
delete from public.ai_draft_attempts where community_id='d8000000-0000-4000-8000-000000000001';
insert into public.ai_draft_attempts (
  id,community_id,requester_id,activation_evidence_id,price_snapshot_id,model,service_tier,
  mode,detail,candidate_count,image_count,reserved_units,reserved_microdollars,status,
  input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,usage_recognized,
  actual_microdollars,provider_response_id,created_at,completed_at
) values (
  'd8500000-0000-4000-8000-000000000021','d8000000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000002',
  'd8400000-0000-4000-8000-000000000001','d8300000-0000-4000-8000-000000000001','gpt-5.6-luna','standard',
  'single','low',1,1,1,4999999,'completed',0,0,0,0,true,1,'resp_under_budget',
  date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC' + interval '1 second',clock_timestamp()
);
select set_config('app.ai_attempt_internal','',true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$ select * from public.reserve_ai_drafting_attempt('d8100000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000022','single',1,1) $$,'recognized lower actual usage releases conservative monthly reservation');
reset role;

select set_config('app.ai_attempt_internal','allowed',true);
delete from public.ai_draft_attempts where community_id='d8000000-0000-4000-8000-000000000001';
insert into public.ai_draft_attempts (
  id,community_id,requester_id,activation_evidence_id,price_snapshot_id,model,service_tier,
  mode,detail,candidate_count,image_count,reserved_units,reserved_microdollars,status,
  input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,usage_recognized,
  actual_microdollars,provider_response_id,created_at,completed_at
) values (
  'd8500000-0000-4000-8000-000000000023','d8000000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000002',
  'd8400000-0000-4000-8000-000000000001','d8300000-0000-4000-8000-000000000001','gpt-5.6-luna','standard',
  'single','low',1,1,1,1,'completed',1,0,1,0,true,4999999,'resp_over_budget',
  date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC' + interval '1 second',clock_timestamp()
);
select set_config('app.ai_attempt_internal','',true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$ select * from public.reserve_ai_drafting_attempt('d8100000-0000-4000-8000-000000000002',gen_random_uuid(),'single',1,1) $$,'P0001','AI drafting monthly ceiling reached','recognized higher actual usage governs the monthly ceiling');
reset role;

select set_config('app.ai_attempt_internal','allowed',true);
delete from public.ai_draft_attempts where community_id='d8000000-0000-4000-8000-000000000001';
insert into public.ai_draft_attempts (id,community_id,requester_id,activation_evidence_id,price_snapshot_id,model,service_tier,mode,detail,candidate_count,image_count,reserved_units,reserved_microdollars,status,created_at)
values
  ('d8500000-0000-4000-8000-000000000031','d8000000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000002','d8400000-0000-4000-8000-000000000001','d8300000-0000-4000-8000-000000000001','gpt-5.6-luna','standard','single','low',1,1,1,100,'reserved',clock_timestamp()-interval '16 minutes'),
  ('d8500000-0000-4000-8000-000000000032','d8000000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000002','d8400000-0000-4000-8000-000000000001','d8300000-0000-4000-8000-000000000001','gpt-5.6-luna','standard','single','low',1,1,1,100,'provider_inflight',clock_timestamp()-interval '16 minutes');
select set_config('app.ai_attempt_internal','',true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is(public.expire_stale_ai_draft_attempts(10),2,'bounded reconciliation terminalizes stale reserved and provider-started attempts');
reset role;
select is((select status::text from public.ai_draft_attempts where id='d8500000-0000-4000-8000-000000000031'),'failed','known never-started stale reservation becomes failed');
select is((select status::text from public.ai_draft_attempts where id='d8500000-0000-4000-8000-000000000032'),'unknown_usage','stale provider-started request retains conservative unknown usage');
select ok((select bool_and(failure_kind='reconciliation' and completed_at is not null) from public.ai_draft_attempts where id in ('d8500000-0000-4000-8000-000000000031','d8500000-0000-4000-8000-000000000032')),'reconciliation evidence is bounded and terminal');
select throws_ok($$ update public.ai_model_price_snapshots set recorded_by='rewrite' where id='d8300000-0000-4000-8000-000000000001' $$,'P0001','AI activation and price evidence is immutable','price evidence rejects rewrite');
select throws_ok($$ update public.ai_draft_attempts set status='failed' where community_id='d8000000-0000-4000-8000-000000000001' $$,'P0001','AI attempt changes require reviewed workflows','attempt rows reject direct rewrite');

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$ select * from public.authorize_ai_activation_check('d8100000-0000-4000-8000-000000000002') $$,'P0001','active administrator required','ordinary members cannot authorize a provider check through the service workflow');
select lives_ok($$ select public.record_ai_activation_check('d8100000-0000-4000-8000-000000000003','resp_cross_activation') $$,'successful provider check records bounded activation evidence for the requesting Administrator community');
reset role;
select ok((select activation_check_passed and provider_response_id='resp_cross_activation' and checked_by='d8100000-0000-4000-8000-000000000003' from public.ai_activation_evidence where community_id='d8000000-0000-4000-8000-000000000002'),'recorded activation evidence contains only bounded operational proof');

select * from finish();
rollback;
