begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000291', 'authenticated', 'authenticated', 'deletion-admin@example.test', '', now(), now(), now(), '{"display_name":"Deletion Admin"}'),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000292', 'authenticated', 'authenticated', 'former-member@example.test', '', now(), now(), now(), '{"display_name":"Former Member"}'),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000293', 'authenticated', 'authenticated', 'regular-member@example.test', '', now(), now(), now(), '{"display_name":"Regular Member"}');

update public.profiles
set membership_status = case when id = '10000000-0000-4000-8000-000000000292' then 'deactivated'::public.membership_status else 'active'::public.membership_status end,
    approved_by = '10000000-0000-4000-8000-000000000291',
    approved_at = now(),
    deactivated_by = case when id = '10000000-0000-4000-8000-000000000292' then '10000000-0000-4000-8000-000000000291'::uuid end,
    deactivated_at = case when id = '10000000-0000-4000-8000-000000000292' then now() end
where id in (
  '10000000-0000-4000-8000-000000000291',
  '10000000-0000-4000-8000-000000000292',
  '10000000-0000-4000-8000-000000000293'
);

insert into public.community_roles (community_id, user_id, role, granted_by)
select p.community_id, p.id, roles.role, '10000000-0000-4000-8000-000000000291'::uuid
from public.profiles p
cross join lateral unnest(
  case when p.id = '10000000-0000-4000-8000-000000000291'::uuid
    then array['member'::public.app_role, 'steward'::public.app_role]
    else array['member'::public.app_role]
  end
) roles(role)
where p.id in ('10000000-0000-4000-8000-000000000291', '10000000-0000-4000-8000-000000000293');

select ok(has_function_privilege('authenticated', 'public.reserve_deactivated_member_deletion(uuid)', 'EXECUTE'), 'an authenticated caller may request the bounded deletion workflow');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.member_account_deletion_reservations'::regclass), 'deletion reservations use forced RLS');
select ok(not has_table_privilege('authenticated', 'public.member_account_deletion_reservations', 'SELECT'), 'members cannot read deletion reservation tokens');
select ok(not has_table_privilege('service_role', 'public.member_account_deletion_reservations', 'UPDATE'), 'the runtime service cannot mutate reservations outside the bounded functions');
select ok(not has_function_privilege('authenticated', 'public.finalize_deactivated_member_deletion(uuid,uuid)', 'EXECUTE'), 'a browser caller cannot finalize personal-data erasure');
select ok(has_function_privilege('service_role', 'public.finalize_deactivated_member_deletion(uuid,uuid)', 'EXECUTE'), 'only the server workflow may finalize personal-data erasure');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000293', true);
select throws_ok(
  $$ select * from public.reserve_deactivated_member_deletion('10000000-0000-4000-8000-000000000292') $$,
  'P0001', 'active administrator required',
  'a Regular member cannot reserve account deletion'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000291', true);
select throws_ok(
  $$ select * from public.reserve_deactivated_member_deletion('10000000-0000-4000-8000-000000000293') $$,
  'P0001', 'deactivated member required',
  'an active account cannot be deleted through the deactivated-member workflow'
);
select lives_ok(
  $$ select * from public.reserve_deactivated_member_deletion('10000000-0000-4000-8000-000000000292') $$,
  'an active Administrator can reserve deletion of a deactivated member'
);
reset role;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claim.sub', '', true);

select ok((select deletion_token is not null from public.member_account_deletion_reservations where target_user_id = '10000000-0000-4000-8000-000000000292'), 'the private reservation has an opaque server token');
select throws_ok(
  $$ update public.profiles set account_deleted_at = now() where id = '10000000-0000-4000-8000-000000000292' $$,
  'P0001', 'account deletion state requires the reviewed workflow',
  'direct deletion-state mutation is rejected'
);
select set_config('app.membership_reactivation', 'allowed', true);
select throws_ok(
  $$ update public.profiles set membership_status = 'active' where id = '10000000-0000-4000-8000-000000000292' $$,
  'P0001', 'deleted account cannot be reactivated',
  'a pending deletion cannot race into reactivation'
);
select set_config('app.membership_reactivation', '', true);

insert into public.member_profile_settings (community_id, profile_id, introduction, phone_e164, coordination_note)
select community_id, id, 'Personal introduction', '+13125550123', 'Call before pickup' from public.profiles where id = '10000000-0000-4000-8000-000000000292';
insert into public.member_postal_codes (community_id, profile_id, postal_code)
select community_id, id, '60601' from public.profiles where id = '10000000-0000-4000-8000-000000000292';
insert into public.membership_applications (community_id, applicant_id, question_version_id, answer_snapshot, answer_count)
select p.community_id, p.id, q.id, '[]'::jsonb, 0
from public.profiles p
cross join lateral (select id from public.join_question_versions where community_id = p.community_id order by version desc limit 1) q
where p.id = '10000000-0000-4000-8000-000000000292';
insert into public.transactional_email_preferences (community_id, profile_id)
select community_id, id from public.profiles where id = '10000000-0000-4000-8000-000000000292';
insert into public.transactional_email_suppressions (community_id, recipient_user_id, normalized_email, reason)
select community_id, id, 'former-member@example.test', 'complaint' from public.profiles where id = '10000000-0000-4000-8000-000000000292';
insert into public.transactional_email_outbox (
  community_id, recipient_user_id, event_type, authoritative_record_id, transition_version,
  payload, email_snapshot, delivery_tag, status, next_attempt_at
)
select p.community_id, p.id, r.event_type, 'deletion-test', 1,
  '{}'::jsonb, 'former-member@example.test', gen_random_uuid(), 'pending', now()
from public.profiles p
cross join lateral (select event_type from public.notification_event_registry order by event_type limit 1) r
where p.id = '10000000-0000-4000-8000-000000000292';
insert into public.preapproved_member_invitations (
  community_id, normalized_email, display_name, created_by, status,
  accepted_user_id, created_at, expires_at, completed_at
)
select community_id, 'former-member@example.test', 'Former Member', '10000000-0000-4000-8000-000000000291',
  'accepted', id, now() - interval '2 minutes', now() + interval '10 minutes', now()
from public.profiles where id = '10000000-0000-4000-8000-000000000292';

select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$ select public.finalize_deactivated_member_deletion('10000000-0000-4000-8000-000000000292', gen_random_uuid()) $$,
  'P0001', 'valid account deletion reservation required',
  'the server cannot finalize with a mismatched reservation token'
);
select lives_ok(
  $$ select public.finalize_deactivated_member_deletion(
    '10000000-0000-4000-8000-000000000292',
    (select deletion_token from public.member_account_deletion_reservations where target_user_id = '10000000-0000-4000-8000-000000000292')
  ) $$,
  'the server finalizes a matching reserved deletion'
);
select set_config('request.jwt.claim.role', '', true);

