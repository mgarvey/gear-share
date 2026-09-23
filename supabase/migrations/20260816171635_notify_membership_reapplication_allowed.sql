insert into public.notification_event_registry (
  event_type, category, email_required, email_enabled,
  in_app_title, in_app_body, app_route,
  email_subject, email_body, source_kind
) values (
  'membership_reapplication_allowed', 'membership_access', true, true,
  'You may apply again',
  'An administrator has invited you to submit a new membership application.',
  '/join',
  'You may apply again',
  'An administrator has invited you to submit a new membership application. Use the application link to apply again.',
  'membership_application'
);

create or replace function public.notify_membership_application_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and not (
    old.redacted_at is not null
    and new.redacted_at is null
    and new.decided_at is null
    and new.submission_count = old.submission_count + 1
  ) then
    return new;
  end if;
  perform public.emit_notification_to_active_administrators(
    'membership_application_pending',
    new.id::text,
    new.submission_count,
    new.community_id,
    '{"schema_version":1}'::jsonb,
    new.submitted_at
  );
  return new;
end;
$$;

drop trigger if exists membership_application_notification on public.membership_applications;
create trigger membership_application_notification
after insert or update on public.membership_applications
for each row execute function public.notify_membership_application_insert();

create or replace function public.allow_membership_reapplication(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
set statement_timeout = '5s'
as $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  application_id uuid;
begin
  if caller_id is null or target_user_id is null then
    raise exception 'active administrator required';
  end if;
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_community is null then raise exception 'active administrator required'; end if;
  perform public.lock_community_authorization(caller_community, true);
  if not public.is_active_administrator(caller_community) then
    raise exception 'active administrator required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = target_user_id
      and p.community_id = caller_community
      and p.membership_status = 'rejected'
    for update
  ) then
    raise exception 'rejected same-community applicant required';
  end if;

  update public.membership_applications
  set decided_at = null,
      redacted_at = clock_timestamp(),
      answer_snapshot = '[]'::jsonb,
      answer_count = 0
  where applicant_id = target_user_id and community_id = caller_community
  returning id into application_id;
  if application_id is null then raise exception 'rejected membership application required'; end if;

  update public.profiles
  set membership_status = 'pending'
  where id = target_user_id and community_id = caller_community and membership_status = 'rejected';

  perform public.emit_private_notification(
    'membership_reapplication_allowed',
    application_id::text,
    txid_current(),
    caller_community,
    target_user_id,
    '{"schema_version":1}'::jsonb,
    clock_timestamp()
  );
end;
$$;

revoke all on function public.allow_membership_reapplication(uuid) from public, anon;
grant execute on function public.allow_membership_reapplication(uuid) to authenticated;
