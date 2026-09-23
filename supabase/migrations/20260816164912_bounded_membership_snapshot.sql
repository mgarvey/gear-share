create or replace function public.my_membership_snapshot()
returns table (
  id uuid,
  community_id uuid,
  display_name text,
  membership_status text,
  access_level text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    profile.id,
    profile.community_id,
    profile.display_name,
    profile.membership_status::text,
    case
      when exists (
        select 1
        from public.community_roles as role
        where role.user_id = profile.id
          and role.community_id = profile.community_id
          and role.role = 'steward'::public.app_role
      ) then 'administrator'
      when exists (
        select 1
        from public.community_roles as role
        where role.user_id = profile.id
          and role.community_id = profile.community_id
          and role.role = 'custodian'::public.app_role
      ) then 'custodian'
      else 'regular'
    end as access_level
  from public.profiles as profile
  where profile.id = (select auth.uid())
  limit 1;
$$;

revoke all on function public.my_membership_snapshot() from public, anon;
grant execute on function public.my_membership_snapshot() to authenticated;
