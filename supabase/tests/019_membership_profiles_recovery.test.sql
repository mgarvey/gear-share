begin;
create extension if not exists pgtap with schema extensions;
select plan(102);

select hasnt_column('public', 'profiles', 'email', 'profiles cannot store an independently client-authored authoritative email');
select hasnt_column('public', 'member_profile_settings', 'address', 'private settings do not add a street or pickup address');
select hasnt_column('public', 'member_profile_settings', 'latitude', 'private settings do not add coordinates or geocoding data');
select hasnt_column('public', 'member_profile_settings', 'avatar_url', 'private settings do not add an avatar or public media lifecycle');
select hasnt_column('public', 'member_profile_settings', 'household_role', 'private settings do not add household or Scout authorization roles');
select hasnt_column('public', 'member_profile_settings', 'date_of_birth', 'private settings do not collect youth-specific birth data');

select has_table('public', 'join_question_versions', 'versioned join questions table exists');
select has_table('public', 'membership_applications', 'private membership applications table exists');
select has_table('public', 'member_profile_settings', 'private member settings table exists');
select has_column('public', 'gear_loans', 'handoff_contact_id', 'formal loans record the authoritative handoff participant');
select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('join_question_versions', 'membership_applications', 'member_profile_settings')
     and c.relrowsecurity and c.relforcerowsecurity),
  3, 'every milestone-three private table enables and forces RLS'
);
select is(
  (select count(*)::integer from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('join_question_versions', 'membership_applications', 'member_profile_settings')
     and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0, 'client roles have no direct milestone-three table mutation'
);
select hasnt_column('public', 'profiles', 'email', 'profile table does not become a second email authority');
select ok(has_function_privilege('anon', 'public.current_join_questions()', 'EXECUTE'), 'anonymous join landing may read only the public question contract');
select ok(not has_function_privilege('anon', 'public.submit_join_application(uuid,jsonb)', 'EXECUTE'), 'anonymous caller has no application mutation grant');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'member-admin@example.test', '', now(), now(), now(), '{"display_name":"Member Admin"}'),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'gear-owner@example.test', '', now(), now(), now(), '{"display_name":"Gear Owner"}'),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'loan-borrower@example.test', '', now(), now(), now(), '{"display_name":"Loan Borrower"}'),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'unrelated@example.test', '', now(), now(), now(), '{"display_name":"Unrelated Member"}'),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'custodian@example.test', '', now(), now(), now(), '{"display_name":"Inventory Custodian"}'),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'applicant@example.test', '', now(), now(), now(), '{"display_name":"Pending Applicant"}'),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'explicit-empty@example.test', '', now(), now(), now(), '{"display_name":"Explicit Empty Applicant"}');

select lives_ok(
  $$ select public.bootstrap_founding_steward('e1000000-0000-4000-8000-000000000001', 'local-test', 'membership recovery fixture') $$,
  'founding Administrator bootstrap remains explicit'
);

insert into public.membership_applications (
  community_id, applicant_id, question_version_id, answer_snapshot, answer_count
)
select p.community_id, p.id, q.id, '[]'::jsonb, 0
from public.profiles p
join public.join_question_versions q on q.community_id = p.community_id and q.is_current
where p.id in (
  'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003',
  'e1000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000005'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select lives_ok($$ select public.decide_membership('e1000000-0000-4000-8000-000000000002', true) $$, 'Administrator approves gear owner after explicit zero-question submission');
select lives_ok($$ select public.decide_membership('e1000000-0000-4000-8000-000000000003', true) $$, 'Administrator approves borrower after explicit zero-question submission');
select lives_ok($$ select public.decide_membership('e1000000-0000-4000-8000-000000000004', true) $$, 'Administrator approves unrelated member');
select lives_ok($$ select public.decide_membership('e1000000-0000-4000-8000-000000000005', true) $$, 'Administrator approves future Custodian');
select lives_ok($$ select public.set_access_level('e1000000-0000-4000-8000-000000000005', 'custodian') $$, 'Administrator assigns bounded Custodian access');
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.profiles where id <> 'e1000000-0000-4000-8000-000000000004'), 0, 'ordinary active member cannot enumerate other profile rows');
select is((select count(*)::integer from public.community_roles where user_id <> 'e1000000-0000-4000-8000-000000000004'), 0, 'ordinary active member cannot enumerate other role rows');
select throws_ok($$ select * from public.private_inventory_contacts(null) $$, 'P0001', 'active inventory contact context required', 'ordinary member cannot open a context-free member chooser');
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000005', true);
select is((select count(*)::integer from public.profiles where membership_status <> 'active'), 0, 'Custodian contextual chooser access excludes pending and terminal profile rows');
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.decide_membership('e1000000-0000-4000-8000-000000000009', true) $$,
  'P0001', 'current pending membership application required', 'Administrator cannot approve a confirmed zero-question signup before explicit submission'
);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000009', true);
select lives_ok(
  format($$ select public.submit_join_application(%L, '{}'::jsonb) $$, (select version_id from public.current_join_questions())),
  'confirmed applicant explicitly submits an empty current question set'
);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select lives_ok($$ select public.decide_membership('e1000000-0000-4000-8000-000000000009', true) $$, 'Administrator may approve after the explicit empty submission');

