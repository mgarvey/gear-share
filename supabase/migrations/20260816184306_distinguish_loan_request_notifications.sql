insert into public.notification_event_registry (
  event_type, category, email_required, email_enabled,
  in_app_title, in_app_body, app_route,
  email_subject, email_body, source_kind
) values (
  'loan_request_received', 'loan_activity', false, true,
  'New borrowing request',
  'A member asked to borrow gear. Review the request in Gear Share.',
  '/loans',
  'New borrowing request',
  'A member asked to borrow gear. Open Gear Share to review the item, dates, and quantity.',
  'loan'
);

alter table public.notification_event_registry disable trigger notification_event_registry_immutable;

update public.notification_event_registry registry
set in_app_title = copy.in_app_title,
    in_app_body = copy.in_app_body,
    email_subject = copy.email_subject,
    email_body = copy.email_body
from (values
  ('membership_application_pending', 'New membership application', 'Someone applied to join. Review the application in Gear Share.', 'New membership application', 'Someone applied to join. Open Gear Share to review their application.'),
  ('membership_approved', 'You are approved', 'Your membership is approved. You can now use Gear Share.', 'You are approved', 'Your membership is approved. You can now sign in and start sharing gear.'),
  ('membership_rejected', 'Application not approved', 'Your membership application was not approved. Open Gear Share for next steps.', 'Application not approved', 'Your membership application was not approved. Open Gear Share to see what you can do next.'),
  ('membership_reapplication_allowed', 'You can apply again', 'An administrator has invited you to submit a new application.', 'You can apply again', 'An administrator has invited you to submit a new membership application. Open Gear Share when you are ready.'),
  ('role_promoted', 'Your access changed', 'You have new Gear Share permissions. Open your account to review them.', 'Your access changed', 'You have new Gear Share permissions. Open your account to see what you can do.'),
  ('role_demoted', 'Your access changed', 'Your Gear Share permissions changed. Open your account to review them.', 'Your access changed', 'Your Gear Share permissions changed. Open your account to see what you can do.'),
  ('membership_deactivated', 'Membership paused', 'An administrator paused your membership. Open Gear Share for next steps.', 'Membership paused', 'An administrator paused your membership. Open Gear Share for next steps.'),
  ('membership_reactivated', 'Membership restored', 'Your membership is active again. You can use Gear Share.', 'Membership restored', 'Your membership is active again. You can sign in and use Gear Share.'),
  ('loan_requested', 'Request sent', 'Your borrowing request was sent. Follow its status in Gear Share.', 'Request sent', 'Your borrowing request was sent. Open Gear Share to follow its status.'),
  ('loan_request_received', 'New borrowing request', 'A member asked to borrow gear. Review the request in Gear Share.', 'New borrowing request', 'A member asked to borrow gear. Open Gear Share to review the item, dates, and quantity.'),
  ('loan_approved', 'Borrowing request approved', 'A borrowing request was approved. Review pickup details in Gear Share.', 'Borrowing request approved', 'A borrowing request was approved. Open Gear Share to review pickup details.'),
  ('loan_declined', 'Borrowing request declined', 'A borrowing request was not approved. Review its status in Gear Share.', 'Borrowing request declined', 'A borrowing request was not approved. Open Gear Share to review its status.'),
  ('loan_checked_out', 'Gear checked out', 'Gear has been checked out. Review the loan and return date in Gear Share.', 'Gear checked out', 'Gear has been checked out. Open Gear Share to review the loan and return date.'),
  ('loan_cancelled', 'Borrowing request cancelled', 'A borrowing request was cancelled. Review its status in Gear Share.', 'Borrowing request cancelled', 'A borrowing request was cancelled. Open Gear Share to review its status.'),
  ('loan_returned', 'Gear returned', 'Gear was marked returned. Review the completed loan in Gear Share.', 'Gear returned', 'Gear was marked returned. Open Gear Share to review the completed loan.'),
  ('loan_due_soon', 'Gear is due back soon', 'Gear is due back soon. Check the return date in Gear Share.', 'Gear is due back soon', 'Gear is due back soon. Open Gear Share to check the return date.'),
  ('loan_first_overdue', 'Gear is overdue', 'Gear is past its return date. Review the loan in Gear Share.', 'Gear is overdue', 'Gear is past its return date. Open Gear Share to review the loan.'),
  ('loan_weekly_overdue', 'Gear is still overdue', 'Gear is still overdue. Review the loan and arrange its return.', 'Gear is still overdue', 'Gear is still overdue. Open Gear Share to review the loan and arrange its return.'),
  ('wanted_request_created', 'Wanted request posted', 'A wanted request was posted. View it in Gear Share.', 'Wanted request posted', 'A wanted request was posted. Open Gear Share to view it.'),
  ('wanted_offer_created', 'Gear offered', 'A member offered gear for a wanted request. Review the offer in Gear Share.', 'Gear offered', 'A member offered gear for a wanted request. Open Gear Share to review the offer.'),
  ('wanted_offer_selected', 'Gear offer selected', 'A gear offer was selected. Review the match in Gear Share.', 'Gear offer selected', 'A gear offer was selected. Open Gear Share to review the match.'),
  ('wanted_offer_invalidated', 'Offered gear unavailable', 'Offered gear is no longer available. Review other options in Gear Share.', 'Offered gear unavailable', 'Offered gear is no longer available. Open Gear Share to review other options.'),
  ('wanted_request_moderated', 'Wanted request hidden', 'An administrator hid a wanted request from the community board.', 'Wanted request hidden', 'An administrator hid a wanted request from the community board. Open Gear Share to review it.'),
  ('wanted_request_restored', 'Wanted request restored', 'An administrator restored a wanted request to the community board.', 'Wanted request restored', 'An administrator restored a wanted request to the community board. Open Gear Share to review it.'),
  ('email_delivery_suppressed', 'Email notifications paused', 'We paused email notifications because delivery failed. In-app notifications still work.', 'Email notifications paused', 'We paused email notifications because delivery failed. Open account settings for next steps.')
) as copy(event_type, in_app_title, in_app_body, email_subject, email_body)
where registry.event_type = copy.event_type;

