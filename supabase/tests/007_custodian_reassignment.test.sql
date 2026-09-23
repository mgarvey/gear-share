begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'contact-admin@example.test', '', now(), now(), now(), '{"display_name":"Contact Admin"}'),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'contact-old@example.test', '', now(), now(), now(), '{"display_name":"Old Contact"}'),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'contact-new@example.test', '', now(), now(), now(), '{"display_name":"New Contact"}'),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'contact-borrower@example.test', '', now(), now(), now(), '{"display_name":"Contact Borrower"}'),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'contact-custodian@example.test', '', now(), now(), now(), '{"display_name":"Global Custodian"}');

select public.bootstrap_founding_steward('70000000-0000-4000-8000-000000000001', 'local-test', 'contact reassignment fixture');
insert into public.membership_applications (community_id, applicant_id, question_version_id, answer_snapshot, answer_count)
select p.community_id, p.id, q.id, '[]'::jsonb, 0
from public.profiles p join public.join_question_versions q on q.community_id = p.community_id and q.is_current
where p.membership_status = 'pending' and p.id <> '70000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', true);
select public.decide_membership('70000000-0000-4000-8000-000000000002', true);
select public.decide_membership('70000000-0000-4000-8000-000000000003', true);
select public.decide_membership('70000000-0000-4000-8000-000000000004', true);
select public.decide_membership('70000000-0000-4000-8000-000000000005', true);
select public.set_access_level('70000000-0000-4000-8000-000000000005', 'custodian');
select public.create_group_supply('Reassignment stove', 'Group stove', 'camp-kitchen', 1, '70000000-0000-4000-8000-000000000002', 'listed', 'good');

select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000004', true);
select public.request_gear_loan((select id from public.supplies where title = 'Reassignment stove'), 1, '2027-04-10', '2027-04-12', 'contact audit test');

select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000002', true);
select throws_ok(format($$ select public.approve_gear_loan(%L) $$, (select id from public.gear_loans where borrower_note = 'contact audit test')), 'P0001', 'pending request not found', 'original Stored with contact cannot discover or approve the request');

select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000005', true);
select lives_ok(format($$ select public.approve_gear_loan(%L) $$, (select id from public.gear_loans where borrower_note = 'contact audit test')), 'global Custodian approves group request');

select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', true);
select lives_ok(format($$ select public.set_supply_contact(%L, '70000000-0000-4000-8000-000000000003') $$, (select id from public.supplies where title = 'Reassignment stove')), 'Administrator changes Stored with contact');
select is((select custodian_id from public.supplies where title = 'Reassignment stove'), '70000000-0000-4000-8000-000000000003'::uuid, 'listing records new Stored with contact');
select is((select custodian_at_request_id from public.gear_loans where borrower_note = 'contact audit test'), '70000000-0000-4000-8000-000000000002'::uuid, 'request-time contact remains immutable');
select is((select decided_by from public.gear_loans where borrower_note = 'contact audit test'), '70000000-0000-4000-8000-000000000005'::uuid, 'decision actor remains the global Custodian');

select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000003', true);
select throws_ok(format($$ select public.checkout_gear_loan(%L) $$, (select id from public.gear_loans where borrower_note = 'contact audit test')), 'P0001', 'approved request and current authorized manager required', 'new Stored with contact receives no checkout authority');

select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000005', true);
select lives_ok(format($$ select public.checkout_gear_loan(%L) $$, (select id from public.gear_loans where borrower_note = 'contact audit test')), 'global Custodian retains checkout authority after contact change');
select lives_ok(format($$ select public.return_gear_loan(%L) $$, (select id from public.gear_loans where borrower_note = 'contact audit test')), 'global Custodian completes return');
select is((select returned_by from public.gear_loans where borrower_note = 'contact audit test'), '70000000-0000-4000-8000-000000000005'::uuid, 'return records Custodian rather than contact');

select * from finish();
rollback;
