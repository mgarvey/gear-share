begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.communities (id, slug, name)
values
  ('8a000000-0000-4000-8000-000000000001', 'notification-test', 'Notification Test'),
  ('8a000000-0000-4000-8000-000000000002', 'notification-cross', 'Notification Cross');

alter table public.profiles disable trigger profile_membership_notification;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '8a100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@example.test', '', now(), now(), now(), '{"display_name":"Notification Admin"}'),
  ('00000000-0000-0000-0000-000000000000', '8a100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'custodian@example.test', '', now(), now(), now(), '{"display_name":"Notification Custodian"}'),
  ('00000000-0000-0000-0000-000000000000', '8a100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'borrower@example.test', '', now(), now(), now(), '{"display_name":"Notification Borrower"}'),
  ('00000000-0000-0000-0000-000000000000', '8a100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'other@example.test', '', now(), now(), now(), '{"display_name":"Other Member"}'),
  ('00000000-0000-0000-0000-000000000000', '8a100000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'applicant@example.test', '', now(), now(), now(), '{"display_name":"Pending Applicant"}'),
  ('00000000-0000-0000-0000-000000000000', '8a100000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'cross@example.test', '', now(), now(), now(), '{"display_name":"Cross Member"}'),
  ('00000000-0000-0000-0000-000000000000', '8a100000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'address-check@example.test', '', now(), now(), now(), '{"display_name":"Address Check Member"}'),
  ('00000000-0000-0000-0000-000000000000', '8a100000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'provider-off@example.test', '', now(), now(), now(), '{"display_name":"Provider Off Member"}');
update public.profiles set community_id = '8a000000-0000-4000-8000-000000000001', membership_status = 'active', approved_by = '8a100000-0000-4000-8000-000000000001', approved_at = now()
where id between '8a100000-0000-4000-8000-000000000001' and '8a100000-0000-4000-8000-000000000004';
update public.profiles set community_id = '8a000000-0000-4000-8000-000000000001'
where id = '8a100000-0000-4000-8000-000000000005';
update public.profiles set community_id = '8a000000-0000-4000-8000-000000000002', membership_status = 'active', approved_by = '8a100000-0000-4000-8000-000000000006', approved_at = now()
where id = '8a100000-0000-4000-8000-000000000006';
update public.profiles set community_id = '8a000000-0000-4000-8000-000000000001', membership_status = 'active', approved_by = '8a100000-0000-4000-8000-000000000001', approved_at = now()
where id in ('8a100000-0000-4000-8000-000000000007', '8a100000-0000-4000-8000-000000000008');
alter table public.profiles enable trigger profile_membership_notification;

insert into public.community_roles (community_id, user_id, role, granted_by)
values
  ('8a000000-0000-4000-8000-000000000001', '8a100000-0000-4000-8000-000000000001', 'member', '8a100000-0000-4000-8000-000000000001'),
  ('8a000000-0000-4000-8000-000000000001', '8a100000-0000-4000-8000-000000000001', 'steward', '8a100000-0000-4000-8000-000000000001'),
  ('8a000000-0000-4000-8000-000000000001', '8a100000-0000-4000-8000-000000000002', 'member', '8a100000-0000-4000-8000-000000000001'),
  ('8a000000-0000-4000-8000-000000000001', '8a100000-0000-4000-8000-000000000002', 'custodian', '8a100000-0000-4000-8000-000000000001'),
  ('8a000000-0000-4000-8000-000000000001', '8a100000-0000-4000-8000-000000000003', 'member', '8a100000-0000-4000-8000-000000000001'),
  ('8a000000-0000-4000-8000-000000000001', '8a100000-0000-4000-8000-000000000004', 'member', '8a100000-0000-4000-8000-000000000001'),
  ('8a000000-0000-4000-8000-000000000001', '8a100000-0000-4000-8000-000000000007', 'member', '8a100000-0000-4000-8000-000000000001'),
  ('8a000000-0000-4000-8000-000000000001', '8a100000-0000-4000-8000-000000000008', 'member', '8a100000-0000-4000-8000-000000000001'),
  ('8a000000-0000-4000-8000-000000000002', '8a100000-0000-4000-8000-000000000006', 'member', '8a100000-0000-4000-8000-000000000006'),
  ('8a000000-0000-4000-8000-000000000002', '8a100000-0000-4000-8000-000000000006', 'steward', '8a100000-0000-4000-8000-000000000006');

select has_table('public', 'private_notifications', 'private in-app notifications exist');
select has_table('public', 'transactional_email_outbox', 'transactional outbox exists');
select has_table('public', 'transactional_email_suppressions', 'email suppression exists');
select has_table('public', 'transactional_email_preference_audit', 'preference changes have immutable audit');
select has_table('public', 'transactional_email_suppression_audit', 'Administrator suppression changes have immutable audit');
select has_table('public', 'ses_feedback_events', 'normalized feedback audit exists');
select is((select count(*)::integer from public.notification_event_registry), 29, 'event registry is exact and bounded');
select is(
  (select email_body from public.notification_event_registry where event_type = 'membership_reactivated_admin'),
  'A member''s membership was restored. Open Gear Share to review member access.',
  'Administrator membership copy describes a member transition instead of the recipient Administrator'
);
select is(
  (select email_body from public.notification_event_registry where event_type = 'loan_requested'),
  'Your borrowing request was sent. Open Gear Share to follow its status.',
  'borrower receives plain confirmation copy'
);
select is(
  (select email_body from public.notification_event_registry where event_type = 'loan_request_received'),
  'A member asked to borrow gear. Open Gear Share to review the item, dates, and quantity.',
  'gear manager receives actionable request copy'
);
select ok(
  not exists (
    select 1 from public.notification_event_registry
    where in_app_title ~* '(formal|transactional|moderated|private application)'
       or in_app_body ~* '(formal|transactional|moderated|private application)'
       or email_subject ~* '(formal|transactional|moderated|private application)'
       or email_body ~* '(formal|transactional|moderated|private application)'
  ),
  'member-facing notification copy avoids internal terminology'
);
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
  'public.notification_event_registry'::regclass,
  'public.private_notifications'::regclass,
  'public.transactional_email_preferences'::regclass,
  'public.transactional_email_preference_audit'::regclass,
  'public.transactional_email_outbox'::regclass,
  'public.transactional_email_suppressions'::regclass,
  'public.transactional_email_suppression_audit'::regclass,
  'public.notification_delivery_attempts'::regclass,
  'public.ses_feedback_events'::regclass
)), 'all notification relations use forced RLS');
select ok(not has_table_privilege('authenticated', 'public.private_notifications', 'SELECT'), 'members have no direct notification-table read');
select ok(not has_table_privilege('authenticated', 'public.transactional_email_outbox', 'SELECT'), 'members have no outbox read');
select ok(not has_table_privilege('authenticated', 'public.transactional_email_suppressions', 'SELECT'), 'members have no suppression read');
select ok(not has_function_privilege('authenticated', 'public.emit_private_notification(text,text,bigint,uuid,uuid,jsonb,timestamptz)', 'EXECUTE'), 'members cannot invent notification events');
select ok(has_function_privilege('authenticated', 'public.my_private_notifications(timestamptz,uuid,integer)', 'EXECUTE'), 'members may use the exact private center');
select ok(not has_function_privilege('authenticated', 'public.claim_transactional_notifications(uuid,integer)', 'EXECUTE'), 'members cannot claim email work');
select ok(has_function_privilege('service_role', 'public.claim_transactional_notifications(uuid,integer)', 'EXECUTE'), 'service role may claim bounded email work');

select throws_ok(
  $$ select public.emit_private_notification(
       'loan_requested', 'forged', 1,
       '8a000000-0000-4000-8000-000000000001',
       '8a100000-0000-4000-8000-000000000003',
       '{"schema_version":1,"borrower_note":"private"}'::jsonb, now()
     ) $$,
  'P0001', 'bounded registered notification payload required',
  'unexpected private prose is rejected even to the table owner'
);

insert into public.join_question_versions (id, community_id, version, questions, published_by)
values ('8a200000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000001', 1, '[]', '8a100000-0000-4000-8000-000000000001');
insert into public.membership_applications
  (id, community_id, applicant_id, question_version_id, answer_snapshot, answer_count)
values
  ('8a300000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000001',
   '8a100000-0000-4000-8000-000000000005', '8a200000-0000-4000-8000-000000000001', '[]', 0);
select is((select count(*) from public.private_notifications where event_type = 'membership_application_pending'), 1::bigint, 'pending application atomically notifies the Administrator once');
select is((select count(*) from public.transactional_email_outbox where event_type = 'membership_application_pending' and status = 'pending'), 1::bigint, 'pending application atomically creates required email work');
select is((select email_snapshot from public.transactional_email_outbox where event_type = 'membership_application_pending'), 'admin@example.test', 'outbox binds confirmed Auth email, not a profile address');

set local role authenticated;
select set_config('request.jwt.claim.sub', '8a100000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.decide_membership('8a100000-0000-4000-8000-000000000005', true) $$,
  'membership approval commits with its notifications'
);
reset role;
select is((select count(*) from public.private_notifications where event_type = 'membership_approved' and recipient_user_id = '8a100000-0000-4000-8000-000000000005'), 1::bigint, 'approved applicant receives one in-app access notice');
select is((select status from public.transactional_email_outbox where event_type = 'membership_approved'), 'pending', 'required access email cannot be preference-disabled');

set local role authenticated;
select set_config('request.jwt.claim.sub', '8a100000-0000-4000-8000-000000000003', true);
select is((select loan_activity from public.get_my_transactional_email_preferences()), true, 'email preferences default on');
select lives_ok(
  $$ select public.update_my_transactional_email_preferences(false, false, false) $$,
  'member may disable only optional transactional categories'
);
select is((select loan_reminders from public.get_my_transactional_email_preferences()), false, 'member reads own saved reminder preference');
select lives_ok(
  $$ select public.update_my_transactional_email_preferences(false, true, true) $$,
  'member can revise an existing preference row'
);
reset role;
select is((select count(*) from public.transactional_email_preference_audit where profile_id = '8a100000-0000-4000-8000-000000000003'), 2::bigint, 'each preference save creates bounded immutable audit evidence');

insert into public.supplies (
  id, community_id, title, description, category, condition, ownership_kind,
  owner_id, custodian_id, quantity_total, listing_status, created_by
) values (
  '8a400000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000001',
  'Notification tent', '', 'tents-shelters', 'good', 'group', null,
  '8a100000-0000-4000-8000-000000000002', 3, 'listed',
  '8a100000-0000-4000-8000-000000000001'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '8a100000-0000-4000-8000-000000000003', true);
select lives_ok(
  $$ select public.request_gear_loan(
       '8a400000-0000-4000-8000-000000000001', 1, '2028-10-01', '2028-10-02', 'private note'
     ) $$,
  'formal loan request commits independently of email preference'
);
reset role;
select is((select count(*) from public.private_notifications where event_type = 'loan_requested' and authoritative_record_id in (select id::text from public.gear_loans where supply_id = '8a400000-0000-4000-8000-000000000001')), 1::bigint, 'borrower receives one confirmation');
select is((select count(*) from public.private_notifications where event_type = 'loan_request_received' and authoritative_record_id in (select id::text from public.gear_loans where supply_id = '8a400000-0000-4000-8000-000000000001')), 2::bigint, 'active Custodian and Administrator receive review notices');
select is((select count(*) from public.transactional_email_outbox where event_type = 'loan_requested' and authoritative_record_id in (select id::text from public.gear_loans where supply_id = '8a400000-0000-4000-8000-000000000001') and recipient_user_id = '8a100000-0000-4000-8000-000000000003'), 0::bigint, 'authenticated borrower receives no email for their own action');
select is((select status from public.transactional_email_outbox where event_type = 'loan_request_received' and authoritative_record_id in (select id::text from public.gear_loans where supply_id = '8a400000-0000-4000-8000-000000000001') and recipient_user_id = '8a100000-0000-4000-8000-000000000002'), 'pending', 'manager email remains pending independently');
select ok(not exists (select 1 from public.transactional_email_outbox where payload::text like '%private note%'), 'outbox stores no borrower prose');
select set_config('test.pending_loan_id', (select id::text from public.gear_loans where supply_id = '8a400000-0000-4000-8000-000000000001'), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '8a100000-0000-4000-8000-000000000003', true);
select lives_ok(
  $$ select public.cancel_gear_loan(current_setting('test.pending_loan_id')::uuid, 'Plans changed') $$,
  'borrower cancellation commits with bounded notifications'
);
reset role;
select is((select count(*) from public.private_notifications where event_type = 'loan_cancelled' and authoritative_record_id = current_setting('test.pending_loan_id')), 3::bigint, 'borrower cancellation notifies borrower plus current Custodian and Administrator');
select set_config(
  'test.borrower_notification_id',
  (select id::text from public.private_notifications
   where recipient_user_id = '8a100000-0000-4000-8000-000000000003'
     and event_type = 'loan_requested'),
  true
);
select set_config(
  'test.other_undismissed_notification_count',
  (select count(*)::text from public.private_notifications
   where recipient_user_id <> '8a100000-0000-4000-8000-000000000003'
     and dismissed_at is null),
  true
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '8a100000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.my_private_notifications(null, null, 30)), 2, 'borrower reads only their own request and cancellation notifications');
select throws_ok(
  $$ select public.my_private_notifications(null, null, 31) $$,
  'P0001', 'bounded notification cursor required', 'notification page cannot exceed 30'
);
select lives_ok(
  $$ select public.set_my_notification_read(
       current_setting('test.borrower_notification_id')::uuid, true
     ) $$,
  'recipient marks their own notification read'
);
select lives_ok(
  $$ select public.set_my_notification_read(
       current_setting('test.borrower_notification_id')::uuid, false
     ) $$,
  'recipient marks their own notification unread'
);
select lives_ok(
  $$ select public.dismiss_my_notification(
       current_setting('test.borrower_notification_id')::uuid
     ) $$,
  'recipient dismisses their own notification'
);
select is((select count(*)::integer from public.my_private_notifications(null, null, 30)), 1, 'dismissed notification leaves the recipient center');
reset role;
select set_config('app.notification_internal_change', 'allowed', true);
insert into public.private_notifications (
  community_id, recipient_user_id, event_type, authoritative_record_id,
  transition_version, title, body, app_route, occurred_at
)
select
  '8a000000-0000-4000-8000-000000000001',
  '8a100000-0000-4000-8000-000000000003',
  'loan_requested',
  'bulk-dismiss-' || sequence_number,
  1,
  'Loan requested',
  'A borrowing request was submitted.',
  '/loans',
  clock_timestamp() - sequence_number * interval '1 minute'
from generate_series(1, 31) as sequence_number;
select set_config('app.notification_internal_change', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '8a100000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.my_private_notifications(null, null, 30)), 30, 'recipient has an unloaded notification page before bulk dismissal');
select is(
  public.dismiss_all_my_notifications(),
  32,
  'recipient dismisses every remaining notification in one operation'
);
select is((select count(*)::integer from public.my_private_notifications(null, null, 30)), 0, 'bulk dismissal clears the recipient center across its full result set');
reset role;
select is(
  (select count(*)::integer from public.private_notifications
   where recipient_user_id <> '8a100000-0000-4000-8000-000000000003'
     and dismissed_at is null),
  current_setting('test.other_undismissed_notification_count')::integer,
  'bulk dismissal preserves every other recipient notification'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '8a100000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$ select public.set_my_notification_read(
       current_setting('test.borrower_notification_id')::uuid, false
     ) $$,
  'P0001', 'notification unavailable', 'cross-user read-state probe changes nothing'
);
select throws_ok(
  $$ select public.dismiss_my_notification(
       current_setting('test.borrower_notification_id')::uuid
     ) $$,
  'P0001', 'notification unavailable', 'cross-user dismissal probe changes nothing'
);
select is((select count(*)::integer from public.my_private_notifications(null, null, 30)), 0, 'unrelated member cannot count another center');
reset role;
select ok(has_function_privilege('authenticated', 'public.dismiss_all_my_notifications()', 'EXECUTE'), 'authenticated members may call bulk dismissal');
select ok(not has_function_privilege('anon', 'public.dismiss_all_my_notifications()', 'EXECUTE'), 'anonymous callers cannot execute bulk dismissal');
select set_config('request.jwt.claim.sub', '', true);
select is(auth.uid(), null::uuid, 'background notification fixture has no authenticated website actor');

create temporary table notification_claims as
select * from public.claim_transactional_notifications('8a500000-0000-4000-8000-000000000001', 25);
select ok((select count(*) from notification_claims) > 0, 'bounded claim obtains eligible email rows');
select ok((select count(*) from notification_claims) <= 25, 'claim never exceeds 25 rows');
select is((select count(distinct outbox_id) from notification_claims), (select count(*) from notification_claims), 'claim returns unique rows');
select ok((select bool_and(recipient_email = lower(recipient_email)) from notification_claims), 'claim returns normalized confirmed recipient snapshots');

select lives_ok(
  $$ select public.complete_transactional_notification_delivery(
       c.outbox_id, c.claim_token, 'delivered', 'ses-message-001', null
     ) from notification_claims c limit 1 $$,
  'one claimed email records a delivered provider outcome'
);
select is((select count(*) from public.notification_delivery_attempts where outcome = 'delivered'), 1::bigint, 'delivered attempt is recorded once');
select ok((select count(*) from public.transactional_email_outbox where status = 'delivered') = 1, 'delivery status changes only the outbox');
select ok((select count(*) from public.private_notifications) >= 5, 'in-app truth remains after delivery');

select public.emit_private_notification('loan_requested', 'claim-window-one', 1, '8a000000-0000-4000-8000-000000000001', '8a100000-0000-4000-8000-000000000004', '{"schema_version":1}', clock_timestamp());
select pg_sleep(0.01);
select public.emit_private_notification('loan_requested', 'claim-window-two', 1, '8a000000-0000-4000-8000-000000000001', '8a100000-0000-4000-8000-000000000002', '{"schema_version":1}', clock_timestamp());
set local role authenticated;
select set_config('request.jwt.claim.sub', '8a100000-0000-4000-8000-000000000004', true);
select public.update_my_transactional_email_preferences(false, true, true);
select set_config('request.jwt.claim.sub', '8a100000-0000-4000-8000-000000000002', true);
select public.update_my_transactional_email_preferences(false, true, true);
reset role;
select is((select count(*) from public.claim_transactional_notifications('8a500000-0000-4000-8000-000000000010', 1)), 0::bigint, 'claim does not refill from outside the exact revalidated candidate window');
select is((select status from public.transactional_email_outbox where authoritative_record_id = 'claim-window-one'), 'preference_suppressed', 'first revalidated row honors changed preference');
select is((select status from public.transactional_email_outbox where authoritative_record_id = 'claim-window-two'), 'pending', 'later row remains unclaimed until its own revalidation pass');
select is((select count(*) from public.claim_transactional_notifications('8a500000-0000-4000-8000-000000000011', 1)), 0::bigint, 'second row is also revalidated before claim');
select is((select status from public.transactional_email_outbox where authoritative_record_id = 'claim-window-two'), 'preference_suppressed', 'second revalidated row honors changed preference');

create temporary table delivered_feedback_target as
select o.id, o.community_id, o.recipient_user_id, o.email_snapshot, o.delivery_tag, o.provider_message_id
from public.transactional_email_outbox o where o.status = 'delivered' limit 1;
select is(
  (select public.apply_verified_ses_feedback(
    'arn:aws:sns:us-east-1:123456789012:gear-share-feedback', 'sns-feedback-001',
    'complaint', t.provider_message_id, t.email_snapshot, t.delivery_tag, now()
  ) from delivered_feedback_target t),
  'processed', 'verified complaint is processed once'
);
select is(
  (select public.apply_verified_ses_feedback(
    'arn:aws:sns:us-east-1:123456789012:gear-share-feedback', 'sns-feedback-001',
    'complaint', t.provider_message_id, t.email_snapshot, t.delivery_tag, now()
  ) from delivered_feedback_target t),
  'duplicate', 'verified complaint replay is idempotent'
);
select is((select count(*) from public.transactional_email_suppressions where reason = 'complaint' and cleared_at is null), 1::bigint, 'complaint suppresses only its bound address association');
select is((select count(*) from public.ses_feedback_events where sns_message_id = 'sns-feedback-001'), 1::bigint, 'feedback replay creates one normalized event');
select set_config('test.provider_suppressed_user_id', (select recipient_user_id::text from delivered_feedback_target), true);
select throws_ok(
  $$ select public.apply_verified_ses_feedback(
       'arn:aws:sns:us-east-1:123456789012:gear-share-feedback', 'sns-forged',
       'complaint', 'wrong-message', 'borrower@example.test',
       '8a500000-0000-4000-8000-000000000099', now()
     ) $$,
  'P0001', 'matching delivered notification required',
  'mismatched message, recipient, and delivery tag suppress nothing'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '8a100000-0000-4000-8000-000000000001', true);
select ok((select count(*) from public.private_notification_delivery_diagnostics(null)) > 0, 'Administrator reads bounded delivery diagnostics without provider prose');
select throws_ok(
  $$ select public.set_administrator_email_suppression(current_setting('test.provider_suppressed_user_id')::uuid, true) $$,
  'P0001', 'provider suppression cannot be changed by Administrator',
  'Administrator cannot relabel a provider suppression as an Administrator action'
);
select lives_ok(
  $$ select public.set_administrator_email_suppression('8a100000-0000-4000-8000-000000000007', false) $$,
  'resuming a nonsuppressed member is an idempotent no-op'
);
select lives_ok(
  $$ select public.set_administrator_email_suppression('8a100000-0000-4000-8000-000000000004', true) $$,
  'Administrator may pause a same-community confirmed address'
);
select lives_ok(
  $$ select public.set_administrator_email_suppression('8a100000-0000-4000-8000-000000000004', true) $$,
  'repeated Administrator pause is an idempotent no-op'
);
reset role;
select is((select count(*) from public.transactional_email_suppression_audit where recipient_user_id = current_setting('test.provider_suppressed_user_id')::uuid), 0::bigint, 'provider-suppression rejection records no false Administrator action');
select is((select count(*) from public.transactional_email_suppression_audit where recipient_user_id = '8a100000-0000-4000-8000-000000000007'), 0::bigint, 'resume-with-none records no false Administrator action');
select is((select count(*) from public.transactional_email_suppression_audit where recipient_user_id = '8a100000-0000-4000-8000-000000000004' and action = 'administrator_paused'), 1::bigint, 'Administrator suppression records immutable actor/action audit');
select is((select count(*) from public.private_notifications where event_type = 'email_delivery_suppressed' and recipient_user_id = '8a100000-0000-4000-8000-000000000004'), 1::bigint, 'safety suppression creates one private recipient-visible status notice');
select is((select count(*) from public.transactional_email_outbox where event_type = 'email_delivery_suppressed'), 0::bigint, 'delivery-status notice cannot recursively enqueue email');
set local role authenticated;
select set_config('request.jwt.claim.sub', '8a100000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.set_administrator_email_suppression('8a100000-0000-4000-8000-000000000004', false) $$,
  'Administrator may resume their own active safety pause'
);
select lives_ok(
  $$ select public.set_administrator_email_suppression('8a100000-0000-4000-8000-000000000004', false) $$,
  'repeated Administrator resume is an idempotent no-op'
);
reset role;
select is((select count(*) from public.transactional_email_suppression_audit where recipient_user_id = '8a100000-0000-4000-8000-000000000004' and action = 'administrator_resumed'), 1::bigint, 'Administrator resume records exactly one real transition');

set local role authenticated;
select set_config('request.jwt.claim.sub', '8a100000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select public.private_notification_delivery_diagnostics(null) $$,
  'P0001', 'active administrator required', 'Custodian cannot inspect delivery diagnostics'
);
select throws_ok(
  $$ select public.set_administrator_email_suppression('8a100000-0000-4000-8000-000000000004', false) $$,
  'P0001', 'active administrator required', 'Custodian cannot clear delivery safety state'
);
reset role;

select throws_ok(
  $$ update public.transactional_email_preference_audit set loan_activity = true where profile_id = '8a100000-0000-4000-8000-000000000003' $$,
  'P0001', 'notification operational changes require the reviewed workflow',
  'preference audit cannot be rewritten even by the table owner'
);
select throws_ok(
  $$ delete from public.transactional_email_suppression_audit where recipient_user_id = '8a100000-0000-4000-8000-000000000004' $$,
  'P0001', 'notification operational changes require the reviewed workflow',
  'suppression audit cannot be deleted even by the table owner'
);

select throws_ok(
  $$ update public.private_notifications set body = 'rewritten' where true $$,
  'P0001', 'notification operational changes require the reviewed workflow',
  'notification core cannot be rewritten directly even by the table owner'
);
select throws_ok(
  $$ delete from public.ses_feedback_events where true $$,
  'P0001', 'notification operational changes require the reviewed workflow',
  'feedback audit cannot be deleted outside retention workflow'
);
select ok(
  (select proconfig @> array['lock_timeout=3s', 'statement_timeout=15s']
   from pg_proc where oid = 'public.claim_transactional_notifications(uuid,integer)'::regprocedure),
  'delivery claim has explicit database timeouts'
);

select set_config('request.jwt.claim.sub', '', true);
select public.emit_private_notification('membership_approved', 'stale-retention-claim', 1, '8a000000-0000-4000-8000-000000000001', '8a100000-0000-4000-8000-000000000002', '{"schema_version":1}', clock_timestamp());
alter table public.transactional_email_outbox disable trigger transactional_email_outbox_protected;
update public.transactional_email_outbox
set status = 'claimed', attempt_count = 1,
    terminal_at = null, next_attempt_at = null,
    claimed_at = clock_timestamp() - interval '11 minutes',
    claimed_by = '8a500000-0000-4000-8000-000000000020',
    claim_token = '8a500000-0000-4000-8000-000000000021',
    first_attempt_at = clock_timestamp() - interval '11 minutes',
    last_attempt_at = clock_timestamp() - interval '11 minutes',
    updated_at = clock_timestamp() - interval '11 minutes'
where authoritative_record_id = 'stale-retention-claim';
alter table public.transactional_email_outbox enable trigger transactional_email_outbox_protected;
select public.redact_expired_notification_data(500);
select is((select status from public.transactional_email_outbox where authoritative_record_id = 'stale-retention-claim'), 'ambiguous', 'retention terminalizes a stale claimed provider attempt as ambiguous');
select is((select count(*) from public.notification_delivery_attempts a join public.transactional_email_outbox o on o.id = a.outbox_id where o.authoritative_record_id = 'stale-retention-claim' and a.outcome = 'ambiguous'), 1::bigint, 'retention preserves exactly one ambiguous-attempt reconciliation record');

select public.emit_private_notification('membership_approved', 'invalid-address-local', 1, '8a000000-0000-4000-8000-000000000001', '8a100000-0000-4000-8000-000000000007', '{"schema_version":1}', clock_timestamp());
alter table public.transactional_email_outbox disable trigger transactional_email_outbox_protected;
update public.transactional_email_outbox
set status = 'claimed', attempt_count = 1,
    terminal_at = null, next_attempt_at = null,
    claimed_at = clock_timestamp(), claimed_by = '8a500000-0000-4000-8000-000000000022',
    claim_token = '8a500000-0000-4000-8000-000000000023',
    first_attempt_at = clock_timestamp(), last_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
where authoritative_record_id = 'invalid-address-local';
alter table public.transactional_email_outbox enable trigger transactional_email_outbox_protected;
select public.complete_transactional_notification_delivery(
  (select id from public.transactional_email_outbox where authoritative_record_id = 'invalid-address-local'),
  '8a500000-0000-4000-8000-000000000023',
  'permanent_address', null, 'address_rejected'
);
select is((select reason from public.transactional_email_suppressions where recipient_user_id = '8a100000-0000-4000-8000-000000000007' and cleared_at is null), 'immediate_permanent', 'deterministic local address rejection suppresses the exact current association');
select is((select count(*) from public.private_notifications where event_type = 'email_delivery_suppressed' and recipient_user_id = '8a100000-0000-4000-8000-000000000007'), 1::bigint, 'immediate address rejection creates one recipient-visible in-app status');

select public.emit_private_notification('membership_approved', 'provider-off-retention', 1, '8a000000-0000-4000-8000-000000000001', '8a100000-0000-4000-8000-000000000008', '{"schema_version":1}', clock_timestamp());
alter table public.transactional_email_outbox disable trigger transactional_email_outbox_protected;
update public.transactional_email_outbox set created_at = clock_timestamp() - interval '25 hours', updated_at = clock_timestamp() - interval '25 hours' where authoritative_record_id = 'provider-off-retention';
alter table public.transactional_email_outbox enable trigger transactional_email_outbox_protected;
select public.redact_expired_notification_data(500);
select is((select status from public.transactional_email_outbox where authoritative_record_id = 'provider-off-retention'), 'permanent_failure', 'daily retention terminalizes provider-off pending work after 24 hours');
select ok(
  (select command = 'select public.redact_expired_notification_data(500);'
   from cron.job where jobname = 'gear-share-daily-notification-retention'),
  'bounded notification retention is declared daily'
);

select public.emit_private_notification(
  'email_delivery_suppressed', 'cursor-' || series::text, 1,
  '8a000000-0000-4000-8000-000000000002',
  '8a100000-0000-4000-8000-000000000006',
  '{"schema_version":1}'::jsonb,
  clock_timestamp() + (series || ' milliseconds')::interval
)
from generate_series(1, 31) series;
set local role authenticated;
select set_config('request.jwt.claim.sub', '8a100000-0000-4000-8000-000000000006', true);
select is((select count(*)::integer from public.my_private_notifications(null, null, 30)), 30, 'notification center returns an exact first page of 30');
select is(
  (
    with first_page as materialized (
      select * from public.my_private_notifications(null, null, 30)
    ), cursor_row as (
      select occurred_at, id from first_page order by occurred_at, id limit 1
    )
    select count(*)::integer
    from cursor_row c
    cross join lateral public.my_private_notifications(c.occurred_at, c.id, 30)
  ),
  1,
  'stable keyset cursor returns the remaining notification exactly once'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '8a100000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.private_notification_delivery_diagnostics('8a100000-0000-4000-8000-000000000006') $$,
  'P0001', 'same-community diagnostic target required',
  'Administrator cannot use diagnostics to probe a cross-community member'
);
reset role;

select * from finish();
rollback;
