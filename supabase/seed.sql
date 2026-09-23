insert into public.communities (id, slug, name, join_mode)
values (
  '7b000000-0000-4000-8000-000000000001'::uuid,
  'gear-share-community',
  'Community Gear Share',
  'approval_required'::public.community_join_mode
)
on conflict (id) do update
set slug = excluded.slug,
    name = excluded.name,
    join_mode = excluded.join_mode;

-- The seed runs after migrations, so the milestone-six backfill cannot create
-- settings for this local-only community. Seed the same initial version here.
begin;
select set_config('app.milestone_six_internal_change', 'allowed', true);

insert into public.community_setting_versions
  (community_id, version, display_name, ai_drafting_enabled, operator_identifier)
values
  ('7b000000-0000-4000-8000-000000000001'::uuid, 1, 'Community Gear Share', false, 'milestone-6-migration')
on conflict (community_id, version) do nothing;

insert into public.community_settings
  (community_id, current_version, display_name, ai_drafting_enabled, updated_by)
values
  ('7b000000-0000-4000-8000-000000000001'::uuid, 1, 'Community Gear Share', false, null)
on conflict (community_id) do nothing;

select set_config('app.milestone_six_internal_change', '', true);
commit;
