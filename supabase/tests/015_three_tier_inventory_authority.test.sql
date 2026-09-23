begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into public.communities (id, slug, name)
values ('7b000000-0000-4000-8000-000000000015', 'three-tier-inventory-test', 'Three Tier Inventory Test');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'inventory-admin@example.test', '', now(), now(), now(), '{"display_name":"Inventory Admin"}'),
  ('00000000-0000-0000-8000-000000000000', 'b1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'inventory-custodian@example.test', '', now(), now(), now(), '{"display_name":"Inventory Custodian"}'),
  ('00000000-0000-0000-8000-000000000000', 'b1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'inventory-owner@example.test', '', now(), now(), now(), '{"display_name":"Inventory Owner"}'),
  ('00000000-0000-0000-8000-000000000000', 'b1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'inventory-contact@example.test', '', now(), now(), now(), '{"display_name":"Inventory Contact"}'),
  ('00000000-0000-0000-8000-000000000000', 'b1000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'inventory-regular@example.test', '', now(), now(), now(), '{"display_name":"Inventory Regular"}'),
  ('00000000-0000-0000-8000-000000000000', 'b1000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'inventory-pending@example.test', '', now(), now(), now(), '{"display_name":"Inventory Pending"}');

update public.profiles
set community_id = '7b000000-0000-4000-8000-000000000015', membership_status = 'active',
    approved_by = 'b1000000-0000-4000-8000-000000000001', approved_at = now()
where id in (
  'b1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000003',
  'b1000000-0000-4000-8000-000000000004',
  'b1000000-0000-4000-8000-000000000005'
);
update public.profiles
set community_id = '7b000000-0000-4000-8000-000000000015'
where id = 'b1000000-0000-4000-8000-000000000006';

insert into public.community_roles (community_id, user_id, role, granted_by)
select '7b000000-0000-4000-8000-000000000015', fixture.user_id, fixture.role, 'b1000000-0000-4000-8000-000000000001'
from (values
  ('b1000000-0000-4000-8000-000000000001'::uuid, 'member'::public.app_role),
  ('b1000000-0000-4000-8000-000000000001'::uuid, 'steward'::public.app_role),
  ('b1000000-0000-4000-8000-000000000002'::uuid, 'member'::public.app_role),
  ('b1000000-0000-4000-8000-000000000002'::uuid, 'custodian'::public.app_role),
  ('b1000000-0000-4000-8000-000000000003'::uuid, 'member'::public.app_role),
  ('b1000000-0000-4000-8000-000000000004'::uuid, 'member'::public.app_role),
  ('b1000000-0000-4000-8000-000000000005'::uuid, 'member'::public.app_role)
) fixture(user_id, role);

insert into public.supplies (
  id, community_id, title, description, category, condition, ownership_kind, owner_id,
  custodian_id, quantity_total, listing_status, created_by
) values
  ('b2000000-0000-4000-8000-000000000001', '7b000000-0000-4000-8000-000000000015', 'Owner tent', 'Original', 'tents-shelters', 'good', 'individual', 'b1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004', 2, 'listed', 'b1000000-0000-4000-8000-000000000003'),
  ('b2000000-0000-4000-8000-000000000002', '7b000000-0000-4000-8000-000000000015', 'Donation stove', 'Original', 'camp-kitchen', 'good', 'individual', 'b1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003', 1, 'listed', 'b1000000-0000-4000-8000-000000000003'),
  ('b2000000-0000-4000-8000-000000000003', '7b000000-0000-4000-8000-000000000015', 'Retired history', 'Immutable', 'other-gear', 'good', 'individual', 'b1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003', 1, 'unlisted', 'b1000000-0000-4000-8000-000000000003');
update public.supplies set listing_status = 'retired', retired_at = now() where id = 'b2000000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$ select id from public.create_group_supply('Six tents', 'Group stock', 'other-gear', 6, 'b1000000-0000-4000-8000-000000000004', 'listed', 'good') $$,
  'Custodian can create group gear'
);
select is((select ownership_kind::text from public.supplies where title = 'Six tents'), 'group'::text, 'created gear is group-owned');
select is((select custodian_id from public.supplies where title = 'Six tents'), 'b1000000-0000-4000-8000-000000000004'::uuid, 'group gear records a Stored with contact');
select throws_ok(
  $$ select id from public.create_group_supply('Invalid status', '', 'other-gear', 1, 'b1000000-0000-4000-8000-000000000004', null, 'good') $$,
  'P0001', 'invalid initial listing state',
  'group creation rejects a null listing status'
);
select lives_ok(
  $$ select id from public.update_supply((select id from public.supplies where title = 'Six tents'), 'Six updated tents', 'Updated', 'other-gear', 6, 'unlisted', 'good') $$,
  'Custodian can fully edit group gear regardless of contact'
);
select set_config('test.group_supply_id', (select id::text from public.supplies where title = 'Six updated tents'), true);
select lives_ok(
  $$ select id from public.update_supply('b2000000-0000-4000-8000-000000000001', 'Owner tent', 'Manager detail edit', 'other-gear', 2, 'listed', 'good') $$,
  'Custodian can edit active individual details'
);
select throws_ok(
  $$ select id from public.update_supply('b2000000-0000-4000-8000-000000000001', 'Owner tent', 'Manager detail edit', 'other-gear', 2, 'unlisted', 'good') $$,
  'P0001', 'individual availability is controlled by its owner',
  'Custodian cannot change individual availability'
);
select throws_ok(
  $$ select id from public.retire_supply('b2000000-0000-4000-8000-000000000001') $$,
  'P0001', 'active individual owner required',
  'Custodian cannot retire active individual gear'
);
select throws_ok(
  $$ select id from public.convert_individual_donation('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000004') $$,
  'P0001', 'administrator and individual listing required',
  'Custodian cannot convert a donation'
);
select throws_ok(
  $$ select public.deactivate_member('b1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004') $$,
  'P0001', 'active administrator required',
  'Custodian cannot deactivate a member'
);
select throws_ok(
  $$ select public.decide_membership('b1000000-0000-4000-8000-000000000006', true) $$,
  'P0001', 'active administrator required',
  'Custodian cannot decide membership'
);

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select id from public.update_supply('b2000000-0000-4000-8000-000000000001', 'Owner tent', 'Owner edit', 'other-gear', 2, null, 'good') $$,
  'P0001', 'listing status is required',
  'inventory update rejects a null listing status'
);
select lives_ok(
  $$ select id from public.update_supply('b2000000-0000-4000-8000-000000000001', 'Owner tent', 'Owner edit', 'other-gear', 2, 'unlisted', 'good') $$,
  'individual owner can change availability even when gear is Stored with someone else'
);
select is((select listing_status::text from public.supplies where id = 'b2000000-0000-4000-8000-000000000001'), 'unlisted'::text, 'owner availability change is stored');

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$ select id from public.update_supply(current_setting('test.group_supply_id')::uuid, 'Contact edit', 'Denied', 'other-gear', 6, 'unlisted', 'good') $$,
  'P0001', 'inventory manager required for group gear',
  'Stored with contact cannot edit group gear'
);
select throws_ok(
  $$ select id from public.set_supply_image_paths(current_setting('test.group_supply_id')::uuid, array[]::text[]) $$,
  'P0001', 'inventory manager required for group media',
  'Stored with contact cannot manage group media'
);
select ok(
  not public.can_manage_gear_object('7b000000-0000-4000-8000-000000000015/' || current_setting('test.group_supply_id') || '/contact.jpg'),
  'Stored with contact receives no storage-object authority'
);

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select id from public.convert_individual_donation('b2000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004') $$,
  'P0001', 'administrator and individual listing required',
  'retired individual history cannot be converted'
);
select lives_ok(
  $$ select id from public.set_supply_contact('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000005') $$,
  'Administrator can change an active individual listing contact'
);
select is((select custodian_id from public.supplies where id = 'b2000000-0000-4000-8000-000000000001'), 'b1000000-0000-4000-8000-000000000005'::uuid, 'individual Stored with contact changes');

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$ select id from public.update_supply('b2000000-0000-4000-8000-000000000001', 'Contact edit', 'Denied', 'other-gear', 2, 'unlisted', 'good') $$,
  'P0001', 'individual owner or inventory manager required',
  'new individual contact receives no edit authority'
);

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select id from public.convert_individual_donation('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000004') $$,
  'Administrator can record an individual donation'
);
select is((select ownership_kind::text from public.supplies where id = 'b2000000-0000-4000-8000-000000000002'), 'group'::text, 'donated gear becomes group-owned');
select ok(exists (select 1 from public.supply_donation_audit where supply_id = 'b2000000-0000-4000-8000-000000000002'), 'donation preserves immutable audit evidence');

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$ select id from public.retire_supply((select id from public.supplies where title = 'Six updated tents')) $$,
  'Custodian can retire group gear'
);
select is((select listing_status::text from public.supplies where title = 'Six updated tents'), 'retired'::text, 'group retirement is stored');

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.deactivate_member('b1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004') $$,
  'Administrator can deactivate with a Regular user as replacement contact'
);
reset role;
select is((select membership_status::text from public.profiles where id = 'b1000000-0000-4000-8000-000000000003'), 'deactivated'::text, 'target membership is deactivated');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select is((select listing_status::text from public.supplies where id = 'b2000000-0000-4000-8000-000000000001'), 'unlisted'::text, 'inactive owner gear remains unlisted');
select is((select custodian_id from public.supplies where id = 'b2000000-0000-4000-8000-000000000001'), 'b1000000-0000-4000-8000-000000000004'::uuid, 'deactivation records selected replacement contact');
select throws_ok(
  $$ select public.deactivate_member('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000004') $$,
  'P0001', 'cannot deactivate the last active administrator',
  'last Administrator cannot be deactivated'
);

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000005', true);
select lives_ok(
  $$ select id from public.create_individual_supply('Regular lantern', 'Personal', 'other-gear', 1, 'listed', 'good') $$,
  'Regular user can create individual gear'
);
select is((select owner_id from public.supplies where title = 'Regular lantern'), 'b1000000-0000-4000-8000-000000000005'::uuid, 'individual creation derives the authenticated owner');

select * from finish();
rollback;
