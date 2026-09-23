create table public.preapproved_member_invitations (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete restrict,
  normalized_email text not null,
  display_name text not null,
  created_by uuid not null,
  status text not null default 'reserved',
  failure_code text,
  accepted_user_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  constraint preapproved_invitation_creator_same_community
    foreign key (community_id, created_by)
    references public.profiles(community_id, id) on delete restrict,
  constraint preapproved_invitation_account_same_community
    foreign key (community_id, accepted_user_id)
    references public.profiles(community_id, id) on delete restrict,
  constraint preapproved_invitation_email_normalized check (
    normalized_email = lower(btrim(normalized_email))
    and length(normalized_email) between 3 and 254
    and normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint preapproved_invitation_display_name check (
    public.valid_plain_text(display_name, 80)
    and display_name = regexp_replace(btrim(display_name), '[[:space:]]+', ' ', 'g')
  ),
  constraint preapproved_invitation_status check (status in ('reserved', 'accepted', 'failed')),
  constraint preapproved_invitation_failure check (
    (status = 'failed' and failure_code in ('provider', 'configuration', 'existing_account', 'expired') and accepted_user_id is null and completed_at is not null)
    or (status = 'accepted' and failure_code is null and accepted_user_id is not null and completed_at is not null)
    or (status = 'reserved' and failure_code is null and accepted_user_id is null and completed_at is null)
  ),
  constraint preapproved_invitation_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '15 minutes'
  )
);

alter table public.preapproved_member_invitations enable row level security;
alter table public.preapproved_member_invitations force row level security;
revoke all on table public.preapproved_member_invitations from public, anon, authenticated;
revoke all on table public.preapproved_member_invitations from service_role;

create unique index preapproved_invitation_live_email_unique
  on public.preapproved_member_invitations(normalized_email)
  where status = 'reserved';
create unique index preapproved_invitation_accepted_user_unique
  on public.preapproved_member_invitations(accepted_user_id)
  where accepted_user_id is not null;
create index preapproved_invitation_creator_rate_idx
  on public.preapproved_member_invitations(created_by, created_at desc);

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
  if target_user_id is null
    or length(email_value) not between 3 and 254
    or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'valid invitation details required';
  end if;
  if name_value = '' then name_value := 'Invited member'; end if;
  if not public.valid_plain_text(name_value, 80)
    or name_value is distinct from regexp_replace(btrim(name_value), '[[:space:]]+', ' ', 'g') then
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
  update public.preapproved_member_invitations as i
  set status = 'failed', failure_code = 'expired', completed_at = clock_timestamp()
  where i.normalized_email = email_value and i.status = 'reserved' and i.expires_at <= clock_timestamp();

  if exists (select 1 from auth.users u where lower(btrim(u.email)) = email_value) then
    raise exception 'account already exists';
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

create or replace function public.fail_preapproved_member_invitation(
  target_invitation_id uuid,
  supplied_failure_code text
)
returns text
language plpgsql security definer
set search_path to ''
as $$
declare changed uuid;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service role required'; end if;
  if target_invitation_id is null or supplied_failure_code not in ('provider', 'configuration', 'existing_account') then
    raise exception 'bounded invitation failure required';
  end if;
  update public.preapproved_member_invitations
  set status = 'failed', failure_code = supplied_failure_code, completed_at = clock_timestamp()
  where id = target_invitation_id and status = 'reserved'
  returning id into changed;
  return case when changed is null then 'unchanged' else 'failed' end;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
declare
  target_community uuid;
  supplied_name text;
  invitation public.preapproved_member_invitations%rowtype;
  authoritative_email text := lower(btrim(coalesce(new.email, '')));
begin
  select c.id into target_community from public.communities c
  where c.id = '7b000000-0000-4000-8000-000000000001'::uuid;
  if target_community is null then raise exception 'target community has not been seeded'; end if;

  perform pg_advisory_xact_lock(hashtextextended('member-invitation:' || authoritative_email, 0));

  select i.* into invitation
  from public.preapproved_member_invitations i
  where i.community_id = target_community
    and i.normalized_email = authoritative_email
    and i.status = 'reserved'
    and i.expires_at > clock_timestamp()
  order by i.created_at desc, i.id desc
  limit 1
  for update;

  supplied_name := case when invitation.id is not null then invitation.display_name
    else nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '') end;
  if supplied_name is null then supplied_name := case when invitation.id is null then 'Pending member' else 'Invited member' end; end if;
  if supplied_name ~ '[[:cntrl:]]' then raise exception 'invalid display name'; end if;
  supplied_name := regexp_replace(supplied_name, '[[:space:]]+', ' ', 'g');
  if not public.valid_plain_text(supplied_name, 80) then raise exception 'invalid display name'; end if;

  insert into public.profiles (
    id, community_id, display_name, membership_status, approved_by, approved_at
  ) values (
    new.id, target_community, supplied_name,
    case when invitation.id is null then 'pending'::public.membership_status else 'active'::public.membership_status end,
    case when invitation.id is null then null else invitation.created_by end,
    case when invitation.id is null then null else clock_timestamp() end
  );

  if invitation.id is not null then
    insert into public.community_roles (community_id, user_id, role, granted_by)
    values (target_community, new.id, 'member', invitation.created_by);
    update public.preapproved_member_invitations
    set status = 'accepted', accepted_user_id = new.id, completed_at = clock_timestamp()
    where id = invitation.id and status = 'reserved';
  end if;

  insert into public.join_question_versions (community_id, version, questions, published_by)
  values (target_community, 1, '[]'::jsonb, null)
  on conflict (community_id, version) do nothing;
  return new;
end;
$$;

revoke all on function public.reserve_preapproved_member_invitation(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fail_preapproved_member_invitation(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_preapproved_member_invitation(uuid, text, text) to service_role;
grant execute on function public.fail_preapproved_member_invitation(uuid, text) to service_role;
