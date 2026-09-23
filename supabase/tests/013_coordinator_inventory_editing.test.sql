begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'editing-coordinator@example.test', '', now(), now(), now(), '{"display_name":"Editing Coordinator"}'),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'editing-owner@example.test', '', now(), now(), now(), '{"display_name":"Editing Owner"}'),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'editing-other@example.test', '', now(), now(), now(), '{"display_name":"Editing Other"}');

update public.profiles
set membership_status = 'active', approved_by = 'd0000000-0000-4000-8000-000000000001', approved_at = now()
where id in (
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000003'
);
insert into public.community_roles (community_id, user_id, role, granted_by)
select p.community_id, p.id, 'member'::public.app_role, 'd0000000-0000-4000-8000-000000000001'
from public.profiles p
where p.id in (
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000003'
);
insert into public.community_roles (community_id, user_id, role, granted_by)
select p.community_id, p.id, 'steward'::public.app_role, p.id
from public.profiles p where p.id = 'd0000000-0000-4000-8000-000000000001';

set local role authenticated;

select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$ select public.create_individual_supply('Owner tent', 'Original details', 'tents-shelters', 1, 'listed', 'good') $$,
  'owner creates individual gear'
);

select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
select lives_ok(
  format(
    $$ select public.update_supply(%L, 'Owner tent edited', 'Coordinator-maintained details', 'tents-shelters', 2, 'listed', 'good') $$,
    (select id from public.supplies where title = 'Owner tent')
  ),
  'coordinator edits individual inventory details'
);
select is(
  (select concat_ws('|', title, description, quantity_total::text, listing_status::text) from public.supplies where title = 'Owner tent edited'),
  'Owner tent edited|Coordinator-maintained details|2|listed',
  'coordinator edit preserves owner-controlled availability'
);
reset role;
insert into storage.objects (bucket_id, name, metadata)
select 'gear-images', community_id::text || '/' || id::text || '/d3000000-0000-4000-8000-000000000001.jpg', '{"mimetype":"image/jpeg","size":100}'::jsonb
from public.supplies where title = 'Owner tent edited';
update public.supplies
set image_paths = array[community_id::text || '/' || id::text || '/d3000000-0000-4000-8000-000000000001.jpg']
where title = 'Owner tent edited';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
select lives_ok(
  format(
    $$ select public.set_supply_image_paths(%L, array[%L]) $$,
    (select id from public.supplies where title = 'Owner tent edited'),
    (select community_id::text || '/' || id::text || '/d3000000-0000-4000-8000-000000000001.jpg' from public.supplies where title = 'Owner tent edited')
  ),
  'coordinator can manage an individual listing photo path'
);
select ok(
  public.can_manage_gear_object(
    (select community_id::text || '/' || id::text || '/d3000000-0000-4000-8000-000000000001.jpg' from public.supplies where title = 'Owner tent edited')
  ),
  'storage authorization permits the coordinator to manage the individual listing photo'
);

select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000003', true);
select throws_ok(
  format(
    $$ select public.update_supply(%L, 'Forged edit', '', 'tents-shelters', 4, 'listed', 'good') $$,
    (select id from public.supplies where title = 'Owner tent edited')
  ),
  'P0001', 'individual owner or inventory manager required',
  'ordinary member cannot edit another member listing'
);
select is(
  public.can_manage_gear_object(
    (select community_id::text || '/' || id::text || '/coordinator.jpg' from public.supplies where title = 'Owner tent edited')
  ),
  false,
  'ordinary member cannot manage another member listing photo'
);

select * from finish();
rollback;
