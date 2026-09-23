create or replace function public.private_gear_catalog(
  supplied_search text,
  supplied_category text,
  supplied_ownership text,
  supplied_condition text,
  supplied_postal text,
  supplied_page integer,
  supplied_start date,
  supplied_end date,
  supplied_available_only boolean
) returns table(
  id uuid,
  community_id uuid,
  title text,
  description text,
  category text,
  condition text,
  ownership_kind public.ownership_kind,
  owner_id uuid,
  owner_is_active boolean,
  custodian_id uuid,
  custodian_name text,
  custodian_postal_code text,
  quantity_total integer,
  available_quantity integer,
  listing_status public.listing_status,
  image_paths text[],
  total_count bigint,
  resolved_page integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_community uuid := public.current_active_community_id();
  normalized_search text;
  normalized_postal text;
  has_dates boolean := supplied_start is not null and supplied_end is not null;
  matching_count bigint;
  effective_page integer;
begin
  if octet_length(coalesce(supplied_search, '')) > 400 then raise exception 'search input is too large'; end if;
  if octet_length(coalesce(supplied_category, '')) > 64 then raise exception 'unsupported category filter'; end if;
  if octet_length(coalesce(supplied_ownership, '')) > 32 then raise exception 'unsupported ownership filter'; end if;
  if octet_length(coalesce(supplied_condition, '')) > 32 then raise exception 'unsupported condition filter'; end if;
  if octet_length(coalesce(supplied_postal, '')) > 40 then raise exception 'unsupported postal filter'; end if;
  normalized_search := btrim(coalesce(supplied_search, ''));
  if length(normalized_search) > 100 then raise exception 'search is limited to 100 characters'; end if;
  if supplied_category <> 'all' and not public.is_canonical_gear_category(supplied_category) then raise exception 'unsupported category filter'; end if;
  if supplied_ownership not in ('all', 'individual', 'group') then raise exception 'unsupported ownership filter'; end if;
  if supplied_condition <> 'all' and not public.is_canonical_gear_condition(supplied_condition) then raise exception 'unsupported condition filter'; end if;
  if supplied_page is null or supplied_page < 1 or supplied_page > 1000 then raise exception 'page must be between 1 and 1000'; end if;
  if (supplied_start is null) <> (supplied_end is null) then raise exception 'complete start and end dates are required'; end if;
  if has_dates and supplied_start < current_date then raise exception 'catalog start date must be today or later'; end if;
  if has_dates and supplied_end < supplied_start then raise exception 'catalog end date must be on or after start date'; end if;
  if supplied_available_only and not has_dates then raise exception 'availability filter requires start and end dates'; end if;

  if supplied_postal = 'all' then
    normalized_postal := 'all';
  else
    normalized_postal := public.normalize_postal_code(supplied_postal);
    if normalized_postal is null
      or length(normalized_postal) not between 3 and 10
      or normalized_postal !~ '^[A-Z0-9]+(?:[ -][A-Z0-9]+)?$'
      or normalized_postal <> supplied_postal then
      raise exception 'unsupported postal filter';
    end if;
  end if;

  if caller_community is null then return; end if;
  perform set_config('statement_timeout', '2000', true);

  select count(*) into matching_count
  from public.supplies s
  where s.community_id = caller_community
    and s.listing_status = 'listed'
    and (normalized_search = '' or position(lower(normalized_search) in lower(s.title || ' ' || s.description)) > 0)
    and (supplied_category = 'all' or s.category = supplied_category)
    and (supplied_ownership = 'all' or s.ownership_kind::text = supplied_ownership)
    and (supplied_condition = 'all' or s.condition = supplied_condition)
    and (normalized_postal = 'all' or public.private_listing_postal_code(s.id) = normalized_postal)
    and (
      not supplied_available_only
      or greatest(0, s.quantity_total - public.max_committed_quantity(s.id, supplied_start, supplied_end)) > 0
    );
  effective_page := case
    when matching_count = 0 then 1
    else least(supplied_page, ceil(matching_count / 24.0)::integer)
  end;

  return query
  select
    s.id, s.community_id, s.title, s.description, s.category, s.condition,
    s.ownership_kind, s.owner_id,
    case when s.ownership_kind = 'individual' then owner_profile.membership_status = 'active' else false end,
    s.custodian_id, custodian.display_name, public.private_listing_postal_code(s.id),
    s.quantity_total,
    case when has_dates then greatest(0, s.quantity_total - public.max_committed_quantity(s.id, supplied_start, supplied_end))::integer else null::integer end,
    s.listing_status, s.image_paths,
    matching_count, effective_page
  from public.supplies s
  join public.profiles custodian
    on custodian.community_id = s.community_id and custodian.id = s.custodian_id
  left join public.profiles owner_profile
    on owner_profile.community_id = s.community_id and owner_profile.id = s.owner_id
  where s.community_id = caller_community
    and s.listing_status = 'listed'
    and (normalized_search = '' or position(lower(normalized_search) in lower(s.title || ' ' || s.description)) > 0)
    and (supplied_category = 'all' or s.category = supplied_category)
    and (supplied_ownership = 'all' or s.ownership_kind::text = supplied_ownership)
    and (supplied_condition = 'all' or s.condition = supplied_condition)
    and (normalized_postal = 'all' or public.private_listing_postal_code(s.id) = normalized_postal)
    and (
      not supplied_available_only
      or greatest(0, s.quantity_total - public.max_committed_quantity(s.id, supplied_start, supplied_end)) > 0
    )
  order by lower(s.title), s.id
  limit 24 offset ((effective_page - 1) * 24);
end;
$$;

revoke all on function public.private_gear_catalog(text, text, text, text, text, integer, date, date, boolean) from public;
revoke all on function public.private_gear_catalog(text, text, text, text, text, integer, date, date, boolean) from anon;
grant execute on function public.private_gear_catalog(text, text, text, text, text, integer, date, date, boolean) to authenticated;
