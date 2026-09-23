create or replace function public.emit_private_notification(
  supplied_event_type text,
  supplied_authoritative_record_id text,
  supplied_transition_version bigint,
  supplied_community_id uuid,
  supplied_recipient_user_id uuid,
  supplied_payload jsonb default '{"schema_version": 1}'::jsonb,
  supplied_occurred_at timestamptz default clock_timestamp()
) returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  registry public.notification_event_registry%rowtype;
  notification_id uuid;
  recipient_email text;
  initial_status text;
  preference_enabled boolean := true;
begin
  select * into registry from public.notification_event_registry r
  where r.event_type = supplied_event_type;
  if not found then raise exception 'registered notification event required'; end if;
  if supplied_authoritative_record_id is null
    or length(supplied_authoritative_record_id) not between 1 and 80
    or supplied_transition_version is null or supplied_transition_version <= 0
    or supplied_occurred_at is null
    or not public.valid_notification_payload(supplied_event_type, supplied_payload) then
    raise exception 'bounded registered notification payload required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = supplied_recipient_user_id and p.community_id = supplied_community_id
  ) then raise exception 'same-community notification recipient required'; end if;

  insert into public.private_notifications (
    community_id, recipient_user_id, event_type, authoritative_record_id,
    transition_version, title, body, app_route, occurred_at
  ) values (
    supplied_community_id, supplied_recipient_user_id, supplied_event_type,
    supplied_authoritative_record_id, supplied_transition_version,
    registry.in_app_title, registry.in_app_body, registry.app_route, supplied_occurred_at
  ) on conflict (event_type, authoritative_record_id, transition_version, recipient_user_id)
    do nothing
  returning id into notification_id;
  if notification_id is null then
    select n.id into notification_id from public.private_notifications n
    where n.event_type = supplied_event_type
      and n.authoritative_record_id = supplied_authoritative_record_id
      and n.transition_version = supplied_transition_version
      and n.recipient_user_id = supplied_recipient_user_id;
    return notification_id;
  end if;

  if not registry.email_enabled
    or supplied_recipient_user_id = auth.uid() then
    return notification_id;
  end if;

  select lower(btrim(u.email::text)) into recipient_email
  from auth.users u
  where u.id = supplied_recipient_user_id and u.email_confirmed_at is not null
    and u.email is not null and length(btrim(u.email::text)) between 3 and 254;

  if registry.category = 'loan_activity' then
    select coalesce(p.loan_activity, true) into preference_enabled
    from public.transactional_email_preferences p
    where p.profile_id = supplied_recipient_user_id and p.community_id = supplied_community_id;
    preference_enabled := coalesce(preference_enabled, true);
  elsif registry.category = 'loan_reminders' then
    select coalesce(p.loan_reminders, true) into preference_enabled
    from public.transactional_email_preferences p
    where p.profile_id = supplied_recipient_user_id and p.community_id = supplied_community_id;
    preference_enabled := coalesce(preference_enabled, true);
  elsif registry.category = 'wanted_activity' then
    select coalesce(p.wanted_activity, true) into preference_enabled
    from public.transactional_email_preferences p
    where p.profile_id = supplied_recipient_user_id and p.community_id = supplied_community_id;
    preference_enabled := coalesce(preference_enabled, true);
  end if;

  if recipient_email is null then
    initial_status := 'permanent_failure';
  elsif exists (
    select 1 from public.transactional_email_suppressions s
    where s.recipient_user_id = supplied_recipient_user_id
      and s.normalized_email = recipient_email and s.cleared_at is null
  ) then
    initial_status := 'address_suppressed';
  elsif not registry.email_required and not preference_enabled then
    initial_status := 'preference_suppressed';
  else
    initial_status := 'pending';
  end if;

  insert into public.transactional_email_outbox (
    notification_id, community_id, recipient_user_id, event_type,
    authoritative_record_id, transition_version, payload, email_snapshot,
    delivery_tag, status, next_attempt_at, terminal_at
  ) values (
    notification_id, supplied_community_id, supplied_recipient_user_id,
    supplied_event_type, supplied_authoritative_record_id,
    supplied_transition_version, supplied_payload, recipient_email,
    gen_random_uuid(), initial_status,
    case when initial_status = 'pending' then clock_timestamp() else null end,
    case when initial_status = 'pending' then null else clock_timestamp() end
  ) on conflict (event_type, authoritative_record_id, transition_version, recipient_user_id)
    do nothing;
  return notification_id;
