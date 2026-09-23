begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-4000-8000-000000000026',
  'authenticated', 'authenticated', 'snapshot@example.test', '',
  now(), now(), now(), '{"display_name":"Snapshot Member"}'
);
update public.profiles
set membership_status = 'active'
where id = '10000000-0000-4000-8000-000000000026';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000026', true);
select is(
  (select id from public.my_membership_snapshot()),
  '10000000-0000-4000-8000-000000000026'::uuid,
  'membership snapshot derives the caller identity'
);
select is(
  (select access_level from public.my_membership_snapshot()),
  'regular',
  'membership snapshot defaults to Regular access'
);

reset role;
insert into public.community_roles (community_id, user_id, role, granted_by)
select community_id, id, 'custodian', id
from public.profiles where id = '10000000-0000-4000-8000-000000000026';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000026', true);
select is(
  (select access_level from public.my_membership_snapshot()),
  'custodian',
  'membership snapshot reports Custodian access'
);

reset role;
insert into public.community_roles (community_id, user_id, role, granted_by)
select community_id, id, 'steward', id
from public.profiles where id = '10000000-0000-4000-8000-000000000026';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000026', true);
select is(
  (select access_level from public.my_membership_snapshot()),
  'administrator',
  'Administrator access takes precedence over legacy dual-role rows'
);
select is(
  (select count(*) from public.my_membership_snapshot()),
  1::bigint,
  'membership snapshot returns one bounded row'
);

reset role;
select ok(
  has_function_privilege('authenticated', 'public.my_membership_snapshot()', 'execute'),
  'authenticated callers may load their membership snapshot'
);
select ok(
  not has_function_privilege('anon', 'public.my_membership_snapshot()', 'execute'),
  'anonymous callers cannot load membership snapshots'
);

select * from finish();
rollback;
