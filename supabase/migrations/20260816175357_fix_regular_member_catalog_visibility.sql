-- The catalog intentionally returns listed gear and the listing-associated
-- contact name to every active member of the same community. Running as the
-- caller caused the protected profiles join to remove listings whose contact
-- was another member. The function already derives the caller's active
-- community, validates every filter, and returns only listed rows from that
-- community, so give this bounded read API the same definer boundary used by
-- the canonical detail and My Gear functions.
alter function public.private_gear_catalog(text, text, text, text, text, integer)
  security definer;

revoke all on function public.private_gear_catalog(text, text, text, text, text, integer)
  from public, anon;
grant execute on function public.private_gear_catalog(text, text, text, text, text, integer)
  to authenticated;