end;
$$;

insert into public.notification_event_registry (
  event_type, category, email_required, email_enabled,
  in_app_title, in_app_body, app_route,
  email_subject, email_body, source_kind
) values
  (
    'membership_deactivated_admin', 'role_access', true, true,
    'Member membership paused', 'A member''s membership was paused. Review member access in Gear Share.', '/administration',
    'Member membership paused', 'A member''s membership was paused. Open Gear Share to review member access.', 'membership'
  ),
  (
    'membership_reactivated_admin', 'role_access', true, true,
    'Member membership restored', 'A member''s membership was restored. Review member access in Gear Share.', '/administration',
    'Member membership restored', 'A member''s membership was restored. Open Gear Share to review member access.', 'membership'
  ),
  (
    'role_promoted_admin', 'role_access', true, true,
    'Member access increased', 'A member received additional Gear Share permissions. Review member access in Gear Share.', '/administration',
    'Member access increased', 'A member received additional Gear Share permissions. Open Gear Share to review member access.', 'role_audit'
  ),
  (
    'role_demoted_admin', 'role_access', true, true,
    'Member access reduced', 'A member''s Gear Share permissions were reduced. Review member access in Gear Share.', '/administration',
    'Member access reduced', 'A member''s Gear Share permissions were reduced. Open Gear Share to review member access.', 'role_audit'
  )
on conflict (event_type) do nothing;

create or replace function public.notify_membership_status_transition()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  event_name text;
  administrator_event_name text;
  occurred timestamptz := clock_timestamp();
  version bigint := txid_current();
begin
  if new.membership_status is not distinct from old.membership_status then return new; end if;
  event_name := case
    when old.membership_status = 'pending' and new.membership_status = 'active' then 'membership_approved'
    when old.membership_status = 'pending' and new.membership_status = 'rejected' then 'membership_rejected'
    when old.membership_status = 'active' and new.membership_status = 'deactivated' then 'membership_deactivated'
    when old.membership_status = 'deactivated' and new.membership_status = 'active' then 'membership_reactivated'
    else null
  end;
  if event_name is null then return new; end if;
  occurred := case event_name
    when 'membership_approved' then coalesce(new.approved_at, occurred)
    when 'membership_rejected' then coalesce(new.rejected_at, occurred)
    when 'membership_deactivated' then coalesce(new.deactivated_at, occurred)
    else occurred
  end;
  if event_name in ('membership_deactivated', 'membership_reactivated') then
    select coalesce((
      select c.deactivation_sequence
      from public.membership_deactivation_consequences c
      where c.profile_id = new.id and c.community_id = new.community_id
      order by c.deactivation_sequence desc limit 1
    ), version) into version;
  end if;
  perform public.emit_private_notification(
    event_name, new.id::text, version, new.community_id, new.id,
    '{"schema_version":1}'::jsonb, occurred
  );
  administrator_event_name := case event_name
    when 'membership_deactivated' then 'membership_deactivated_admin'
    when 'membership_reactivated' then 'membership_reactivated_admin'
    else null
  end;
  if administrator_event_name is not null then
    perform public.emit_notification_to_active_administrators(
      administrator_event_name, new.id::text, version, new.community_id,
      '{"schema_version":1}'::jsonb, occurred
    );
  end if;
  return new;
end;
$$;

create or replace function public.notify_role_audit_insert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  event_name text;
  administrator_event_name text;
  recipient uuid;
begin
  event_name := case new.action
    when 'promote' then 'role_promoted'
    when 'demote' then 'role_demoted'
    else null
  end;
  if event_name is null then return new; end if;
  administrator_event_name := case new.action
    when 'promote' then 'role_promoted_admin'
    when 'demote' then 'role_demoted_admin'
  end;
  perform public.emit_private_notification(
    event_name, new.id::text, 1, new.community_id, new.target_user_id,
    '{"schema_version":1}'::jsonb, new.occurred_at
  );
  for recipient in
    select distinct p.id
    from public.profiles p
    join public.community_roles r
      on r.community_id = p.community_id and r.user_id = p.id and r.role = 'steward'
    where p.community_id = new.community_id
      and p.membership_status = 'active'
      and p.id <> new.target_user_id
    order by p.id
  loop
    perform public.emit_private_notification(
      administrator_event_name, new.id::text, 1, new.community_id, recipient,
      '{"schema_version":1}'::jsonb, new.occurred_at
    );
  end loop;
  return new;
end;
$$;
