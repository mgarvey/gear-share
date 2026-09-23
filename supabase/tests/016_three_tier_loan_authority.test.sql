begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into public.communities (id, slug, name)
values ('7b000000-0000-4000-8000-000000000016', 'three-tier-loan-test', 'Three Tier Loan Test');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'loan-admin@example.test', '', now(), now(), now(), '{"display_name":"Loan Admin"}'),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'loan-custodian@example.test', '', now(), now(), now(), '{"display_name":"Loan Custodian"}'),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'loan-owner@example.test', '', now(), now(), now(), '{"display_name":"Loan Owner"}'),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'loan-contact@example.test', '', now(), now(), now(), '{"display_name":"Loan Contact"}'),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'loan-borrower@example.test', '', now(), now(), now(), '{"display_name":"Loan Borrower"}');

update public.profiles
set community_id = '7b000000-0000-4000-8000-000000000016', membership_status = 'active',
    approved_by = 'c1000000-0000-4000-8000-000000000001', approved_at = now()
where id in (
  'c1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000002',
  'c1000000-0000-4000-8000-000000000003',
  'c1000000-0000-4000-8000-000000000004',
  'c1000000-0000-4000-8000-000000000005'
);

insert into public.community_roles (community_id, user_id, role, granted_by)
select '7b000000-0000-4000-8000-000000000016', fixture.user_id, fixture.role, 'c1000000-0000-4000-8000-000000000001'
from (values
  ('c1000000-0000-4000-8000-000000000001'::uuid, 'member'::public.app_role),
  ('c1000000-0000-4000-8000-000000000001'::uuid, 'steward'::public.app_role),
  ('c1000000-0000-4000-8000-000000000002'::uuid, 'member'::public.app_role),
  ('c1000000-0000-4000-8000-000000000002'::uuid, 'custodian'::public.app_role),
  ('c1000000-0000-4000-8000-000000000003'::uuid, 'member'::public.app_role),
  ('c1000000-0000-4000-8000-000000000004'::uuid, 'member'::public.app_role),
  ('c1000000-0000-4000-8000-000000000005'::uuid, 'member'::public.app_role)
) fixture(user_id, role);

insert into public.supplies (
  id, community_id, title, description, category, condition, ownership_kind, owner_id,
  custodian_id, quantity_total, listing_status, created_by
) values
  ('c2000000-0000-4000-8000-000000000001', '7b000000-0000-4000-8000-000000000016', 'Group stove', '', 'camp-kitchen', 'good', 'group', null, 'c1000000-0000-4000-8000-000000000004', 3, 'listed', 'c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000002', '7b000000-0000-4000-8000-000000000016', 'Owner tent', '', 'tents-shelters', 'good', 'individual', 'c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000004', 1, 'listed', 'c1000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000004', true);
select lives_ok(
  $$ select id from public.request_gear_loan('c2000000-0000-4000-8000-000000000001', 1, date '2028-03-01', date '2028-03-02', 'contact borrows group') $$,
  'Stored with contact may borrow group gear as a Regular user'
);
select throws_ok(
  $$ select id from public.approve_gear_loan((select id from public.gear_loans where borrower_note = 'contact borrows group')) $$,
  'P0001', 'current authorized manager required',
  'Stored with contact cannot approve group loan'
);

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$ select id from public.approve_gear_loan((select id from public.gear_loans where borrower_note = 'contact borrows group')) $$,
  'Custodian can approve group loan'
);
select lives_ok(
  $$ select id from public.checkout_gear_loan((select id from public.gear_loans where borrower_note = 'contact borrows group')) $$,
  'Custodian can check out group loan'
);
select lives_ok(
  $$ select id from public.return_gear_loan((select id from public.gear_loans where borrower_note = 'contact borrows group')) $$,
  'Custodian can return group loan'
);
select is((select status::text from public.gear_loans where borrower_note = 'contact borrows group'), 'returned'::text, 'group loan reaches returned history');

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000005', true);
select lives_ok(
  $$ select id from public.request_gear_loan('c2000000-0000-4000-8000-000000000002', 1, date '2028-04-01', date '2028-04-05', 'individual checked out') $$,
  'Regular user can request individual gear'
);
select lives_ok(
  $$ select id from public.request_gear_loan('c2000000-0000-4000-8000-000000000002', 1, date '2028-05-01', date '2028-05-02', 'borrower cancellation') $$,
  'borrower can create a second request'
);
select lives_ok(
  $$ select id from public.cancel_gear_loan((select id from public.gear_loans where borrower_note = 'borrower cancellation'), 'plans changed') $$,
  'borrower can cancel their request'
);

reset role;
update public.gear_loans
set id = 'c3000000-0000-4000-8000-000000000001'
where borrower_note = 'individual checked out';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select id from public.request_gear_loan('c2000000-0000-4000-8000-000000000002', 1, date '2028-06-01', date '2028-06-02', 'owner self request') $$,
  'P0001', 'individual owners cannot borrow their own gear',
  'individual owner cannot request their own gear even when contact differs'
);
select is((select count(*) from public.gear_loans where borrower_note = 'individual checked out'), 1::bigint, 'individual owner can read their loan request');

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.gear_loans where borrower_note = 'individual checked out'), 0::bigint, 'Custodian has no individual-loan visibility');
select throws_ok(
  $$ select id from public.approve_gear_loan('c3000000-0000-4000-8000-000000000001') $$,
  'P0001', 'current authorized manager required',
  'Custodian cannot approve an individual loan'
);

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.gear_loans where borrower_note = 'individual checked out'), 1::bigint, 'Administrator has read-only individual-loan oversight');
select throws_ok(
  $$ select id from public.approve_gear_loan('c3000000-0000-4000-8000-000000000001') $$,
  'P0001', 'current authorized manager required',
  'Administrator cannot decide an active owner individual loan'
);

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000003', true);
select lives_ok(
  $$ select id from public.approve_gear_loan('c3000000-0000-4000-8000-000000000001') $$,
  'individual owner can approve their loan'
);
select lives_ok(
  $$ select id from public.checkout_gear_loan('c3000000-0000-4000-8000-000000000001') $$,
  'individual owner can check out their loan'
);

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.deactivate_member('c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000004') $$,
  'Administrator can deactivate owner while preserving checked-out loan'
);
select is((select status::text from public.gear_loans where borrower_note = 'individual checked out'), 'checked_out'::text, 'checked-out individual loan survives deactivation');

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$ select id from public.return_gear_loan('c3000000-0000-4000-8000-000000000001') $$,
  'P0001', 'checked-out loan and current authorized manager required',
  'replacement Stored with contact cannot return inactive-owner loan'
);

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select id from public.return_gear_loan('c3000000-0000-4000-8000-000000000001') $$,
  'P0001', 'checked-out loan and current authorized manager required',
  'Custodian cannot return an inactive-owner individual loan'
);

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select id from public.return_gear_loan('c3000000-0000-4000-8000-000000000001') $$,
  'Administrator can record return after owner deactivation'
);
select is((select status::text from public.gear_loans where borrower_note = 'individual checked out'), 'returned'::text, 'inactive-owner loan reaches returned history');
select is((select count(*) from public.gear_loans where borrower_note = 'individual checked out'), 1::bigint, 'Administrator retains individual-loan oversight after return');

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000005', true);
select is((select count(*) from public.gear_loans where borrower_note = 'individual checked out'), 1::bigint, 'borrower retains returned individual-loan history');

select * from finish();
rollback;
