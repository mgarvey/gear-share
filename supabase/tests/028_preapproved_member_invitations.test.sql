begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000281', 'authenticated', 'authenticated', 'invitation-admin@example.test', '', now(), now(), now(), '{"display_name":"Invitation Admin"}'),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000282', 'authenticated', 'authenticated', 'invitation-regular@example.test', '', now(), now(), now(), '{"display_name":"Regular Member"}');

update public.profiles
set membership_status = 'active',
    approved_by = '10000000-0000-4000-8000-000000000281',
    approved_at = now()
where id in (
  '10000000-0000-4000-8000-000000000281',
  '10000000-0000-4000-8000-000000000282'
);
insert into public.community_roles (community_id, user_id, role, granted_by)
select p.community_id, p.id, roles.role, '10000000-0000-4000-8000-000000000281'::uuid
from public.profiles p
cross join lateral unnest(
  case when p.id = '10000000-0000-4000-8000-000000000281'::uuid
    then array['member'::public.app_role, 'steward'::public.app_role]
    else array['member'::public.app_role]
  end
) roles(role)
where p.id in (
  '10000000-0000-4000-8000-000000000281',
  '10000000-0000-4000-8000-000000000282'
);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.preapproved_member_invitations'::regclass),
  'personal invitation records use forced RLS'
);
select ok(not has_table_privilege('authenticated', 'public.preapproved_member_invitations', 'SELECT'), 'members cannot browse invitation records');
select ok(not has_table_privilege('service_role', 'public.preapproved_member_invitations', 'INSERT'), 'the runtime service cannot bypass the bounded invitation functions with raw table writes');
select ok(not has_function_privilege('authenticated', 'public.reserve_preapproved_member_invitation(uuid,text,text)', 'EXECUTE'), 'browser callers cannot reserve preapproved admission directly');
select ok(has_function_privilege('service_role', 'public.reserve_preapproved_member_invitation(uuid,text,text)', 'EXECUTE'), 'the reviewed service workflow can reserve preapproved admission');
select ok(not has_function_privilege('authenticated', 'public.authorize_preapproved_member_invitation_resend(uuid,text)', 'EXECUTE'), 'browser callers cannot authorize a resend directly');
select ok(has_function_privilege('service_role', 'public.authorize_preapproved_member_invitation_resend(uuid,text)', 'EXECUTE'), 'the reviewed service workflow can authorize a bounded resend');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$ select * from public.reserve_preapproved_member_invitation(
    '10000000-0000-4000-8000-000000000282', 'unauthorized@example.test', 'Not an admin'
  ) $$,
  'P0001', 'active administrator required',
  'a Regular member cannot be substituted as the invitation actor'
);
select lives_ok(
  $$ select * from public.reserve_preapproved_member_invitation(
    '10000000-0000-4000-8000-000000000281', ' New.Member@Example.Test ', ' New   Member '
  ) $$,
  'an active Administrator can reserve one personal invitation'
);
reset role;
select set_config('request.jwt.claim.role', '', true);

select is(
  (select normalized_email from public.preapproved_member_invitations where normalized_email = 'new.member@example.test'),
  'new.member@example.test',
  'the invitation email is normalized server-side'
);
select is(
  (select display_name from public.preapproved_member_invitations where normalized_email = 'new.member@example.test'),
  'New Member',
  'the optional display name is normalized server-side'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  created_at, updated_at, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000283',
  'authenticated', 'authenticated', 'NEW.MEMBER@example.test', '', now(), now(), '{"display_name":"Ignored Provider Name"}'
);

