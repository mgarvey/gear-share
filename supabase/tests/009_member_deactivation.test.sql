begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into public.communities (id, slug, name)
values ('7b000000-0000-4000-8000-000000000009', 'deactivation-other', 'Deactivation Other');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '82000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'deactivate-steward@example.test', '', now(), now(), now(), '{"display_name":"Deactivation Steward"}'),
  ('00000000-0000-0000-0000-000000000000', '82000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'deactivate-successor@example.test', '', now(), now(), now(), '{"display_name":"Deactivation Successor"}'),
  ('00000000-0000-0000-0000-000000000000', '82000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'deactivate-individual@example.test', '', now(), now(), now(), '{"display_name":"Deactivation Individual"}'),
  ('00000000-0000-0000-0000-000000000000', '82000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'deactivate-borrower@example.test', '', now(), now(), now(), '{"display_name":"Deactivation Borrower"}'),
  ('00000000-0000-0000-0000-000000000000', '82000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'deactivate-member@example.test', '', now(), now(), now(), '{"display_name":"Deactivation Member"}'),
  ('00000000-0000-0000-0000-000000000000', '82000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'deactivate-cross@example.test', '', now(), now(), now(), '{"display_name":"Deactivation Cross"}');

update public.profiles
set community_id = '7b000000-0000-4000-8000-000000000009', membership_status = 'active'
where id = '82000000-0000-4000-8000-000000000006';

select public.bootstrap_founding_steward(
  '82000000-0000-4000-8000-000000000001',
  'local-test',
  'member deactivation fixture'
);

insert into public.membership_applications (community_id, applicant_id, question_version_id, answer_snapshot, answer_count)
select p.community_id, p.id, q.id, '[]'::jsonb, 0
from public.profiles p join public.join_question_versions q on q.community_id = p.community_id and q.is_current
where p.membership_status = 'pending' and p.id <> '82000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
select public.decide_membership('82000000-0000-4000-8000-000000000002', true);
select public.decide_membership('82000000-0000-4000-8000-000000000003', true);
select public.decide_membership('82000000-0000-4000-8000-000000000004', true);
select public.decide_membership('82000000-0000-4000-8000-000000000005', true);
select public.set_steward('82000000-0000-4000-8000-000000000002', true);

reset role;
insert into public.supplies (id, community_id, title, description, category, condition, ownership_kind, owner_id, custodian_id, quantity_total, listing_status, created_by)
select fixture.id, c.id, fixture.title, 'Deactivation test fixture', 'other-gear', 'good', fixture.kind::public.ownership_kind,
  fixture.owner_id, '82000000-0000-4000-8000-000000000003', 3, 'listed', '82000000-0000-4000-8000-000000000003'
from public.communities c
cross join (values
  ('83000000-0000-4000-8000-000000000001'::uuid, 'Individual deactivation gear', 'individual', '82000000-0000-4000-8000-000000000003'::uuid),
  ('83000000-0000-4000-8000-000000000002'::uuid, 'Group deactivation gear', 'group', null::uuid)
) fixture(id, title, kind, owner_id)
where c.slug = 'gear-share-community';

insert into public.gear_loans (id, community_id, supply_id, borrower_id, custodian_at_request_id, quantity, start_date, end_date, status, borrower_note)
select fixture.id, c.id, fixture.supply_id, '82000000-0000-4000-8000-000000000004',
  '82000000-0000-4000-8000-000000000003', 1, date '2027-11-01', date '2027-11-03', fixture.status::public.gear_loan_status, fixture.note
from public.communities c
cross join (values
  ('84000000-0000-4000-8000-000000000001'::uuid, '83000000-0000-4000-8000-000000000001'::uuid, 'pending', 'individual pending'),
  ('84000000-0000-4000-8000-000000000002'::uuid, '83000000-0000-4000-8000-000000000001'::uuid, 'approved', 'individual approved'),
  ('84000000-0000-4000-8000-000000000003'::uuid, '83000000-0000-4000-8000-000000000001'::uuid, 'checked_out', 'individual checked out'),
  ('84000000-0000-4000-8000-000000000004'::uuid, '83000000-0000-4000-8000-000000000002'::uuid, 'approved', 'Group approved')
) fixture(id, supply_id, status, note)
where c.slug = 'gear-share-community';

set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
select is((select affected_listings from public.deactivation_impact('82000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000002')), 2::bigint, 'impact reports both affected listings');
select is((select requests_to_cancel from public.deactivation_impact('82000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000002')), 2::bigint, 'impact reports pending and approved individual cancellations');
select is((select checked_out_loans from public.deactivation_impact('82000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000002')), 1::bigint, 'impact reports checked-out individual handoff');
select throws_ok($$ select public.deactivate_member('82000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000003') $$, 'P0001', 'replacement contact must be distinct from target', 'target cannot be their own replacement contact');
select is((select affected_listings from public.deactivation_impact('82000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000005')), 2::bigint, 'Regular user may be selected as replacement contact');
select throws_ok($$ select public.deactivate_member('82000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000006') $$, 'P0001', 'replacement contact must be an active same-community member', 'cross-community member cannot be replacement contact');
select is((select membership_status::text from public.profiles where id = '82000000-0000-4000-8000-000000000003'), 'active', 'invalid successor attempts leave membership active');
select is((select count(*) from public.supplies where custodian_id = '82000000-0000-4000-8000-000000000003'), 2::bigint, 'invalid successor attempts roll back all custody changes');

select lives_ok($$ select public.set_steward('82000000-0000-4000-8000-000000000002', false) $$, 'second steward can be removed for only-steward test');
select throws_ok($$ select public.deactivate_member('82000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000005') $$, 'P0001', 'cannot deactivate the last active administrator', 'only active Administrator cannot be deactivated');
select ok(public.is_active_steward('7b000000-0000-4000-8000-000000000001'), 'failed only-steward deactivation preserves steward authority');
select lives_ok($$ select public.set_steward('82000000-0000-4000-8000-000000000002', true) $$, 'successor steward is restored for valid deactivation');

select lives_ok($$ select public.deactivate_member('82000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000005') $$, 'valid deactivation commits atomically with Regular user contact');
reset role;
select is((select membership_status::text from public.profiles where id = '82000000-0000-4000-8000-000000000003'), 'deactivated', 'target membership is terminally deactivated');
set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
select ok((select ownership_kind = 'individual' and owner_id = '82000000-0000-4000-8000-000000000003' and custodian_id = '82000000-0000-4000-8000-000000000005' and listing_status = 'unlisted' from public.supplies where id = '83000000-0000-4000-8000-000000000001'), 'individual ownership is preserved, contact transferred, and listing forced unlisted');
select is((select count(*) from public.gear_loans where supply_id = '83000000-0000-4000-8000-000000000001' and status = 'cancelled'), 2::bigint, 'pending and approved individual loans are cancelled');
select is((select count(*) from public.gear_loans where supply_id = '83000000-0000-4000-8000-000000000001' and status = 'cancelled' and cancelled_by = '82000000-0000-4000-8000-000000000001' and cancelled_at is not null and cancellation_reason = 'owner membership deactivated'), 2::bigint, 'deactivation cancellations carry actor, time, and reason');
select is((select status::text from public.gear_loans where id = '84000000-0000-4000-8000-000000000003'), 'checked_out', 'checked-out individual loan remains checked out for handoff');
select ok((select ownership_kind = 'group' and custodian_id = '82000000-0000-4000-8000-000000000005' and listing_status = 'listed' from public.supplies where id = '83000000-0000-4000-8000-000000000002'), 'Group listing retains listed state while contact transfers');
select is((select status::text from public.gear_loans where id = '84000000-0000-4000-8000-000000000004'), 'approved', 'Group loan state remains unchanged');

select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.supplies), 0::bigint, 'deactivated member immediately loses protected catalog access');
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000002', true);
select lives_ok($$ select public.return_gear_loan('84000000-0000-4000-8000-000000000003') $$, 'any active Administrator can record return of checked-out inactive-owner gear');
select is((select returned_by from public.gear_loans where id = '84000000-0000-4000-8000-000000000003'), '82000000-0000-4000-8000-000000000002'::uuid, 'return records Administrator rather than replacement contact');
select throws_ok($$ select public.request_gear_loan('83000000-0000-4000-8000-000000000001', 1, '2027-12-01', '2027-12-02', 'prohibited') $$, 'P0001', 'listing is not available for requests', 'inactive-individual listing accepts no new request');
select throws_ok($$ select public.approve_gear_loan('84000000-0000-4000-8000-000000000002') $$, 'P0001', 'request is no longer pending', 'successor cannot approve the cancelled individual request');

select * from finish();
rollback;
