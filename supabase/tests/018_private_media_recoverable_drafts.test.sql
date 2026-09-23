begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'media-owner@example.test', '', now(), now(), now(), '{"display_name":"Media Owner"}'),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'media-neighbor@example.test', '', now(), now(), now(), '{"display_name":"Media Neighbor"}');

update public.profiles
set membership_status = 'active', approved_by = 'e1000000-0000-4000-8000-000000000001', approved_at = now()
where id in ('e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002');

insert into public.community_roles (community_id, user_id, role, granted_by)
select p.community_id, p.id, 'member'::public.app_role, 'e1000000-0000-4000-8000-000000000001'
from public.profiles p where p.id in ('e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select id from public.create_or_resume_individual_draft(
       'e2000000-0000-4000-8000-000000000099', 'Oversized draft', repeat('x', 1001),
       'other-gear', 1, 'good', 0) $$,
  'P0001', 'description is limited to 1000 characters',
  'recoverable draft creation shares the canonical description bound'
);

select lives_ok(
  $$ select id from public.create_or_resume_individual_draft('e2000000-0000-4000-8000-000000000001', 'Draft tent', 'Entered fields', 'tents-shelters', 1, 'good', 2) $$,
  'explicit publication creates an unlisted recoverable draft'
);
select set_config('test.media_draft_id', (select id::text from public.supplies where title = 'Draft tent'), true);
select is((select listing_status::text from public.supplies where title = 'Draft tent'), 'unlisted', 'draft is not catalog-listed');
select is((select publication_expected_images from public.supplies where title = 'Draft tent'), 2::smallint, 'draft records the bounded expected photo count');
select is(
  (select id from public.create_or_resume_individual_draft('e2000000-0000-4000-8000-000000000001', 'Draft tent updated', 'Saved fields', 'tents-shelters', 1, 'good', 2)),
  current_setting('test.media_draft_id')::uuid,
  'retrying one publication attempt resumes the same listing'
);
select is((select count(*)::integer from public.supplies where publication_attempt_id = 'e2000000-0000-4000-8000-000000000001'), 1, 'retry creates no duplicate listing');
select throws_ok(
  $$ select id from public.publish_supply_draft((select id from public.supplies where title = 'Draft tent updated'), 'e2000000-0000-4000-8000-000000000001') $$,
  'P0001', 'draft photos are incomplete', 'publication fails closed while selected photos are incomplete'
);
select throws_ok(
  $$ select id from public.update_supply((select id from public.supplies where title = 'Draft tent updated'), 'Draft tent updated', 'Saved fields', 'tents-shelters', 1, 'listed', 'good') $$,
  'P0001', 'recoverable draft must use publication finalization', 'ordinary listing updates cannot bypass draft media completeness'
);

select lives_ok(
  $$ select id from public.begin_gear_media_upload((select id from public.supplies where title = 'Draft tent updated'), 0, repeat('a', 64)) $$,
  'owner receives a server-recorded upload attempt'
);
select is(
  (select id from public.begin_gear_media_upload((select id from public.supplies where title = 'Draft tent updated'), 0, repeat('a', 64))),
  (select id from public.gear_media_upload_attempts where source_digest = repeat('a', 64)),
  'same slot and digest returns the same upload attempt'
);
select ok(
  (select a.staging_path like s.community_id::text || '/' || s.id::text || '/%'
   from public.gear_media_upload_attempts a join public.supplies s on s.id = a.supply_id
   where a.source_digest = repeat('a', 64)),
  'staging path is bound to the authoritative community and listing'
);
select throws_ok(
  $$ select id from public.begin_gear_media_upload((select id from public.supplies where title = 'Draft tent updated'), 4, repeat('b', 64)) $$,
  'P0001', 'media slot must be between zero and three', 'a fifth media slot is rejected server-side'
);
select throws_ok(
  $$ select id from public.begin_gear_media_upload((select id from public.supplies where title = 'Draft tent updated'), 1, 'not-a-digest') $$,
  'P0001', 'valid source digest required', 'malformed source digests are rejected'
);

