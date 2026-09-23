alter table public.preapproved_member_invitations
  add column resend_count integer not null default 0,
  add column last_resent_at timestamptz,
  add constraint preapproved_invitation_resend_count_bounded
    check (resend_count between 0 and 5),
  add constraint preapproved_invitation_resend_time_consistent
    check ((resend_count = 0 and last_resent_at is null) or (resend_count > 0 and last_resent_at is not null));

create or replace function public.authorize_preapproved_member_invitation_resend(
  target_user_id uuid,
  supplied_email text
)
returns table(invitation_id uuid, normalized_email text, display_name text, accepted_user_id uuid)
language plpgsql security definer
set search_path to ''
set lock_timeout to '3s'
set statement_timeout to '10s'
as $$
declare
  caller_community uuid;
  email_value text := lower(btrim(coalesce(supplied_email, '')));
  matched public.preapproved_member_invitations%rowtype;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service role required'; end if;
  if target_user_id is null
    or length(email_value) not between 3 and 254
    or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'valid invitation details required';
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
  select i.* into matched
  from public.preapproved_member_invitations i
  join public.profiles p
    on p.community_id = i.community_id and p.id = i.accepted_user_id
  join auth.users u on u.id = i.accepted_user_id
  where i.community_id = caller_community
    and i.normalized_email = email_value
    and i.status = 'accepted'
    and p.membership_status = 'active'
    and lower(btrim(coalesce(u.email, ''))) = email_value
    and u.email_confirmed_at is null
  order by i.completed_at desc, i.id desc
  limit 1
  for update of i;

  if matched.id is null then raise exception 'resend unavailable'; end if;
  if matched.resend_count >= 5 then raise exception 'invitation resend limit reached'; end if;
  if matched.last_resent_at is not null and matched.last_resent_at > clock_timestamp() - interval '1 minute' then
    raise exception 'invitation resend cooldown active';
  end if;

  update public.preapproved_member_invitations i
  set resend_count = i.resend_count + 1,
      last_resent_at = clock_timestamp()
  where i.id = matched.id
  returning i.* into matched;

  return query select matched.id, matched.normalized_email, matched.display_name, matched.accepted_user_id;
end;
$$;

revoke all on function public.authorize_preapproved_member_invitation_resend(uuid, text) from public, anon, authenticated;
grant execute on function public.authorize_preapproved_member_invitation_resend(uuid, text) to service_role;
