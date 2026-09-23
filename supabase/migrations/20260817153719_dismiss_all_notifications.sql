create or replace function public.dismiss_all_my_notifications()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid := public.current_active_community_id();
  dismissed_count integer;
  action_time timestamptz := clock_timestamp();
begin
  if caller_id is null or caller_community is null then
    raise exception 'active member required';
  end if;

  perform set_config('app.notification_internal_change', 'allowed', true);
  update public.private_notifications n
  set dismissed_at = action_time,
      read_at = coalesce(n.read_at, action_time)
  where n.recipient_user_id = caller_id
    and n.community_id = caller_community
    and n.dismissed_at is null;
  get diagnostics dismissed_count = row_count;
  perform set_config('app.notification_internal_change', '', true);

  return dismissed_count;
end;
$$;

revoke all on function public.dismiss_all_my_notifications() from public;
revoke all on function public.dismiss_all_my_notifications() from anon;
grant execute on function public.dismiss_all_my_notifications() to authenticated;
