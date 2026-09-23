alter table public.profiles
  add column account_deleted_at timestamptz,
  add column account_deleted_by uuid,
  add constraint profiles_account_deletion_completed_shape check (
    (account_deleted_at is null and account_deleted_by is null)
    or (
      account_deleted_at is not null
      and account_deleted_by is not null
      and membership_status = 'deactivated'
      and display_name = 'Deleted member'
    )
  ),
  add constraint profiles_account_deleter_same_community
    foreign key (community_id, account_deleted_by)
    references public.profiles(community_id, id) on delete restrict;

create table public.member_account_deletion_reservations (
  target_user_id uuid primary key,
  community_id uuid not null,
  deletion_token uuid not null unique default gen_random_uuid(),
  requested_by uuid not null,
  requested_at timestamptz not null default clock_timestamp(),
  constraint member_account_deletion_target_same_community
    foreign key (community_id, target_user_id)
    references public.profiles(community_id, id) on delete restrict,
  constraint member_account_deletion_requester_same_community
    foreign key (community_id, requested_by)
    references public.profiles(community_id, id) on delete restrict
);
alter table public.member_account_deletion_reservations enable row level security;
alter table public.member_account_deletion_reservations force row level security;
revoke all on table public.member_account_deletion_reservations from public, anon, authenticated, service_role;

create or replace function public.protect_account_deletion_state()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if coalesce(current_setting('app.account_deletion_change', true), '') <> 'allowed'
    or current_user <> pg_catalog.pg_get_userbyid(
      (select p.proowner from pg_catalog.pg_proc p
       where p.oid = 'public.reserve_deactivated_member_deletion(uuid)'::regprocedure)
    ) then
    raise exception 'account deletion state requires the reviewed workflow';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_account_deletion_state() from public;

create or replace function public.prevent_pending_account_reactivation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if old.membership_status = 'deactivated'
    and new.membership_status = 'active'
    and (old.account_deleted_at is not null or exists (
      select 1 from public.member_account_deletion_reservations r where r.target_user_id = old.id
    )) then
    raise exception 'deleted account cannot be reactivated';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_pending_account_reactivation() from public;

create or replace function public.reserve_deactivated_member_deletion(target_user_id uuid)
returns table(target_id uuid, deletion_token uuid, display_name text)
language plpgsql
security definer
set search_path to ''
set lock_timeout to '3s'
set statement_timeout to '8s'
as $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  target public.profiles%rowtype;
  token uuid;
begin
  if caller_id is null then raise exception 'authentication required'; end if;

  select p.community_id into caller_community
  from public.profiles p
  where p.id = caller_id;
  if caller_community is null then raise exception 'active administrator required'; end if;

  perform public.lock_community_authorization(caller_community, true);
  if not public.is_active_administrator(caller_community) then
    raise exception 'active administrator required';
  end if;

  select p.* into target
  from public.profiles p
  where p.id = target_user_id and p.community_id = caller_community
  for update;
  if target.id is null or target.membership_status <> 'deactivated' then
    raise exception 'deactivated member required';
  end if;
  if target.account_deleted_at is not null then raise exception 'account already deleted'; end if;

  insert into public.member_account_deletion_reservations (
    target_user_id, community_id, requested_by
  ) values (
    target.id, target.community_id, caller_id
  )
  on conflict on constraint member_account_deletion_reservations_pkey do update
    set requested_by = excluded.requested_by
  returning member_account_deletion_reservations.deletion_token into token;

  return query select target.id, token, target.display_name;
end;
$$;

revoke all on function public.reserve_deactivated_member_deletion(uuid) from public, anon, service_role;
grant execute on function public.reserve_deactivated_member_deletion(uuid) to authenticated;

create or replace function public.finalize_deactivated_member_deletion(
  target_user_id uuid,
  supplied_deletion_token uuid
)
returns void
language plpgsql
security definer
set search_path to ''
set lock_timeout to '3s'
set statement_timeout to '10s'
as $$
declare
  target public.profiles%rowtype;
  target_community uuid;
  reservation public.member_account_deletion_reservations%rowtype;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service role required'; end if;

  select p.community_id into target_community
  from public.profiles p
  where p.id = target_user_id;
  if target_community is null then raise exception 'deactivated member required'; end if;
  perform public.lock_community_authorization(target_community, true);

  select p.* into target
  from public.profiles p
  where p.id = target_user_id and p.community_id = target_community
  for update;
  select r.* into reservation
  from public.member_account_deletion_reservations r
  where r.target_user_id = target.id and r.community_id = target_community
  for update;
  if target.membership_status <> 'deactivated'
    or target.account_deleted_at is not null
    or supplied_deletion_token is null
    or reservation.deletion_token is distinct from supplied_deletion_token then
    raise exception 'valid account deletion reservation required';
  end if;

  delete from public.member_postal_codes p where p.profile_id = target.id;
  delete from public.member_profile_settings p where p.profile_id = target.id;
  update public.membership_applications a
  set answer_snapshot = '[]'::jsonb,
      redacted_at = coalesce(a.redacted_at, clock_timestamp())
  where a.applicant_id = target.id and a.redacted_at is null;
  delete from public.preapproved_member_invitations i where i.accepted_user_id = target.id;

  perform set_config('app.notification_internal_change', 'allowed', true);
  delete from public.transactional_email_preferences p where p.profile_id = target.id;
  delete from public.transactional_email_preference_audit a where a.profile_id = target.id;
  delete from public.transactional_email_suppression_audit a where a.recipient_user_id = target.id;
  delete from public.transactional_email_suppressions s where s.recipient_user_id = target.id;
  update public.transactional_email_outbox o
  set payload = '{}'::jsonb,
      email_snapshot = null,
      delivery_tag = null,
      provider_message_id = null,
      status = case when o.status in ('pending', 'claimed', 'retry') then 'invalidated' else o.status end,
      next_attempt_at = null,
      claimed_at = null,
      claimed_by = null,
      claim_token = null,
      terminal_at = coalesce(o.terminal_at, clock_timestamp()),
      redacted_at = coalesce(o.redacted_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where o.recipient_user_id = target.id and o.redacted_at is null;
  perform set_config('app.notification_internal_change', '', true);

  perform set_config('app.account_deletion_change', 'allowed', true);
  update public.profiles p
  set display_name = 'Deleted member',
      account_deleted_at = clock_timestamp(),
      account_deleted_by = reservation.requested_by,
      updated_at = clock_timestamp()
  where p.id = target.id;
  perform set_config('app.account_deletion_change', '', true);
  delete from public.member_account_deletion_reservations r where r.target_user_id = target.id;
end;
$$;

revoke all on function public.finalize_deactivated_member_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finalize_deactivated_member_deletion(uuid, uuid) to service_role;

create trigger profiles_account_deletion_protected
before update of account_deleted_at, account_deleted_by on public.profiles
for each row execute function public.protect_account_deletion_state();

create trigger profiles_pending_account_reactivation_blocked
before update of membership_status on public.profiles
for each row execute function public.prevent_pending_account_reactivation();

drop function public.private_member_administration();

create function public.private_member_administration()
returns table(
  id uuid,
  display_name text,
  account_email text,
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
    u.email::text,
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
    and p.account_deleted_at is null
    and p.membership_status in ('active', 'rejected', 'deactivated')
  order by p.display_name, p.id;
end;
$$;

revoke all on function public.private_member_administration() from public, anon;
grant execute on function public.private_member_administration() to authenticated;
