begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into public.communities (id, slug, name)
values ('7b000000-0000-4000-8000-000000000014', 'three-tier-role-test', 'Three Tier Role Test');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'three-tier-admin@example.test', '', now(), now(), now(), '{"display_name":"Three Tier Admin"}'),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'three-tier-second@example.test', '', now(), now(), now(), '{"display_name":"Three Tier Second"}'),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'three-tier-custodian@example.test', '', now(), now(), now(), '{"display_name":"Three Tier Custodian"}'),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'three-tier-member@example.test', '', now(), now(), now(), '{"display_name":"Three Tier Member"}');

update public.profiles
set community_id = '7b000000-0000-4000-8000-000000000014',
    membership_status = 'active',
    approved_by = 'a1000000-0000-4000-8000-000000000001',
    approved_at = now()
where id in (
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000003',
  'a1000000-0000-4000-8000-000000000004'
);

insert into public.community_roles (community_id, user_id, role, granted_by)
select '7b000000-0000-4000-8000-000000000014', fixture.user_id, fixture.role, 'a1000000-0000-4000-8000-000000000001'
from (values
  ('a1000000-0000-4000-8000-000000000001'::uuid, 'member'::public.app_role),
  ('a1000000-0000-4000-8000-000000000001'::uuid, 'steward'::public.app_role),
  ('a1000000-0000-4000-8000-000000000002'::uuid, 'member'::public.app_role),
  ('a1000000-0000-4000-8000-000000000003'::uuid, 'member'::public.app_role),
  ('a1000000-0000-4000-8000-000000000004'::uuid, 'member'::public.app_role)
) fixture(user_id, role);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select is(public.current_access_level('7b000000-0000-4000-8000-000000000014')::text, 'steward'::text, 'stored steward resolves to Administrator');
select ok(public.is_active_administrator('7b000000-0000-4000-8000-000000000014'), 'Administrator helper recognizes stored steward role');
select ok(public.is_active_inventory_manager('7b000000-0000-4000-8000-000000000014'), 'Administrator inherits inventory management');
select throws_ok(
  $$ select public.set_access_level('a1000000-0000-4000-8000-000000000004', null::public.app_role) $$,
  'P0001', 'unsupported access level',
  'null access level cannot remove roles'
);
select throws_ok(
  $$ select public.set_steward('a1000000-0000-4000-8000-000000000004', null::boolean) $$,
  'P0001', 'make_steward is required',
  'legacy role RPC rejects a null decision'
);

select lives_ok(
  $$ select public.set_access_level('a1000000-0000-4000-8000-000000000003', 'custodian') $$,
  'Administrator can grant Custodian access'
);
select ok(
  exists (select 1 from public.community_roles where user_id = 'a1000000-0000-4000-8000-000000000003' and role = 'custodian'),
  'Custodian role is stored'
);
select ok(
  exists (select 1 from public.role_audit where target_user_id = 'a1000000-0000-4000-8000-000000000003' and role = 'custodian' and action = 'promote'),
  'Custodian grant is audited'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', true);
select is(public.current_access_level('7b000000-0000-4000-8000-000000000014')::text, 'custodian'::text, 'Custodian resolves to Custodian');
select ok(public.is_active_custodian('7b000000-0000-4000-8000-000000000014'), 'Custodian helper recognizes role');
select ok(public.is_active_inventory_manager('7b000000-0000-4000-8000-000000000014'), 'Custodian has inventory management');
select ok(not public.is_active_administrator('7b000000-0000-4000-8000-000000000014'), 'Custodian is not Administrator');
select throws_ok(
  $$ select public.set_access_level('a1000000-0000-4000-8000-000000000004', 'custodian') $$,
  'P0001', 'active administrator required',
  'Custodian cannot assign roles'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000004', true);
select is(public.current_access_level('7b000000-0000-4000-8000-000000000014')::text, 'member'::text, 'ordinary member resolves to Regular user');
select ok(not public.is_active_inventory_manager('7b000000-0000-4000-8000-000000000014'), 'Regular user has no global inventory authority');
select throws_ok(
  $$ insert into public.community_roles (community_id, user_id, role, granted_by)
     values ('7b000000-0000-4000-8000-000000000014', 'a1000000-0000-4000-8000-000000000004', 'custodian', 'a1000000-0000-4000-8000-000000000004') $$,
  '42501', 'permission denied for table community_roles',
  'authenticated clients cannot grant roles directly'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.set_access_level('a1000000-0000-4000-8000-000000000002', 'steward') $$,
  'Administrator can grant a second Administrator role'
);
reset role;
select is((select count(*) from public.private_notifications where event_type = 'role_promoted_admin' and recipient_user_id = 'a1000000-0000-4000-8000-000000000002'), 0::bigint, 'newly promoted Administrator does not receive duplicate Administrator-directed notification copy');
select is((select count(*) from public.transactional_email_outbox where event_type = 'role_promoted_admin' and recipient_user_id = 'a1000000-0000-4000-8000-000000000001'), 0::bigint, 'initiating Administrator receives no role-change email');

insert into public.community_roles (community_id, user_id, role, granted_by)
values ('7b000000-0000-4000-8000-000000000014', 'a1000000-0000-4000-8000-000000000002', 'custodian', 'a1000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.set_access_level('a1000000-0000-4000-8000-000000000002', 'steward') $$,
  'role assignment normalizes a legacy dual-role account'
);
select is(
  (select count(*) from public.community_roles where user_id = 'a1000000-0000-4000-8000-000000000002' and role in ('steward', 'custodian')),
  1::bigint,
  'legacy dual-role account retains one effective elevated role'
);
select ok(
  exists (select 1 from public.role_audit where target_user_id = 'a1000000-0000-4000-8000-000000000002' and role = 'custodian' and action = 'demote'),
  'dual-role normalization audits removed Custodian access'
);
select lives_ok(
  $$ select public.set_access_level('a1000000-0000-4000-8000-000000000001', 'custodian') $$,
  'Administrator can become Custodian while another Administrator remains'
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select public.set_access_level('a1000000-0000-4000-8000-000000000002', 'member') $$,
  'P0001', 'cannot remove the last active administrator',
  'last Administrator cannot be demoted'
);

select * from finish();
rollback;
