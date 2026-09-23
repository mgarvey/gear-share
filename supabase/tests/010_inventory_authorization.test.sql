begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'inventory-steward@example.test', '', now(), now(), now(), '{"display_name":"Inventory Steward"}'),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'inventory-individual@example.test', '', now(), now(), now(), '{"display_name":"Inventory Individual"}'),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'inventory-other@example.test', '', now(), now(), now(), '{"display_name":"Other Individual"}');

update public.profiles
set membership_status = 'active',
    approved_by = 'a0000000-0000-4000-8000-000000000001',
    approved_at = now()
where id = 'a0000000-0000-4000-8000-000000000001';
insert into public.community_roles (community_id, user_id, role, granted_by)
select p.community_id, p.id, fixture.role, p.id
from public.profiles p
cross join (values ('member'::public.app_role), ('steward'::public.app_role)) fixture(role)
where p.id = 'a0000000-0000-4000-8000-000000000001';
select pass('founding steward fixture is created without invoking the one-time bootstrap');
insert into public.membership_applications (community_id, applicant_id, question_version_id, answer_snapshot, answer_count)
select p.community_id, p.id, q.id, '[]'::jsonb, 0
from public.profiles p join public.join_question_versions q on q.community_id = p.community_id and q.is_current
where p.membership_status = 'pending' and p.id <> 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select lives_ok($$ select public.decide_membership('a0000000-0000-4000-8000-000000000002', true) $$, 'individual is approved');
select lives_ok($$ select public.decide_membership('a0000000-0000-4000-8000-000000000003', true) $$, 'other individual is approved');

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$ select public.create_individual_supply('Individual sleeping pads', 'Two matching pads', 'sleep-systems', 2, 'listed', 'good') $$,
  'individual creates its own aggregate listing'
);
select is(
  (select concat_ws('|', ownership_kind::text, owner_id::text, custodian_id::text, quantity_total::text)
   from public.supplies where title = 'Individual sleeping pads'),
  'individual|a0000000-0000-4000-8000-000000000002|a0000000-0000-4000-8000-000000000002|2',
  'individual ownership and custody are derived from the caller'
);
select throws_ok(
  $$ select public.create_individual_supply('Invalid zero', '', 'other-gear', 0, 'listed', 'good') $$,
  'P0001', 'invalid initial listing state',
  'non-positive individual quantity is rejected'
);
select is((select count(*)::integer from public.supplies where title = 'Invalid zero'), 0, 'invalid individual listing leaves no row');

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000003', true);
select throws_ok(
  format(
    $$ select public.update_supply(%L, 'Forged edit', '', 'sleep-systems', 9, 'listed', 'good') $$,
    (select id from public.supplies where title = 'Individual sleeping pads')
  ),
  'P0001', 'individual owner or inventory manager required',
  'another individual cannot manage the listing'
);
select is((select quantity_total from public.supplies where title = 'Individual sleeping pads'), 2, 'cross-individual denial preserves inventory');
select throws_ok(
  $$ select public.create_group_supply('Unauthorized tents', '', 'tents-shelters', 6, 'a0000000-0000-4000-8000-000000000003', 'listed', 'good') $$,
  'P0001', 'active inventory manager required',
  'ordinary members cannot create group-owned gear'
);

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.create_group_supply('Six identical tents', 'Matching patrol tents', 'tents-shelters', 6, 'a0000000-0000-4000-8000-000000000001', 'listed', 'good') $$,
  'steward creates group-owned aggregate inventory'
);
select is(
  (select concat_ws('|', ownership_kind::text, coalesce(owner_id::text, 'none'), quantity_total::text)
   from public.supplies where title = 'Six identical tents'),
  'group|none|6',
  'six identical Group tents are represented by one quantity-six listing'
);
select lives_ok(
  format(
    $$ select public.convert_individual_donation(%L, 'a0000000-0000-4000-8000-000000000001') $$,
    (select id from public.supplies where title = 'Individual sleeping pads')
  ),
  'steward records a confirmed individual donation'
);
select is(
  (select concat_ws('|', ownership_kind::text, coalesce(owner_id::text, 'none'), custodian_id::text)
   from public.supplies where title = 'Individual sleeping pads'),
  'group|none|a0000000-0000-4000-8000-000000000001',
  'donation converts ownership and assigns the selected custodian'
);
select ok(
  exists (
    select 1 from public.supply_donation_audit a
    join public.supplies s on s.id = a.supply_id
    where s.title = 'Individual sleeping pads'
      and a.prior_owner_id = 'a0000000-0000-4000-8000-000000000002'
      and a.converted_by = 'a0000000-0000-4000-8000-000000000001'
      and a.converted_at is not null
  ),
  'donation preserves prior owner, acting steward, and timestamp audit data'
);

select * from finish();
rollback;
