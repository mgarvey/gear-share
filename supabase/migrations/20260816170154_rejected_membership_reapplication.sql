create or replace function public.private_member_administration()
returns table(id uuid, display_name text, membership_status text, access_level text)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  caller_community uuid := public.current_active_community_id();
begin
  if caller_community is null or not public.is_active_administrator(caller_community) then
    raise exception 'active administrator required';
  end if;
  return query
  select p.id, p.display_name, p.membership_status::text,
    case
      when p.membership_status in ('rejected', 'deactivated') then 'regular'
      when exists (
        select 1 from public.community_roles r
        where r.community_id = caller_community and r.user_id = p.id and r.role = 'steward'
      ) then 'administrator'
      when exists (
        select 1 from public.community_roles r
        where r.community_id = caller_community and r.user_id = p.id and r.role = 'custodian'
      ) then 'custodian'
      else 'regular'
    end
  from public.profiles p
  where p.community_id = caller_community
    and p.membership_status in ('active', 'rejected', 'deactivated')
  order by p.display_name, p.id;
end;
$$;

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
  where applicant_id = target_user_id and community_id = caller_community;
  if not found then raise exception 'rejected membership application required'; end if;

  update public.profiles
  set membership_status = 'pending'
  where id = target_user_id and community_id = caller_community and membership_status = 'rejected';
end;
$$;

revoke all on function public.allow_membership_reapplication(uuid) from public, anon;
grant execute on function public.allow_membership_reapplication(uuid) to authenticated;