select is(
  (select membership_status::text from public.profiles where id = '10000000-0000-4000-8000-000000000283'),
  'active',
  'a matching Auth invitation creates an active member without another approval'
);
select is(
  (select display_name from public.profiles where id = '10000000-0000-4000-8000-000000000283'),
  'New Member',
  'the reviewed invitation name is authoritative over provider metadata'
);
select is(
  (select approved_by from public.profiles where id = '10000000-0000-4000-8000-000000000283'),
  '10000000-0000-4000-8000-000000000281'::uuid,
  'the approving Administrator is preserved on the member record'
);
select is(
  (select array_agg(role::text order by role::text) from public.community_roles where user_id = '10000000-0000-4000-8000-000000000283'),
  array['member']::text[],
  'a personal invitation grants only baseline Regular membership'
);
select is(
  (select status from public.preapproved_member_invitations where normalized_email = 'new.member@example.test'),
  'accepted',
  'the reservation is consumed exactly once by the matching Auth account'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$ select * from public.authorize_preapproved_member_invitation_resend(
    '10000000-0000-4000-8000-000000000282', 'new.member@example.test'
  ) $$,
  'P0001', 'active administrator required',
  'a Regular member cannot authorize an invitation resend'
);
select lives_ok(
  $$ select * from public.authorize_preapproved_member_invitation_resend(
    '10000000-0000-4000-8000-000000000281', 'new.member@example.test'
  ) $$,
  'an active Administrator can authorize a resend for an unconfirmed preapproved account'
);
select throws_ok(
  $$ select * from public.authorize_preapproved_member_invitation_resend(
    '10000000-0000-4000-8000-000000000281', 'new.member@example.test'
  ) $$,
  'P0001', 'invitation resend cooldown active',
  'rapid duplicate invitation resends are rejected'
);
reset role;
select set_config('request.jwt.claim.role', '', true);
select is(
  (select resend_count from public.preapproved_member_invitations where normalized_email = 'new.member@example.test'),
  1,
  'the bounded resend is recorded exactly once'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$ select * from public.reserve_preapproved_member_invitation(
    '10000000-0000-4000-8000-000000000281', 'new.member@example.test', 'Mark Email.com'
  ) $$,
  'P0001', 'account already exists',
  'an existing account reaches the resend branch before an irrelevant replacement display name is validated'
);
select throws_ok(
  $$ select * from public.reserve_preapproved_member_invitation(
    '10000000-0000-4000-8000-000000000281', 'not-an-email', 'New Member'
  ) $$,
  'P0001', 'valid email address required',
  'invalid invitation email receives a field-specific failure'
);
select throws_ok(
  $$ select * from public.reserve_preapproved_member_invitation(
    '10000000-0000-4000-8000-000000000281', 'new-display-name@example.test', 'Mark Email.com'
  ) $$,
  'P0001', 'valid display name required',
  'invalid new-invitation display name receives a field-specific failure'
);
reset role;
select set_config('request.jwt.claim.role', '', true);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  created_at, updated_at, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000284',
  'authenticated', 'authenticated', 'ordinary-signup@example.test', '', now(), now(), '{"display_name":"Ordinary Signup"}'
);
select is(
  (select membership_status::text from public.profiles where id = '10000000-0000-4000-8000-000000000284'),
  'pending',
  'ordinary signup still requires Administrator approval'
);
select is(
  (select count(*) from public.community_roles where user_id = '10000000-0000-4000-8000-000000000284'),
  0::bigint,
  'ordinary signup receives no member role before approval'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$ select * from public.reserve_preapproved_member_invitation(
    '10000000-0000-4000-8000-000000000281', 'ordinary-signup@example.test', 'Existing account'
  ) $$,
  'P0001', 'account already exists',
  'the personal invitation flow does not rewrite an existing account or membership'
);
select lives_ok(
  $$ select * from public.reserve_preapproved_member_invitation(
    '10000000-0000-4000-8000-000000000281', 'provider-failure@example.test', ''
  ) $$,
  'an omitted display name receives a bounded neutral default'
);
reset role;
select set_config('request.jwt.claim.role', '', true);
create temporary table provider_failure_invitation as
select id from public.preapproved_member_invitations where normalized_email = 'provider-failure@example.test';
grant select on provider_failure_invitation to service_role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  public.fail_preapproved_member_invitation(
    (select id from provider_failure_invitation),
    'provider'
  ),
  'failed',
  'a definitive delivery failure closes its reservation'
);
reset role;
select set_config('request.jwt.claim.role', '', true);
select is(
  (select display_name from public.preapproved_member_invitations where normalized_email = 'provider-failure@example.test'),
  'Invited member',
  'the optional display name has a non-authority-bearing default'
);

insert into public.preapproved_member_invitations (
  community_id, normalized_email, display_name, created_by, status, failure_code,
  created_at, expires_at, completed_at
)
select p.community_id, 'rate-' || n || '@example.test', 'Rate fixture', p.id,
  'failed', 'provider', clock_timestamp(), clock_timestamp() + interval '10 minutes', clock_timestamp()
from public.profiles p
cross join generate_series(1, 18) n
where p.id = '10000000-0000-4000-8000-000000000281';

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$ select * from public.reserve_preapproved_member_invitation(
    '10000000-0000-4000-8000-000000000281', 'over-limit@example.test', 'Over limit'
  ) $$,
  'P0001', 'invitation rate limit reached',
  'an Administrator cannot exceed twenty invitation attempts per hour'
);
reset role;
select set_config('request.jwt.claim.role', '', true);

select * from finish();
rollback;
