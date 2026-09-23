create or replace function public.loan_availability_summary(
  target_supply_id uuid,
  range_start date,
  range_end date
) returns table(
  available_quantity integer,
  pending_quantity integer,
  pending_request_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  item public.supplies%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if range_start is null or range_end is null or range_end < range_start then
    raise exception 'valid inclusive start and end dates are required';
  end if;

  select * into item
  from public.supplies s
  where s.id = target_supply_id;

  if item.id is null
      or item.listing_status <> 'listed'
      or not public.is_active_member(item.community_id) then
    return;
  end if;

  return query
  select
    greatest(
      0,
      item.quantity_total
        - public.max_committed_quantity(item.id, range_start, range_end)
    )::integer,
    coalesce(sum(gl.quantity), 0)::integer,
    count(gl.id)::integer
  from public.gear_loans gl
  where gl.supply_id = item.id
    and gl.community_id = item.community_id
    and gl.status = 'pending'
    and gl.start_date <= range_end
    and gl.end_date >= range_start;
end;
$$;

revoke all on function public.loan_availability_summary(uuid, date, date) from public;
revoke all on function public.loan_availability_summary(uuid, date, date) from anon;
grant execute on function public.loan_availability_summary(uuid, date, date) to authenticated;
