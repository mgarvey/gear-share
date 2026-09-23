create or replace function public.reserve_preapproved_member_invitation(
  target_user_id uuid,
  supplied_email text,
  supplied_display_name text
)
returns table(invitation_id uuid, normalized_email text, display_name text)
language plpgsql security definer
set search_path to ''
set lock_timeout to '3s'
set statement_timeout to '10s'
as $$
declare
  caller_community uuid;
  email_value text := lower(btrim(coalesce(supplied_email, '')));
  name_value text := regexp_replace(btrim(coalesce(supplied_display_name, '')), '[[:space:]]+', ' ', 'g');
  created public.preapproved_member_invitations%rowtype;
  reservation_time timestamptz;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service role required'; end if;
  if target_user_id is null then raise exception 'active administrator required'; end if;
  if length(email_value) not between 3 and 254
    or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'valid email address required';
  end if;

  select p.community_id into caller_community
  from public.profiles p
  where p.id = target_user_id;
  if caller_community is null then raise exception 'active administrator required'; end if;
  perform public.lock_community_authorization(caller_community, true);
  if not exists (
    select 1 from public.profiles p
    join public.community_roles r
      on r.community_id = p.community_id and r.user_id = p.id and r.role = 'steward'
    where p.id = target_user_id and p.community_id = caller_community
      and p.membership_status = 'active'
  ) then raise exception 'active administrator required'; end if;

  perform pg_advisory_xact_lock(hashtextextended('member-invitation:' || email_value, 0));
  update public.preapproved_member_invitations as i
  set status = 'failed', failure_code = 'expired', completed_at = clock_timestamp()
  where i.normalized_email = email_value and i.status = 'reserved' and i.expires_at <= clock_timestamp();

  -- A resend uses the already-reviewed name on the accepted invitation. Do not
  -- reject that path because of an irrelevant replacement name from the form.
  if exists (select 1 from auth.users u where lower(btrim(u.email)) = email_value) then
    raise exception 'account already exists';
  end if;

  if name_value = '' then name_value := 'Invited member'; end if;
  if not public.valid_plain_text(name_value, 80)
    or name_value is distinct from regexp_replace(btrim(name_value), '[[:space:]]+', ' ', 'g') then
    raise exception 'valid display name required';
  end if;

  if exists (
    select 1 from public.preapproved_member_invitations i
    where i.normalized_email = email_value and i.status = 'reserved'
  ) then raise exception 'invitation already in progress'; end if;
  if (
    select count(*) from public.preapproved_member_invitations i
    where i.created_by = target_user_id and i.created_at >= clock_timestamp() - interval '1 hour'
  ) >= 20 then raise exception 'invitation rate limit reached'; end if;

  reservation_time := clock_timestamp();
  insert into public.preapproved_member_invitations (
    community_id, normalized_email, display_name, created_by, created_at, expires_at
  ) values (
    caller_community, email_value, name_value, target_user_id, reservation_time, reservation_time + interval '15 minutes'
  ) returning * into created;

  return query select created.id, created.normalized_email, created.display_name;
end;
$$;

revoke all on function public.reserve_preapproved_member_invitation(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_preapproved_member_invitation(uuid, text, text) to service_role;