alter table public.notification_event_registry enable trigger notification_event_registry_immutable;

create or replace function public.notify_loan_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
  occurred timestamptz := clock_timestamp();
  version bigint := txid_current();
  recipient uuid;
  item public.supplies%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then return new; end if;
    event_name := 'loan_requested';
    occurred := new.created_at;
  else
    if new.status is not distinct from old.status then return new; end if;
    event_name := case new.status
      when 'approved' then 'loan_approved'
      when 'declined' then 'loan_declined'
      when 'checked_out' then 'loan_checked_out'
      when 'cancelled' then 'loan_cancelled'
      when 'returned' then 'loan_returned'
      else null
    end;
    if event_name is null then return new; end if;
    occurred := case new.status
      when 'approved' then coalesce(new.decided_at, occurred)
      when 'declined' then coalesce(new.decided_at, occurred)
      when 'checked_out' then coalesce(new.checked_out_at, occurred)
      when 'cancelled' then coalesce(new.cancelled_at, occurred)
      when 'returned' then coalesce(new.returned_at, occurred)
      else occurred
    end;
  end if;

  perform public.emit_private_notification(
    event_name, new.id::text, version, new.community_id, new.borrower_id,
    '{"schema_version":1}'::jsonb, occurred
  );

  if tg_op = 'INSERT' then
    event_name := 'loan_request_received';
  end if;

  select * into item from public.supplies s
  where s.id = new.supply_id and s.community_id = new.community_id;
  if item.id is null then raise exception 'notification source listing unavailable'; end if;

  if new.handoff_contact_id is not null then
    perform public.emit_private_notification(
      event_name, new.id::text, version, new.community_id, new.handoff_contact_id,
      '{"schema_version":1}'::jsonb, occurred
    );
  elsif new.status = 'declined' then
    recipient := coalesce(new.decided_by, new.cancelled_by);
    if recipient is not null then
      perform public.emit_private_notification(
        event_name, new.id::text, version, new.community_id, recipient,
        '{"schema_version":1}'::jsonb, occurred
      );
    end if;
  elsif new.status = 'cancelled' then
    if new.cancelled_by is not null then
      perform public.emit_private_notification(
        event_name, new.id::text, version, new.community_id, new.cancelled_by,
        '{"schema_version":1}'::jsonb, occurred
      );
    end if;
    if item.ownership_kind = 'individual' then
      perform public.emit_private_notification(
        event_name, new.id::text, version, new.community_id, item.owner_id,
        '{"schema_version":1}'::jsonb, occurred
      );
    else
      for recipient in
        select distinct p.id from public.profiles p
        join public.community_roles r on r.community_id = p.community_id and r.user_id = p.id
        where p.community_id = new.community_id and p.membership_status = 'active'
          and r.role in ('custodian', 'steward') order by p.id
      loop
        perform public.emit_private_notification(
          event_name, new.id::text, version, new.community_id, recipient,
          '{"schema_version":1}'::jsonb, occurred
        );
      end loop;
    end if;
  elsif item.ownership_kind = 'individual' then
    perform public.emit_private_notification(
      event_name, new.id::text, version, new.community_id, item.owner_id,
      '{"schema_version":1}'::jsonb, occurred
    );
  else
    for recipient in
      select distinct p.id
      from public.profiles p
      join public.community_roles r
        on r.community_id = p.community_id and r.user_id = p.id
      where p.community_id = new.community_id and p.membership_status = 'active'
        and r.role in ('custodian', 'steward')
      order by p.id
    loop
      perform public.emit_private_notification(
        event_name, new.id::text, version, new.community_id, recipient,
        '{"schema_version":1}'::jsonb, occurred
      );
    end loop;
  end if;
  return new;
end;
$$;
