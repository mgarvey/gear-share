alter table public.supplies
  add column wanted_only boolean not null default false;

alter table public.supplies
  add constraint supplies_wanted_only_unlisted
  check (not wanted_only or listing_status <> 'listed');

alter table public.wanted_offers
  alter column supply_id drop not null,
  add column offer_kind text not null default 'listing',
  add column offered_quantity integer;

alter table public.wanted_offers
  add constraint wanted_offers_kind_shape check (
    (offer_kind = 'listing' and supply_id is not null and offered_quantity is null)
    or
    (offer_kind = 'one_off' and offered_quantity between 1 and 99)
  );

create unique index wanted_offers_one_active_one_off_per_member
  on public.wanted_offers (request_id, offerer_id)
  where offer_kind = 'one_off' and status in ('active', 'selected');

create or replace function public.offer_wanted_once(
  target_request_id uuid,
  supplied_quantity integer,
  supplied_note text default null
) returns public.wanted_offers
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
set statement_timeout = '5s'
as $$
declare
  caller_id uuid := auth.uid();
  req public.wanted_requests%rowtype;
  created public.wanted_offers;
begin
  if caller_id is null then raise exception 'authentication required'; end if;
  select * into req from public.wanted_requests r where r.id = target_request_id;
  if not found then raise exception 'open same-community wanted request required'; end if;
  perform public.lock_community_authorization(req.community_id, false);
  select * into req from public.wanted_requests r where r.id = target_request_id for update;
  if not public.is_active_member(req.community_id)
    or req.status <> 'open'
    or req.requester_id = caller_id then
    raise exception 'open same-community wanted request required';
  end if;
  if supplied_quantity is null or supplied_quantity < 1
    or supplied_quantity > req.desired_quantity then
    raise exception 'offered quantity must fit the wanted request';
  end if;
  if nullif(btrim(supplied_note), '') is not null
    and not public.valid_plain_text(btrim(supplied_note), 500, false) then
    raise exception 'invalid offer note';
  end if;
  insert into public.wanted_offers (
    community_id, request_id, supply_id, offerer_id, note,
    offer_kind, offered_quantity
  ) values (
    req.community_id, req.id, null, caller_id, nullif(btrim(supplied_note), ''),
    'one_off', supplied_quantity
  ) returning * into created;
  perform public.emit_wanted_notification(
    'wanted_offer_created', created.id, created.transition_version,
    created.community_id, array[req.requester_id, created.offerer_id], false
  );
  return created;
end;
$$;

revoke all on function public.offer_wanted_once(uuid, integer, text) from public;
grant execute on function public.offer_wanted_once(uuid, integer, text) to authenticated;

drop function public.private_wanted_offers(uuid);

