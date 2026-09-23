begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into public.communities (id, slug, name)
values ('7b000000-0000-4000-8000-000000000004', 'bootstrap-other', 'Bootstrap Other');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'valid-bootstrap@example.test', '', now(), now(), now(), '{"display_name":"Valid Bootstrap"}'),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'unconfirmed-bootstrap@example.test', '', null, now(), now(), '{"display_name":"Unconfirmed Bootstrap"}'),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'cross-bootstrap@example.test', '', now(), now(), now(), '{"display_name":"Cross Bootstrap"}'),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'second-bootstrap@example.test', '', now(), now(), now(), '{"display_name":"Second Bootstrap"}');

update public.profiles
set community_id = '7b000000-0000-4000-8000-000000000004'
where id = '40000000-0000-4000-8000-000000000003';

select throws_ok(
  $$ select public.bootstrap_founding_steward('4fffffff-ffff-4fff-8fff-ffffffffffff', 'local-test', 'missing target') $$,
  'P0001', 'target must be a confirmed pending community member',
  'missing bootstrap target is rejected'
);
select throws_ok(
  $$ select public.bootstrap_founding_steward('40000000-0000-4000-8000-000000000002', 'local-test', 'unconfirmed target') $$,
  'P0001', 'target must be a confirmed pending community member',
  'unconfirmed bootstrap target is rejected'
);
select throws_ok(
  $$ select public.bootstrap_founding_steward('40000000-0000-4000-8000-000000000003', 'local-test', 'cross-community target') $$,
  'P0001', 'target must be a confirmed pending community member',
  'cross-community bootstrap target is rejected'
);
select throws_ok(
  $$ select public.bootstrap_founding_steward('40000000-0000-4000-8000-000000000001', '  ', 'missing operator') $$,
  'P0001', 'operator identifier and reason are required',
  'blank operator identifier is rejected'
);
select throws_ok(
  $$ select public.bootstrap_founding_steward('40000000-0000-4000-8000-000000000001', 'local-test', '  ') $$,
  'P0001', 'operator identifier and reason are required',
  'blank bootstrap reason is rejected'
);
select is(
  (select count(*) from public.founding_steward_bootstrap),
  0::bigint,
  'invalid attempts create no bootstrap audit row'
);
select is(
  (select count(*) from public.community_roles where role = 'steward'),
  0::bigint,
  'invalid attempts create no steward role'
);

select lives_ok(
  $$ select public.bootstrap_founding_steward('40000000-0000-4000-8000-000000000001', '  local-operator  ', '  establish gear share steward  ') $$,
  'first valid confirmed pending Group member is bootstrapped'
);
select is(
  (select membership_status::text from public.profiles where id = '40000000-0000-4000-8000-000000000001'),
  'active',
  'bootstrap activates the target profile'
);
select is(
  (select count(*) from public.community_roles where user_id = '40000000-0000-4000-8000-000000000001'),
  2::bigint,
  'bootstrap grants member and steward roles atomically'
);
select is(
  (select operator_identifier from public.founding_steward_bootstrap),
  'local-operator',
  'bootstrap records the trimmed supplied operator identifier'
);
select is(
  (select reason from public.founding_steward_bootstrap),
  'establish gear share steward',
  'bootstrap records the trimmed supplied reason'
);
select ok(
  (select bootstrapped_at is not null from public.founding_steward_bootstrap),
  'bootstrap records its timestamp'
);
select ok(
  exists (
    select 1 from public.role_audit
    where target_user_id = '40000000-0000-4000-8000-000000000001'
      and action = 'bootstrap'
      and actor_user_id is null
      and operator_identifier = 'local-operator'
      and reason = 'establish gear share steward'
      and occurred_at is not null
  ),
  'bootstrap creates matching immutable role audit evidence'
);
select throws_ok(
  $$ select public.bootstrap_founding_steward('40000000-0000-4000-8000-000000000004', 'local-test', 'second target') $$,
  'P0001', 'founding steward already bootstrapped',
  'a second founding steward is rejected'
);
select ok(
  not has_function_privilege('authenticated', 'public.bootstrap_founding_steward(uuid,text,text)', 'execute'),
  'authenticated application users cannot execute bootstrap'
);
select ok(
  not has_function_privilege('anon', 'public.bootstrap_founding_steward(uuid,text,text)', 'execute'),
  'anonymous users cannot execute bootstrap'
);

select * from finish();
rollback;