select lives_ok(
  $$ select public.publish_join_questions('[{"id":"q1","prompt":"How are you connected to the community?","required":true},{"id":"q2","prompt":"What gear are you interested in?","required":false}]') $$,
  'Administrator publishes one complete bounded question version'
);
select is((select jsonb_array_length(questions) from public.current_join_questions()), 2, 'public join contract exposes only two current questions');
select version_id as stale_version_id from public.current_join_questions() \gset
select lives_ok(
  $$ select public.publish_join_questions('[{"id":"q1","prompt":"How are you connected to the community?","required":true},{"id":"q2","prompt":"What gear are you interested in?","required":false}]') $$,
  'Administrator publishes a newer immutable version'
);
select throws_ok(
  $$ select public.publish_join_questions('[{"id":"q1","prompt":"Visit https://bad.example","required":true}]') $$,
  'P0001', 'invalid join-question set', 'question URLs are rejected'
);
select throws_ok(
  $$ select public.publish_join_questions('[{"id":"q1","prompt":"Visit bad.example for details","required":true}]') $$,
  'P0001', 'invalid join-question set', 'bare domain URLs are rejected'
);
select throws_ok(
  $$ select public.publish_join_questions('[{"id":"client-id","prompt":"Forged identifier","required":true}]') $$,
  'P0001', 'invalid join-question set', 'client-selected question identifiers are rejected'
);
select throws_ok(
  $$ select public.publish_join_questions('[{"id":"q1","prompt":123,"required":true}]') $$,
  'P0001', 'invalid join-question set', 'non-string question prompts cannot be coerced into the schema'
);
select throws_ok(
  $$ select public.publish_join_questions('[{"id":"q1","prompt":"Where  are you located?","required":true}]') $$,
  'P0001', 'invalid join-question set', 'question prompts require canonical collapsed whitespace'
);

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000006', true);
select throws_ok(
  format($$ select public.submit_join_application(%L, '{"q1":"Old form"}'::jsonb) $$, :'stale_version_id'),
  'P0001', 'join questions changed; refresh and review the current questions', 'stale question version is rejected without answer remapping'
);
select throws_ok(
  format($$ select public.submit_join_application(%L, '{}'::jsonb) $$, (select version_id from public.current_join_questions())),
  'P0001', 'required join answer is missing', 'required answers fail closed'
);
select throws_ok(
  format($$ select public.submit_join_application(%L, '{"q1":123,"q2":"Camping tents"}'::jsonb) $$, (select version_id from public.current_join_questions())),
  'P0001', 'invalid join answer', 'non-string JSON answers are rejected instead of coerced to text'
);
select lives_ok(
  format($$ select public.submit_join_application(%L, '{"q1":"Our family participates locally","q2":"Camping tents"}'::jsonb) $$, (select version_id from public.current_join_questions())),
  'confirmed pending applicant submits current answers'
);
select is((select answer_snapshot -> 0 ->> 'answer' from public.my_membership_application()), 'Our family participates locally', 'applicant can read only their own current unexpired snapshot');
select throws_ok(
  format($$ select public.submit_join_application(%L, '{"q1":"Changed after submission","q2":"Camping tents"}'::jsonb) $$, (select version_id from public.current_join_questions())),
  'P0001', 'a different membership application is already pending', 'retained answer snapshot cannot be overwritten before Administrator decision'
);
reset role;
select is(
  (select answer_snapshot -> 0 ->> 'prompt' from public.membership_applications where applicant_id = 'e1000000-0000-4000-8000-000000000006'),
  'How are you connected to the community?', 'application snapshots exact question text'
);
select is(
  (select policy_snapshot from public.membership_applications where applicant_id = 'e1000000-0000-4000-8000-000000000006'),
  'approval_required', 'application snapshots mandatory approval policy'
);
reset role;
update public.membership_applications set submitted_at = now() - interval '91 days'
where applicant_id = 'e1000000-0000-4000-8000-000000000006';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000006', true);
select is((select count(*)::integer from public.my_membership_application()), 0, 'applicant cannot read answer content after the absolute pending deadline even before cleanup reaches it');
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.private_pending_members()), 0, 'Administrator cannot read answer content after the absolute pending deadline even before cleanup reaches it');
select throws_ok(
  $$ select public.decide_membership('e1000000-0000-4000-8000-000000000006', true) $$,
  'P0001', 'current pending membership application required', 'Administrator cannot approve an expired unseen application without resubmission'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000006', true);
select lives_ok(
  format($$ select public.submit_join_application(%L, '{"q1":"Our family participates locally","q2":"Camping tents"}'::jsonb) $$, (select version_id from public.current_join_questions())),
  'expired pending applicant can explicitly resubmit the current form without waiting for cleanup'
);
select is((select count(*)::integer from public.my_membership_application()), 1, 'resubmission refreshes the pending review deadline and current answer visibility');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000006', true);
select throws_ok(
  format($$ select public.submit_join_application(%L, '{"q1":"Valid","role":"administrator"}'::jsonb) $$, (select version_id from public.current_join_questions())),
  'P0001', 'invalid membership application', 'unknown authority fields are rejected'
);
reset role;
select is((select count(*)::integer from public.membership_applications where applicant_id = 'e1000000-0000-4000-8000-000000000006'), 1, 'repeat submission cannot create a duplicate application');

reset role;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'terminal-rejected@example.test', '', now(), now(), now(), '{"display_name":"Rejected Applicant"}'),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'terminal-deactivated@example.test', '', now(), now(), now(), '{"display_name":"Deactivated Applicant"}');
update public.profiles set membership_status = 'rejected', rejected_by = 'e1000000-0000-4000-8000-000000000001', rejected_at = now()
where id = 'e1000000-0000-4000-8000-000000000007';
update public.profiles set membership_status = 'deactivated', deactivated_by = 'e1000000-0000-4000-8000-000000000001', deactivated_at = now()
where id = 'e1000000-0000-4000-8000-000000000008';
insert into public.membership_applications (
  community_id, applicant_id, question_version_id, answer_snapshot, answer_count,
  submitted_at, first_submitted_at, decided_at
)
select a.community_id, 'e1000000-0000-4000-8000-000000000007', a.question_version_id,
  a.answer_snapshot, a.answer_count, now() - interval '40 days', now() - interval '40 days', now() - interval '31 days'