create function public.private_wanted_offers(target_request_id uuid)
returns table(
  id uuid,
  request_id uuid,
  supply_id uuid,
  supply_title text,
  offerer_id uuid,
  offerer_name text,
  note text,
  status public.wanted_offer_status,
  transition_version bigint,
  created_at timestamptz,
  offer_kind text,
  offered_quantity integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  req public.wanted_requests%rowtype;
  caller_community uuid := public.current_active_community_id();
begin
  if caller_community is null then raise exception 'active member required'; end if;
  select * into req from public.wanted_requests r where r.id = target_request_id;
  if not found or req.community_id <> caller_community
    or (req.status = 'moderated' and not public.is_active_administrator(caller_community)) then
    raise exception 'wanted request unavailable';
  end if;
  return query
    select o.id, o.request_id, o.supply_id, coalesce(s.title, req.title),
      o.offerer_id, p.display_name, o.note, o.status, o.transition_version,
      o.created_at, o.offer_kind, o.offered_quantity
    from public.wanted_offers o
    left join public.supplies s
      on s.id = o.supply_id and s.community_id = o.community_id
    join public.profiles p
      on p.id = o.offerer_id and p.community_id = o.community_id
    where o.request_id = req.id and o.status <> 'invalidated'
    order by o.created_at, o.id
    limit 24;
end;
$$;

revoke all on function public.private_wanted_offers(uuid) from public;
grant execute on function public.private_wanted_offers(uuid) to authenticated;

create or replace function public.select_wanted_one_off_offer(
  target_request_id uuid,
  target_offer_id uuid,
  supplied_expected_version bigint,
  supplied_quantity integer,
  supplied_start date,
  supplied_end date
) returns public.wanted_requests
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
set statement_timeout = '5s'
as $$
declare
  req public.wanted_requests%rowtype;
  offered public.wanted_offers%rowtype;
  other_offer public.wanted_offers%rowtype;
  created_supply public.supplies%rowtype;
begin
  select * into offered from public.wanted_offers o
  where o.id = target_offer_id and o.request_id = target_request_id;
  if not found then raise exception 'selectable one-time offer required'; end if;
  select * into req from public.wanted_requests r where r.id = target_request_id;
  if not found or req.community_id <> offered.community_id then
    raise exception 'selectable one-time offer required';
  end if;
  perform public.lock_community_authorization(req.community_id, false);
  select * into req from public.wanted_requests r where r.id = target_request_id for update;
  select * into offered from public.wanted_offers o where o.id = target_offer_id for update;
  if not public.is_active_member(req.community_id)
    or req.requester_id <> auth.uid()
    or req.status <> 'open'
    or req.transition_version is distinct from supplied_expected_version
    or offered.request_id <> req.id
    or offered.status <> 'active'
    or offered.offer_kind <> 'one_off'
    or offered.supply_id is not null
    or not exists (
      select 1 from public.profiles p
      where p.id = offered.offerer_id
        and p.community_id = offered.community_id
        and p.membership_status = 'active'
    ) then
    raise exception 'selectable current one-time offer required';
  end if;
  if supplied_quantity is null or supplied_quantity < 1
    or supplied_quantity > least(req.desired_quantity, offered.offered_quantity) then
    raise exception 'requested quantity exceeds the one-time offer';
  end if;
  if supplied_start is null or supplied_end is null
    or supplied_start < current_date
    or supplied_end < supplied_start
    or supplied_end - supplied_start > 366 then
    raise exception 'valid current or future borrowing dates are required';
  end if;

  insert into public.supplies (
    community_id, title, description, category, ownership_kind,
    owner_id, custodian_id, quantity_total, listing_status, created_by,
    wanted_only
  ) values (
    req.community_id, req.title, '',
    case when public.is_canonical_gear_category(req.category) then req.category else 'other-gear' end,
    'individual', offered.offerer_id, offered.offerer_id,
    offered.offered_quantity, 'unlisted', offered.offerer_id, true
  ) returning * into created_supply;

  update public.wanted_offers
  set supply_id = created_supply.id, status = 'selected',
      transition_version = transition_version + 1,
      updated_at = clock_timestamp()
  where id = offered.id
  returning * into offered;

  insert into public.gear_loans (
    community_id, supply_id, borrower_id, custodian_at_request_id,
    quantity, start_date, end_date, borrower_note
  ) values (
    req.community_id, created_supply.id, req.requester_id,
    offered.offerer_id, supplied_quantity, supplied_start, supplied_end, null
  );

  update public.wanted_requests
  set status = 'fulfilled', selected_offer_id = offered.id,
      transition_version = transition_version + 1,
      updated_at = clock_timestamp()
  where id = req.id
  returning * into req;

  perform public.emit_wanted_notification(
    'wanted_offer_selected', offered.id, offered.transition_version,
    offered.community_id, array[req.requester_id, offered.offerer_id], false
  );

  for other_offer in
    update public.wanted_offers
    set status = 'invalidated', transition_version = transition_version + 1,
        updated_at = clock_timestamp()
    where request_id = req.id and id <> offered.id and status = 'active'
    returning *
  loop
    perform public.emit_wanted_notification(
      'wanted_offer_invalidated', other_offer.id, other_offer.transition_version,
      other_offer.community_id, array[req.requester_id, other_offer.offerer_id], false
    );
  end loop;
  return req;
end;
$$;

revoke all on function public.select_wanted_one_off_offer(uuid, uuid, bigint, integer, date, date) from public;
grant execute on function public.select_wanted_one_off_offer(uuid, uuid, bigint, integer, date, date) to authenticated;

create or replace function public.private_supplies()
returns table(
  id uuid, community_id uuid, title text, description text, category text,
  condition text, ownership_kind public.ownership_kind, owner_id uuid,
  owner_is_active boolean, custodian_id uuid, custodian_name text,
  quantity_total integer, listing_status public.listing_status, image_paths text[],
  publication_attempt_id uuid, publication_expected_images smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid := public.current_active_community_id();
begin
  if caller_id is null or caller_community is null then return; end if;
  return query
  select s.id, s.community_id, s.title, s.description, s.category, s.condition,
    s.ownership_kind, s.owner_id,
    case when s.ownership_kind = 'individual' then owner_profile.membership_status = 'active' else false end,
    s.custodian_id, custodian.display_name, s.quantity_total, s.listing_status,
    s.image_paths, s.publication_attempt_id, s.publication_expected_images
  from public.supplies s
  join public.profiles custodian
    on custodian.id = s.custodian_id and custodian.community_id = s.community_id
  left join public.profiles owner_profile
    on owner_profile.id = s.owner_id and owner_profile.community_id = s.community_id
  where s.community_id = caller_community
    and not s.wanted_only
    and (
      s.listing_status <> 'unlisted'
      or s.created_by = caller_id
      or s.owner_id = caller_id
      or public.is_active_inventory_manager(s.community_id)
    )
  order by s.title, s.id;
end;
$$;