select throws_ok(
  $$ select id from public.set_supply_image_paths((select id from public.supplies where title = 'Draft tent updated'), array['one','two','three','four','five']) $$,
  'P0001', 'at most four images are allowed', 'server rejects more than four media paths'
);
select throws_ok(
  $$ select id from public.set_supply_image_paths((select id from public.supplies where title = 'Draft tent updated'), array[
    (select community_id::text || '/' || id::text || '/e3000000-0000-4000-8000-000000000001.jpg' from public.supplies where title = 'Draft tent updated'),
    (select community_id::text || '/' || id::text || '/e3000000-0000-4000-8000-000000000001.jpg' from public.supplies where title = 'Draft tent updated')
  ]) $$,
  'P0001', 'image paths must be unique', 'server rejects duplicate media paths'
);
select throws_ok(
  $$ select id from public.set_supply_image_paths((select id from public.supplies where title = 'Draft tent updated'), array['wrong/listing/e3000000-0000-4000-8000-000000000001.jpg']) $$,
  'P0001', 'image path must be a canonical listing-prefixed JPEG', 'server rejects paths outside the exact listing prefix'
);

select throws_ok(
  $$ select id from public.set_supply_image_paths((select id from public.supplies where title = 'Draft tent updated'), array[
    (select community_id::text || '/' || id::text || '/e3000000-0000-4000-8000-000000000001.jpg' from public.supplies where title = 'Draft tent updated')
  ]) $$,
  'P0001', 'bounded sanitized JPEG object required', 'server rejects a missing final object'
);

reset role;
insert into storage.objects (bucket_id, name, metadata)
select 'gear-images', community_id::text || '/' || id::text || '/e3000000-0000-4000-8000-000000000001.jpg', '{"mimetype":"image/png","size":100}'::jsonb
from public.supplies where title = 'Draft tent updated';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select id from public.set_supply_image_paths((select id from public.supplies where title = 'Draft tent updated'), array[
    (select community_id::text || '/' || id::text || '/e3000000-0000-4000-8000-000000000001.jpg' from public.supplies where title = 'Draft tent updated')
  ]) $$,
  'P0001', 'bounded sanitized JPEG object required', 'server rejects a final object with the wrong media type'
);

reset role;
update storage.objects set metadata = '{"mimetype":"image/jpeg","size":2097153}'::jsonb
where name like '%/e3000000-0000-4000-8000-000000000001.jpg';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select id from public.set_supply_image_paths((select id from public.supplies where title = 'Draft tent updated'), array[
    (select community_id::text || '/' || id::text || '/e3000000-0000-4000-8000-000000000001.jpg' from public.supplies where title = 'Draft tent updated')
  ]) $$,
  'P0001', 'bounded sanitized JPEG object required', 'server rejects a final object over two MiB'
);

reset role;
update storage.objects set metadata = '{"mimetype":"image/jpeg","size":100}'::jsonb
where name like '%/e3000000-0000-4000-8000-000000000001.jpg';
insert into storage.objects (bucket_id, name, metadata)
select 'gear-images', community_id::text || '/' || id::text || '/e3000000-0000-4000-8000-000000000002.jpg', '{"mimetype":"image/jpeg","size":100}'::jsonb
from public.supplies where title = 'Draft tent updated';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select id from public.set_supply_image_paths((select id from public.supplies where title = 'Draft tent updated'), array[
    (select community_id::text || '/' || id::text || '/e3000000-0000-4000-8000-000000000001.jpg' from public.supplies where title = 'Draft tent updated')
  ]) $$,
  'P0001', 'sanitized upload receipt required', 'a valid-looking server object cannot bypass the sanitizer receipt'
);

reset role;
insert into public.gear_media_upload_attempts (
  id, community_id, supply_id, uploader_id, slot_index, source_digest, staging_path, final_path, status, completed_at
)
select receipt_id, s.community_id, s.id, 'e1000000-0000-4000-8000-000000000001', slot_index, source_digest,
       s.community_id::text || '/' || s.id::text || '/staging-' || receipt_id::text || '.jpg',
       s.community_id::text || '/' || s.id::text || '/' || receipt_id::text || '.jpg', 'complete', now()