from public.membership_applications a where a.applicant_id = 'e1000000-0000-4000-8000-000000000006';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000007', true);
select throws_ok(
  format($$ select public.submit_join_application(%L, '{"q1":"Retry"}'::jsonb) $$, (select version_id from public.current_join_questions())),
  'P0001', 'confirmed pending applicant required', 'rejected identity cannot return to pending through application submission'
);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000008', true);
select throws_ok(
  format($$ select public.submit_join_application(%L, '{"q1":"Retry"}'::jsonb) $$, (select version_id from public.current_join_questions())),
  'P0001', 'confirmed pending applicant required', 'deactivated identity cannot return to pending through application submission'
);
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$ select public.submit_join_application(gen_random_uuid(), '{}'::jsonb) $$,
  '42501', 'permission denied for function submit_join_application', 'anonymous caller cannot submit or inspect an application'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000005', true);
select throws_ok($$ select * from public.private_pending_members() $$, 'P0001', 'active administrator required', 'Custodian cannot read pending applications or answers');
select throws_ok($$ select answer_snapshot from public.membership_applications $$, '42501', 'permission denied for table membership_applications', 'Custodian cannot query raw answer snapshots');
select throws_ok($$ select public.publish_join_questions('[]'::jsonb) $$, 'P0001', 'active administrator required', 'Custodian cannot publish questions');

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.profiles where id = 'e1000000-0000-4000-8000-000000000006'), 0, 'Administrator uses the bounded application view rather than raw pending profile access');
select is((select count(*)::integer from public.private_pending_members()), 1, 'Administrator sees exactly the submitted pending application');
select is((select confirmed_email from public.private_pending_members()), 'applicant@example.test', 'Administrator sees confirmed Auth email only for membership review');
select lives_ok($$ select public.decide_membership('e1000000-0000-4000-8000-000000000006', true) $$, 'Administrator activates applicant as Regular');
select is((select membership_status::text from public.profiles where id = 'e1000000-0000-4000-8000-000000000006'), 'active', 'approval activates the applicant');
select is((select count(*)::integer from public.community_roles where user_id = 'e1000000-0000-4000-8000-000000000006' and role = 'member'), 1, 'approval grants only baseline member role');

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$ select public.update_my_profile_settings('  Gear   Owner Updated  ', 'Happy to share camping gear', '+15125550122', 'Text after 5 PM') $$,
  'active member updates bounded private settings'
);
select is((select display_name from public.get_my_profile_settings()), 'Gear Owner Updated', 'display-name whitespace is normalized and collapsed');
select is((select confirmed_email from public.get_my_profile_settings()), 'gear-owner@example.test', 'confirmed Auth email is authoritative');
select throws_ok(
  $$ select public.update_my_profile_settings('Gear Owner', '', '512-555-0122', '') $$,
  'P0001', 'invalid profile settings', 'non-E.164 coordination phone is rejected'
);
select throws_ok(
  $$ select public.update_my_profile_settings(repeat('n', 81), '', '', '') $$,
  'P0001', 'invalid profile settings', 'display names over the approved eighty-character bound are rejected'
);
select throws_ok(
  $$ select public.update_my_profile_settings('Gear Owner', '', '', repeat('n', 161)) $$,
  'P0001', 'invalid profile settings', 'coordination preferences over the approved 160-character bound are rejected'
);
select throws_ok($$ select phone_e164 from public.member_profile_settings $$, '42501', 'permission denied for table member_profile_settings', 'raw private profile settings are unavailable');

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000004', true);
select is(public.active_member_introduction('e1000000-0000-4000-8000-000000000002'), 'Happy to share camping gear', 'active same-community member can view one exact introduction');

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
select lives_ok($$ select public.create_individual_supply('Contact test tent', '', 'tents-shelters', 1, 'listed', 'good') $$, 'owner creates contact-test listing');
select cmp_ok(
  (select count(*)::integer from public.private_inventory_contacts((select id from public.supplies where title = 'Contact test tent'))),
  '>', 1, 'individual owner receives a contextual active-contact chooser only for an owned donation workflow'
);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', true);
select is(
  (select custodian_name from public.private_supply_detail((select id from public.supplies where title = 'Contact test tent'))),
  'Gear Owner Updated', 'exact canonical detail preserves the authoritative Stored-with name without broad profile access'
);
select lives_ok(
  $$ select public.update_my_profile_settings('Loan Borrower', '', '+15125550123', 'Call on arrival') $$,
  'borrower saves private loan contact details'
);
select lives_ok(
  $$ select public.request_gear_loan((select id from public.supplies where title = 'Contact test tent'), 1, current_date + 3, current_date + 4, '') $$,
  'borrower creates formal request before any contact disclosure'
);
select is((select borrower_name from public.private_gear_loans() order by id limit 1), 'Loan Borrower', 'exact loan workspace preserves contextual participant names without broad profile access');
select is(
  (select count(*)::integer from public.loan_contact_details((select id from public.gear_loans where borrower_id = 'e1000000-0000-4000-8000-000000000003' order by created_at desc limit 1))),
  0, 'pending request exposes no contact details'
);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$ select public.approve_gear_loan((select id from public.gear_loans where borrower_id = 'e1000000-0000-4000-8000-000000000003' order by created_at desc limit 1)) $$,
  'authoritative approval records the individual owner as handoff contact'
);
select is(
  (select handoff_contact_id from public.gear_loans where borrower_id = 'e1000000-0000-4000-8000-000000000003' order by created_at desc limit 1),
  'e1000000-0000-4000-8000-000000000002'::uuid, 'handoff contact is captured atomically at approval'
);
select is(
  (select email from public.loan_contact_details((select id from public.gear_loans where borrower_id = 'e1000000-0000-4000-8000-000000000003' order by created_at desc limit 1))),
  'loan-borrower@example.test', 'handoff contact sees borrower confirmed email while approved'
);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', true);
select is(
  (select phone_e164 from public.loan_contact_details((select id from public.gear_loans where borrower_id = 'e1000000-0000-4000-8000-000000000003' order by created_at desc limit 1))),
  '+15125550122', 'borrower sees owner phone while approved'
);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000004', true);
select is(
  (select count(*)::integer from public.loan_contact_details((select id from public.gear_loans where borrower_id = 'e1000000-0000-4000-8000-000000000003' order by created_at desc limit 1))),
  0, 'unrelated active member receives no contact details'
);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', true);
select lives_ok(
  $$ select public.cancel_gear_loan((select id from public.gear_loans where borrower_id = 'e1000000-0000-4000-8000-000000000003' order by created_at desc limit 1), 'borrower cancelled') $$,
  'borrower cancels approved loan through formal workflow'
);
select is(
  (select count(*)::integer from public.loan_contact_details((select id from public.gear_loans where borrower_id = 'e1000000-0000-4000-8000-000000000003' order by created_at desc limit 1))),
  0, 'contact disclosure ends immediately on cancellation'
);
select throws_ok(
  $$ update public.gear_loans set handoff_contact_id = 'e1000000-0000-4000-8000-000000000004' where borrower_id = 'e1000000-0000-4000-8000-000000000003' $$,
  '42501', 'permission denied for table gear_loans', 'client cannot rewrite historical handoff contact'
);

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.create_group_supply('Group contact test', '', 'other-gear', 1, 'e1000000-0000-4000-8000-000000000004', 'listed', 'good') $$,
  'Administrator creates group gear stored with a Regular member'
);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', true);
select lives_ok(
  $$ select public.request_gear_loan((select id from public.supplies where title = 'Group contact test'), 1, current_date + 8, current_date + 9, '') $$,
  'borrower requests group gear without choosing a contact'
);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000005', true);
select lives_ok(
  $$ select public.approve_gear_loan((select id from public.gear_loans where supply_id = (select id from public.supplies where title = 'Group contact test'))) $$,
  'approving Custodian becomes the group-loan handoff contact'
);
select is(
  (select handoff_contact_id from public.gear_loans where supply_id = (select id from public.supplies where title = 'Group contact test')),
  'e1000000-0000-4000-8000-000000000005'::uuid, 'Regular Stored-with contact is not disclosed as group-loan authority'
);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', true);
select is(
  (select email from public.loan_contact_details((select id from public.gear_loans where supply_id = (select id from public.supplies where title = 'Group contact test')))),
  'custodian@example.test', 'borrower sees the recorded authorized Custodian while approval remains current'
);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select lives_ok($$ select public.set_access_level('e1000000-0000-4000-8000-000000000005', 'member') $$, 'Administrator removes Custodian authority through ordinary role workflow');
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::integer from public.loan_contact_details((select id from public.gear_loans where supply_id = (select id from public.supplies where title = 'Group contact test')))),
  0, 'group contact disclosure ends when recorded handoff authority ends'
);

