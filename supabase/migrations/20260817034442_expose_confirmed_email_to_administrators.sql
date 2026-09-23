drop function public.private_member_administration();

create function public.private_member_administration()
returns table(
  id uuid,
  display_name text,
  confirmed_email text,
  membership_status text,
  access_level text
)
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
  select
    p.id,
    p.display_name,
    case when u.email_confirmed_at is not null then u.email::text else null end,
    p.membership_status::text,
    case
      when p.membership_status in ('rejected', 'deactivated') then 'regular'
      when exists (
        select 1 from public.community_roles r
        where r.community_id = caller_community
          and r.user_id = p.id
          and r.role = 'steward'
      ) then 'administrator'
      when exists (
        select 1 from public.community_roles r
        where r.community_id = caller_community
          and r.user_id = p.id
          and r.role = 'custodian'
      ) then 'custodian'
      else 'regular'
    end
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.community_id = caller_community
    and p.membership_status in ('active', 'rejected', 'deactivated')
  order by p.display_name, p.id;
end;
$$;

revoke all on function public.private_member_administration() from public, anon;
grant execute on function public.private_member_administration() to authenticated;