from public.supplies s
cross join (values
  ('e3000000-0000-4000-8000-000000000001'::uuid, 0::smallint, repeat('d', 64)),
  ('e3000000-0000-4000-8000-000000000002'::uuid, 1::smallint, repeat('e', 64))
) receipts(receipt_id, slot_index, source_digest)
where s.title = 'Draft tent updated';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ select id from public.set_supply_image_paths((select id from public.supplies where title = 'Draft tent updated'), array[
    (select community_id::text || '/' || id::text || '/e3000000-0000-4000-8000-000000000001.jpg' from public.supplies where title = 'Draft tent updated'),
    (select community_id::text || '/' || id::text || '/e3000000-0000-4000-8000-000000000002.jpg' from public.supplies where title = 'Draft tent updated')
  ]) $$,
  'four-bounded canonical listing paths can be associated'
);
select lives_ok(
  $$ select id from public.publish_supply_draft((select id from public.supplies where title = 'Draft tent updated'), 'e2000000-0000-4000-8000-000000000001') $$,
  'complete draft publishes only after its expected media count is committed'
);
select is((select listing_status::text from public.supplies where title = 'Draft tent updated'), 'listed', 'successful publication lists the same draft');

select lives_ok(
  $$ select id from public.begin_gear_media_upload((select id from public.supplies where title = 'Draft tent updated'), 2, repeat('c', 64)) $$,
  'an existing listing can reserve its next media slot'
);
reset role;
insert into storage.objects (bucket_id, name, metadata)
select 'gear-images', community_id::text || '/' || supply_id::text || '/' || id::text || '.jpg', '{"mimetype":"image/jpeg","size":100}'::jsonb
from public.gear_media_upload_attempts where source_digest = repeat('c', 64);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select id from public.commit_sanitized_gear_image(
    (select id from public.gear_media_upload_attempts where source_digest = repeat('c', 64)),
    repeat('c', 64),
    (select community_id::text || '/' || supply_id::text || '/' || id::text || '.jpg' from public.gear_media_upload_attempts where source_digest = repeat('c', 64))
  ) $$,
  'a server receipt appends one sanitized photo to an existing listing'
);
select is(
  (select image_paths[1] || '|' || image_paths[2] || '|' || cardinality(image_paths)::text from public.supplies where title = 'Draft tent updated'),
  (select community_id::text || '/' || id::text || '/e3000000-0000-4000-8000-000000000001.jpg|' || community_id::text || '/' || id::text || '/e3000000-0000-4000-8000-000000000002.jpg|3' from public.supplies where title = 'Draft tent updated'),
  'adding a photo preserves every existing ordered path'
);

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.supplies where publication_attempt_id = 'e2000000-0000-4000-8000-000000000001'), 1, 'listed gear becomes visible to another active member');

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select id from public.create_or_resume_individual_draft('e2000000-0000-4000-8000-000000000002', 'Still private', '', 'other-gear', 1, 'fair', 0) $$,
  'a second unlisted owner draft is created'
);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.supplies where title = 'Still private'), 0, 'another member cannot discover an unlisted draft');

select is(
  (select count(*)::integer from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('gear_images_manager_insert', 'gear_images_manager_update')),
  0,
  'authenticated clients have no direct final-object insert or update policy'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'gear_image_staging_owner_insert'),
  1,
  'authenticated conversion output is limited to attempt-bound staging'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.gear_media_upload_attempts'::regclass),
  'media upload attempts have enabled and forced RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.gear_media_upload_attempts', 'INSERT,UPDATE,DELETE'),
  'authenticated clients have no direct media-attempt mutation privilege'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.set_supply_image_paths(uuid,text[])'::regprocedure),
  true,
  'authoritative media association uses a security-definer boundary'
);
select is(
  (select proconfig from pg_proc where oid = 'public.set_supply_image_paths(uuid,text[])'::regprocedure),
  array['search_path=""']::text[],
  'authoritative media association pins an empty search path'
);
select ok(
  not has_function_privilege('anon', 'public.set_supply_image_paths(uuid,text[])', 'EXECUTE'),
  'anonymous callers cannot invoke media association'
);
select ok(
  position('sanitized upload receipt required' in pg_get_functiondef('public.set_supply_image_paths(uuid,text[])'::regprocedure)) > 0,
  'the authoritative function definition pins completed sanitizer-receipt enforcement'
);

select * from finish();
rollback;