select ok(not has_function_privilege('authenticated', 'public.redact_expired_membership_answers(integer)', 'EXECUTE'), 'authenticated cannot run answer retention job');
select ok(has_function_privilege('service_role', 'public.redact_expired_membership_answers(integer)', 'EXECUTE'), 'only service role may run bounded answer retention job');
select throws_ok($$ select public.redact_expired_membership_answers(0) $$, '42501', 'permission denied for function redact_expired_membership_answers', 'authenticated caller cannot exploit invalid retention input');
reset role;
select is(
  (select count(*)::integer from cron.job where jobname = 'gear-share-membership-answer-redaction' and schedule = '17 3 * * *' and command = 'select public.redact_expired_membership_answers(500);'),
  1, 'one checked-in daily bounded database redaction schedule exists'
);

update public.membership_applications set submitted_at = now() - interval '91 days', decided_at = now() - interval '1 day'
where applicant_id = 'e1000000-0000-4000-8000-000000000006';
set local role service_role;
select is(public.redact_expired_membership_answers(100), 2, 'service retention pass enforces both the absolute pending maximum and terminal decision deadline');
reset role;
select is((select answer_snapshot from public.membership_applications where applicant_id = 'e1000000-0000-4000-8000-000000000006'), '[]'::jsonb, 'retention preserves minimal application audit without answer content');
select is((select answer_count::integer from public.membership_applications where applicant_id = 'e1000000-0000-4000-8000-000000000006'), 2, 'redaction retains only the bounded answer count rather than copied text');
select is((select answer_snapshot from public.membership_applications where applicant_id = 'e1000000-0000-4000-8000-000000000007'), '[]'::jsonb, 'terminal answers redact thirty days after decision even before the absolute maximum');

select throws_ok(
  $$ insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
     values ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'hostile-name@example.test', '', now(), now(), now(), '{"display_name":"https://hostile.example"}') $$,
  'P0001', 'invalid display name', 'crafted signup metadata cannot bypass profile text validation'
);

select * from finish();
rollback;
