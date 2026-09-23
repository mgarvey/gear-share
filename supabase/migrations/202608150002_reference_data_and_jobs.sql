-- Static application registries, private Storage buckets, and recurring jobs
-- are data rather than schema and are intentionally kept outside the generated
-- schema baseline.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('gear-images', 'gear-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('gear-image-staging', 'gear-image-staging', false, 2097152, array['image/jpeg'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

select set_config('app.milestone_six_internal_change', 'allowed', true);

insert into public.administrator_orientation_registry
  (registry_version, item_id, label, help_text, route_id, display_order, required, applicable_role)
values
  (1, 'review_membership', 'Review membership applications', 'Confirm each applicant before granting private-community access.', 'administration_members', 1, true, 'administrator'),
  (1, 'review_inventory', 'Review shared inventory authority', 'Confirm which active Custodians maintain group-owned gear.', 'inventory', 2, true, 'administrator'),
  (1, 'review_loans', 'Review formal loan operations', 'Understand request, approval, checkout, return, and Needs Attention states.', 'loans', 3, true, 'administrator'),
  (1, 'review_notifications', 'Review transactional notifications', 'Confirm private in-app notices and delivery diagnostics before provider activation.', 'notifications', 4, false, 'administrator'),
  (1, 'review_settings', 'Review community settings', 'Confirm the community display name and keep optional AI drafting safely disabled until every activation gate is current.', 'administration_settings', 5, true, 'administrator'),
  (1, 'review_privacy', 'Review privacy and terms', 'Review the member-facing privacy boundaries and highlighted exclusions.', 'privacy', 6, true, 'administrator')
on conflict do nothing;

select set_config('app.milestone_six_internal_change', '', true);

insert into public.notification_event_registry
  (event_type, category, email_required, email_enabled, in_app_title, in_app_body, app_route, email_subject, email_body, source_kind)
values
  ('membership_application_pending', 'membership_access', true, true, 'Membership application ready', 'A membership application is ready for Administrator review.', '/administration', 'Membership application ready', 'A membership application is ready for review. Sign in to the private application for details.', 'membership_application'),
  ('membership_approved', 'membership_access', true, true, 'Membership approved', 'Your membership application was approved. You can now use the private gear share.', '/catalog', 'Membership approved', 'Your membership application was approved. Sign in to the private application to continue.', 'membership'),
  ('membership_rejected', 'membership_access', true, true, 'Membership decision', 'Your membership application was not approved.', '/account', 'Membership decision', 'Your membership application was not approved. Contact an Administrator if you need help.', 'membership'),
  ('role_promoted', 'role_access', true, true, 'Access level changed', 'An Administrator granted you an elevated access level.', '/account', 'Access level changed', 'Your private gear-share access level changed. Sign in to review your current access.', 'role_audit'),
  ('role_demoted', 'role_access', true, true, 'Access level changed', 'An Administrator changed your access level.', '/account', 'Access level changed', 'Your private gear-share access level changed. Sign in to review your current access.', 'role_audit'),
  ('membership_deactivated', 'role_access', true, true, 'Membership deactivated', 'An Administrator deactivated your membership.', '/account', 'Membership deactivated', 'Your private gear-share membership was deactivated. Contact an Administrator if you need help.', 'membership'),
  ('membership_reactivated', 'role_access', true, true, 'Membership reactivated', 'An Administrator restored your Regular membership.', '/account', 'Membership reactivated', 'Your Regular membership was restored. Sign in to the private application to continue.', 'membership'),
  ('loan_requested', 'loan_activity', false, true, 'Loan request submitted', 'A formal gear-loan request was submitted.', '/loans', 'Loan request submitted', 'A formal gear-loan request was submitted. Sign in to the private application for details.', 'loan'),
  ('loan_approved', 'loan_activity', false, true, 'Loan request approved', 'A formal gear-loan request was approved.', '/loans', 'Loan request approved', 'A formal gear-loan request was approved. Sign in to the private application for details.', 'loan'),
  ('loan_declined', 'loan_activity', false, true, 'Loan request declined', 'A formal gear-loan request was declined.', '/loans', 'Loan request declined', 'A formal gear-loan request was declined. Sign in to the private application for details.', 'loan'),
  ('loan_checked_out', 'loan_activity', false, true, 'Gear checked out', 'A formal gear loan was checked out.', '/loans', 'Gear checked out', 'A formal gear loan was checked out. Sign in to the private application for details.', 'loan'),
  ('loan_cancelled', 'loan_activity', false, true, 'Loan cancelled', 'A formal gear-loan request was cancelled.', '/loans', 'Loan cancelled', 'A formal gear-loan request was cancelled. Sign in to the private application for details.', 'loan'),
  ('loan_returned', 'loan_activity', false, true, 'Gear returned', 'A formal gear loan was recorded as returned.', '/loans', 'Gear returned', 'A formal gear loan was recorded as returned. Sign in to the private application for details.', 'loan'),
  ('loan_due_soon', 'loan_reminders', false, true, 'Gear return due soon', 'A checked-out gear loan reaches its return date soon.', '/loans', 'Gear return due soon', 'A checked-out gear loan reaches its return date soon. Sign in to the private application for details.', 'loan_reminder'),
  ('loan_first_overdue', 'loan_reminders', false, true, 'Gear return overdue', 'A checked-out gear loan is overdue for return.', '/loans', 'Gear return overdue', 'A checked-out gear loan is overdue for return. Sign in to the private application for details.', 'loan_reminder'),
  ('loan_weekly_overdue', 'loan_reminders', false, true, 'Gear remains overdue', 'A checked-out gear loan remains overdue for return.', '/loans', 'Gear remains overdue', 'A checked-out gear loan remains overdue for return. Sign in to the private application for details.', 'loan_reminder'),
  ('wanted_request_created', 'wanted_activity', false, true, 'Wanted request created', 'A private wanted-gear request was created.', '/wanted', 'Wanted request created', 'A private wanted-gear request was created. Sign in to the private application for details.', 'wanted'),
  ('wanted_offer_created', 'wanted_activity', false, true, 'Gear offered', 'A member offered gear for a private wanted request.', '/wanted', 'Gear offered', 'Gear was offered for a private wanted request. Sign in to the private application for details.', 'wanted'),
  ('wanted_offer_selected', 'wanted_activity', false, true, 'Gear offer selected', 'An offer was selected for a private wanted request.', '/wanted', 'Gear offer selected', 'An offer was selected for a private wanted request. Sign in to the private application for details.', 'wanted'),
  ('wanted_offer_invalidated', 'wanted_activity', false, true, 'Gear offer unavailable', 'An offer on a private wanted request is no longer available.', '/wanted', 'Gear offer unavailable', 'An offer on a private wanted request is no longer available. Sign in to the private application for details.', 'wanted'),
  ('wanted_request_moderated', 'wanted_activity', false, true, 'Wanted request moderated', 'An Administrator moderated a private wanted request.', '/wanted', 'Wanted request moderated', 'A private wanted request was moderated. Sign in to the private application for details.', 'wanted'),
  ('wanted_request_restored', 'wanted_activity', false, true, 'Wanted request restored', 'An Administrator restored a private wanted request.', '/wanted', 'Wanted request restored', 'A private wanted request was restored. Sign in to the private application for details.', 'wanted'),
  ('email_delivery_suppressed', 'delivery_status', true, false, 'Email delivery paused', 'Transactional email to your confirmed address is paused. In-app notifications remain available.', '/account', 'Email delivery paused', 'Transactional email delivery is paused. Sign in to review your account.', 'delivery')
on conflict do nothing;

select cron.schedule(
  'gear-share-membership-answer-redaction',
  '17 3 * * *',
  'select public.redact_expired_membership_answers(500);'
);

select cron.schedule(
  'gear-share-hourly-loan-reminders',
  '17 * * * *',
  'select public.enqueue_due_loan_reminders(clock_timestamp(), 500);'
);

select cron.schedule(
  'gear-share-daily-notification-retention',
  '31 4 * * *',
  'select public.redact_expired_notification_data(500);'
);
