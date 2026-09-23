begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into public.communities (id, slug, name)
values ('7b000000-0000-4000-8000-000000000008', 'role-other', 'Role Other');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'role-founder@example.test', '', now(), now(), now(), '{"display_name":"Role Founder"}'),
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'role-second@example.test', '', now(), now(), now(), '{"display_name":"Role Second"}'),
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'role-member@example.test', '', now(), now(), now(), '{"display_name":"Role Member"}'),
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'role-inactive@example.test', '', now(), now(), now(), '{"display_name":"Role Inactive"}'),
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'role-cross@example.test', '', now(), now(), now(), '{"display_name":"Role Cross"}');

update public.profiles
set community_id = '7b000000-0000-4000-8000-000000000008', membership_status = 'active'
where id = '81000000-0000-4000-8000-000000000005';

select public.bootstrap_founding_steward(
  '81000000-0000-4000-8000-000000000001',
  'local-test',
  'steward role fixture'
);

insert into public.membership_applications (community_id, applicant_id, question_version_id, answer_snapshot, answer_count)
select p.community_id, p.id, q.id, '[]'::jsonb, 0
from public.profiles p join public.join_question_versions q on q.community_id = p.community_id and q.is_current
where p.membership_status = 'pending' and p.id <> '81000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select public.decide_membership('81000000-0000-4000-8000-000000000002', true);
select public.decide_membership('81000000-0000-4000-8000-000000000003', true);
select public.decide_membership('81000000-0000-4000-8000-000000000004', true);

select lives_ok(
  $$ select public.set_steward('81000000-0000-4000-8000-000000000002', true) $$,
  'active same-community member can be promoted'
);
select ok(
  exists (
    select 1 from public.community_roles
    where user_id = '81000000-0000-4000-8000-000000000002' and role = 'steward'
  ),
  'promotion creates the steward role'
);
select ok(
  exists (
    select 1 from public.role_audit
    where target_user_id = '81000000-0000-4000-8000-000000000002'
      and action = 'promote'
      and actor_user_id = '81000000-0000-4000-8000-000000000001'
      and occurred_at is not null
  ),
  'promotion records acting steward and time'
);
select throws_ok(
  $$ insert into public.community_roles (community_id, user_id, role, granted_by)
     values ('7b000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000003', 'steward', '81000000-0000-4000-8000-000000000003') $$,
  '42501', 'permission denied for table community_roles',
  'authenticated client cannot mutate role rows directly'
);

reset role;
update public.profiles
set membership_status = 'deactivated',
    deactivated_by = '81000000-0000-4000-8000-000000000001',
    deactivated_at = now()
where id = '81000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.set_steward('81000000-0000-4000-8000-000000000004', true) $$,
  'P0001', 'active same-community target required',
  'inactive member cannot be promoted'
);
select throws_ok(
  $$ select public.set_steward('81000000-0000-4000-8000-000000000005', true) $$,
  'P0001', 'active same-community target required',
  'cross-community member cannot be promoted'
);
select lives_ok(
  $$ select public.set_steward('81000000-0000-4000-8000-000000000002', false) $$,
  'steward can be demoted while another active steward remains'
);
select ok(
  exists (
    select 1 from public.role_audit
    where target_user_id = '81000000-0000-4000-8000-000000000002'
      and action = 'demote'
      and actor_user_id = '81000000-0000-4000-8000-000000000001'
      and occurred_at is not null
  ),
  'demotion records acting steward and time'
);
select throws_ok(
  $$ select public.set_steward('81000000-0000-4000-8000-000000000001', false) $$,
  'P0001', 'cannot remove the last active administrator',
  'last active Administrator cannot be demoted'
);
select lives_ok(
  $$ select public.set_steward('81000000-0000-4000-8000-000000000002', true) $$,
  'second steward can be restored for transferable administration'
);
select lives_ok(
  $$ select public.set_steward('81000000-0000-4000-8000-000000000001', false) $$,
  'founding steward may self-demote when another steward remains'
);
reset role;
select is(
  (select count(*) from public.community_roles where role = 'steward'),
  1::bigint,
  'authoritative audit confirms self-demotion leaves exactly one active steward role'
);
select is(
  (select user_id from public.founding_steward_bootstrap),
  '81000000-0000-4000-8000-000000000001'::uuid,
  'founding designation remains immutable audit history after demotion'
);

select * from finish();
rollback;
