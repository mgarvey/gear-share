begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000271', 'authenticated', 'authenticated', 'reapply-admin@example.test', '', now(), now(), now(), '{"display_name":"Reapply Admin"}'),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000272', 'authenticated', 'authenticated', 'rejected-applicant@example.test', '', now(), now(), now(), '{"display_name":"Rejected Applicant"}');

update public.profiles set membership_status = 'active'
where id = '10000000-0000-4000-8000-000000000271';
insert into public.community_roles (community_id, user_id, role, granted_by)
select community_id, id, roles.role, id
from public.profiles
cross join unnest(array['member'::public.app_role, 'steward'::public.app_role]) as roles(role)
where id = '10000000-0000-4000-8000-000000000271';
update public.profiles
set membership_status = 'rejected',
    rejected_by = '10000000-0000-4000-8000-000000000271',
    rejected_at = now() - interval '1 day'
where id = '10000000-0000-4000-8000-000000000272';
insert into public.membership_applications (
  community_id, applicant_id, question_version_id,
  answer_snapshot, answer_count, decided_at
)
select p.community_id, p.id, q.id, '[]'::jsonb, 0, now() - interval '1 day'
from public.profiles p
join public.join_question_versions q on q.community_id = p.community_id and q.is_current
where p.id = '10000000-0000-4000-8000-000000000272';

create temp table reapplication_test_version as
select id from public.join_question_versions where is_current limit 1;
grant select on reapplication_test_version to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000272', true);
select throws_ok(
  $$ select public.allow_membership_reapplication('10000000-0000-4000-8000-000000000272') $$,
  'P0001', 'active administrator required',
  'a rejected applicant cannot reopen their own application'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000271', true);
select is(
  (select membership_status from public.private_member_administration() where id = '10000000-0000-4000-8000-000000000272'),
  'rejected',
  'Administrator membership view includes rejected applicants'
);
select lives_ok(
  $$ select public.allow_membership_reapplication('10000000-0000-4000-8000-000000000272') $$,
  'Administrator may allow one rejected same-community applicant to apply again'
);

reset role;
select is(
  (select membership_status::text from public.profiles where id = '10000000-0000-4000-8000-000000000272'),
  'pending',
  'reapplication returns the applicant to pending rather than approving them'
);
select ok(
  (select rejected_at is not null and rejected_by is not null from public.profiles where id = '10000000-0000-4000-8000-000000000272'),
  'the prior rejection evidence remains on the profile'
);
select is(
  (select count(*) from public.membership_applications where applicant_id = '10000000-0000-4000-8000-000000000272' and decided_at is null),
  1::bigint,
  'the existing application row is reopened for bounded resubmission'
);
select is(
  (select answer_snapshot from public.membership_applications where applicant_id = '10000000-0000-4000-8000-000000000272'),
  '[]'::jsonb,
  'prior answers are removed before a fresh application'
);
select ok(
  (select redacted_at is not null from public.membership_applications where applicant_id = '10000000-0000-4000-8000-000000000272'),
  'the cleared prior answer snapshot is explicitly redacted'
);
select is(
  (select count(*) from public.private_notifications where recipient_user_id = '10000000-0000-4000-8000-000000000272' and event_type = 'membership_reapplication_allowed'),
  1::bigint,
  'reapplication recovery atomically creates one applicant notification'
);
select is(
  (select count(*) from public.transactional_email_outbox where recipient_user_id = '10000000-0000-4000-8000-000000000272' and event_type = 'membership_reapplication_allowed' and status = 'pending'),
  1::bigint,
  'reapplication recovery atomically queues one required email'
);
select is(
  (select email_snapshot from public.transactional_email_outbox where recipient_user_id = '10000000-0000-4000-8000-000000000272' and event_type = 'membership_reapplication_allowed'),
  'rejected-applicant@example.test',
  'reapplication email uses the confirmed Auth address'
);
select is(
  (select email_body from public.notification_event_registry where event_type = 'membership_reapplication_allowed'),
  'An administrator has invited you to submit a new membership application. Open Gear Share when you are ready.',
  'reapplication email clearly tells the applicant what to do next'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000272', true);
select is(
  (select membership_status from public.my_membership_snapshot()),
  'pending',
  'the applicant immediately sees pending application access'
);
select is(
  (select count(*) from public.my_membership_application()),
  0::bigint,
  'the cleared application is not presented as already submitted'
);
select lives_ok(
  $$ select public.submit_join_application(
    (select id from reapplication_test_version),
    '{}'::jsonb
  ) $$,
  'the applicant may submit a fresh application'
);

reset role;
select is(
  (select count(*) from public.private_notifications
   where event_type = 'membership_application_pending'
     and transition_version = 2
     and recipient_user_id = '10000000-0000-4000-8000-000000000271'),
  1::bigint,
  'a genuine resubmission creates exactly one new Administrator notification'
);
select is(
  (select count(*) from public.transactional_email_outbox
   where event_type = 'membership_application_pending'
     and transition_version = 2
     and recipient_user_id = '10000000-0000-4000-8000-000000000271'
     and status = 'pending'),
  1::bigint,
  'a genuine resubmission queues exactly one required Administrator email'
);

select ok(
  not has_function_privilege('anon', 'public.allow_membership_reapplication(uuid)', 'execute'),
  'anonymous callers cannot reopen applications'
);

select * from finish();
rollback;
