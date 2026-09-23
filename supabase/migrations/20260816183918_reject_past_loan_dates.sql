create or replace function public.request_gear_loan(
  target_supply_id uuid,
  requested_quantity integer,
  requested_start date,
  requested_end date,
  supplied_note text,
  supplied_guideline_version bigint,
  supplied_guidelines_accepted boolean
) returns public.gear_loans
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  listing_community uuid;
  item public.supplies%rowtype;
  current_rules text[] := '{}'::text[];
  created public.gear_loans;
begin
  if caller_id is null then raise exception 'authentication required'; end if;
  select s.community_id into listing_community from public.supplies s where s.id = target_supply_id;
  if not found then raise exception 'listed same-community gear required'; end if;
  perform public.lock_community_authorization(listing_community, false);
  perform public.lock_listing(target_supply_id);
  select * into item from public.supplies s where s.id = target_supply_id for update;
  if not found or item.community_id <> listing_community or not public.is_active_member(item.community_id)
    or item.listing_status <> 'listed' then raise exception 'listing is not available for requests'; end if;
  if item.ownership_kind = 'individual' and not exists (
    select 1 from public.profiles p where p.id = item.owner_id and p.membership_status = 'active'
  ) then raise exception 'inactive-owner individual gear cannot accept requests'; end if;
  if item.ownership_kind = 'individual' and item.owner_id = caller_id then
    raise exception 'individual owners cannot borrow their own gear';
  end if;
  if requested_quantity is null or requested_quantity <= 0 or requested_quantity > item.quantity_total then
    raise exception 'quantity must be a positive whole number no greater than total stock';
  end if;
  if requested_start is null or requested_end is null or requested_end < requested_start then
    raise exception 'valid inclusive start and end dates are required';
  end if;
  if requested_start < current_date then
    raise exception 'loan start date must be today or later';
  end if;
  if supplied_note is not null and nullif(btrim(supplied_note), '') is not null
    and not public.valid_plain_text(btrim(supplied_note), 1000, false) then
    raise exception 'invalid borrower note';
  end if;
  if item.guideline_version > 0 then
    select v.rules into strict current_rules from public.supply_guideline_versions v
      where v.supply_id = item.id and v.version = item.guideline_version;
  end if;
  if cardinality(current_rules) = 0 then
    if coalesce(supplied_guidelines_accepted, false) or supplied_guideline_version is not null then
      raise exception 'no borrowing guidelines require acceptance';
    end if;
  elsif supplied_guideline_version is distinct from item.guideline_version
    or supplied_guidelines_accepted is distinct from true then
    raise exception 'current borrowing guidelines must be reviewed and accepted';
  end if;
  insert into public.gear_loans (
    community_id, supply_id, borrower_id, custodian_at_request_id,
    quantity, start_date, end_date, borrower_note
  ) values (
    item.community_id, item.id, caller_id, item.custodian_id,
    requested_quantity, requested_start, requested_end, nullif(btrim(supplied_note), '')
  ) returning * into created;
  if cardinality(current_rules) > 0 then
    insert into public.gear_loan_guideline_acceptances
      (community_id, loan_id, supply_id, guideline_version, rules, accepted_by)
    values (item.community_id, created.id, item.id, item.guideline_version, current_rules, caller_id);
  end if;
  return created;
end;
$$;
