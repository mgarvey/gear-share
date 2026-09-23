begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.communities (id, slug, name)
values ('7b000000-0000-4000-8000-000000000002', 'other-community', 'Other Community');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'active@example.test', '', now(), now(), now(), '{"display_name":"Active Member"}'),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'pending@example.test', '', now(), now(), now(), '{"display_name":"Pending Member"}'),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'inactive@example.test', '', now(), now(), now(), '{"display_name":"Inactive Member"}'),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'other@example.test', '', now(), now(), now(), '{"display_name":"Other Member"}');

update public.profiles set membership_status = 'active' where id = '10000000-0000-4000-8000-000000000001';
update public.profiles set membership_status = 'deactivated', deactivated_by = '10000000-0000-4000-8000-000000000001', deactivated_at = now()
where id = '10000000-0000-4000-8000-000000000003';
update public.profiles set community_id = '7b000000-0000-4000-8000-000000000002', membership_status = 'active'
where id = '10000000-0000-4000-8000-000000000004';

insert into public.community_roles (community_id, user_id, role, granted_by)
values ('7b000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'member', '10000000-0000-4000-8000-000000000001');
insert into public.supplies (id, community_id, title, category, condition, ownership_kind, owner_id, custodian_id, quantity_total, listing_status, created_by)
values
  ('20000000-0000-4000-8000-000000000001', '7b000000-0000-4000-8000-000000000001', 'Six tents', 'tents-shelters', 'good', 'individual', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 6, 'listed', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '7b000000-0000-4000-8000-000000000002', 'Other gear', 'other-gear', 'good', 'individual', '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 1, 'listed', '10000000-0000-4000-8000-000000000004');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.supplies), 1::bigint, 'active member sees own-community catalog only');
select is((select count(*) from public.profiles), 1::bigint, 'ordinary active member sees only their own profile row');
select is((select count(*) from public.communities), 1::bigint, 'active member sees own community only');
select ok(public.is_active_member('7b000000-0000-4000-8000-000000000001'), 'active membership helper accepts same community');
select isnt(public.current_active_community_id(), null::uuid, 'active member resolves a community');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.supplies), 0::bigint, 'pending member sees no gear');
select is((select count(*) from public.profiles), 1::bigint, 'pending member sees only self profile');
select is((select count(*) from public.community_roles), 0::bigint, 'pending member sees no roles');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.supplies), 0::bigint, 'deactivated member sees no gear');
select is((select count(*) from public.profiles), 1::bigint, 'deactivated member sees only self profile');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select is((select count(*) from public.supplies), 1::bigint, 'cross-community member sees only their catalog');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select ok(
  not has_table_privilege('anon', 'public.supplies', 'select'),
  'anonymous caller has no catalog read privilege'
);

select * from finish();
rollback;