select is((select display_name from public.profiles where id = '10000000-0000-4000-8000-000000000292'), 'Deleted member', 'the historical profile becomes an anonymous tombstone');
select ok((select account_deleted_at is not null from public.profiles where id = '10000000-0000-4000-8000-000000000292'), 'the tombstone records completed deletion');
select is((select count(*) from public.member_profile_settings where profile_id = '10000000-0000-4000-8000-000000000292'), 0::bigint, 'profile contact details are erased');
select is((select count(*) from public.member_postal_codes where profile_id = '10000000-0000-4000-8000-000000000292'), 0::bigint, 'postal code is erased');
select is((select answer_snapshot from public.membership_applications where applicant_id = '10000000-0000-4000-8000-000000000292'), '[]'::jsonb, 'membership answers are redacted');
select is((select count(*) from public.transactional_email_preferences where profile_id = '10000000-0000-4000-8000-000000000292'), 0::bigint, 'email preferences are erased');
select is((select count(*) from public.transactional_email_suppressions where recipient_user_id = '10000000-0000-4000-8000-000000000292'), 0::bigint, 'stored suppression email is erased');
select ok((select redacted_at is not null and email_snapshot is null and payload = '{}'::jsonb and status = 'invalidated' from public.transactional_email_outbox where recipient_user_id = '10000000-0000-4000-8000-000000000292'), 'queued notification email data is redacted and invalidated');
select is((select count(*) from public.preapproved_member_invitations where accepted_user_id = '10000000-0000-4000-8000-000000000292'), 0::bigint, 'accepted invitation personal data is erased');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000291', true);
select is((select count(*) from public.private_member_administration() where id = '10000000-0000-4000-8000-000000000292'), 0::bigint, 'deleted accounts disappear from Administrator member lists');
reset role;

select * from finish();
rollback;
