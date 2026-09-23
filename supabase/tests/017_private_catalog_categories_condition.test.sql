begin;
create extension if not exists pgtap with schema extensions;
select plan(71);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'catalog-admin@example.test', '', now(), now(), now(), '{"display_name":"Catalog Admin"}'),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'catalog-member@example.test', '', now(), now(), now(), '{"display_name":"Catalog Member"}'),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'catalog-pending@example.test', '', now(), now(), now(), '{"display_name":"Catalog Pending"}'),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'catalog-cross@example.test', '', now(), now(), now(), '{"display_name":"Catalog Cross"}');

insert into public.communities (id, slug, name)
values ('d0000000-0000-4000-8000-000000000004', 'catalog-cross', 'Catalog Cross Community');

update public.profiles
set membership_status = 'active', approved_by = 'd1000000-0000-4000-8000-000000000001', approved_at = now()
where id in ('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002');

update public.profiles
set community_id = 'd0000000-0000-4000-8000-000000000004', membership_status = 'active',
    approved_by = 'd1000000-0000-4000-8000-000000000004', approved_at = now()
where id = 'd1000000-0000-4000-8000-000000000004';

insert into public.community_roles (community_id, user_id, role, granted_by)
select p.community_id, p.id, fixture.role, 'd1000000-0000-4000-8000-000000000001'
from public.profiles p
join (values
  ('d1000000-0000-4000-8000-000000000001'::uuid, 'member'::public.app_role),
  ('d1000000-0000-4000-8000-000000000001'::uuid, 'steward'::public.app_role),
  ('d1000000-0000-4000-8000-000000000002'::uuid, 'member'::public.app_role),
  ('d1000000-0000-4000-8000-000000000004'::uuid, 'member'::public.app_role)
) fixture(user_id, role) on fixture.user_id = p.id;

insert into public.member_postal_codes (community_id, profile_id, postal_code)
select community_id, id, '78664' from public.profiles where id = 'd1000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ select id from public.create_group_supply('Field guide', '100% wool cover', 'books-guides', 1, 'd1000000-0000-4000-8000-000000000001', 'listed', 'good') $$,
  'Books and Field Guides is an accepted canonical category'
);
select lives_ok(
  $$ select id from public.create_group_supply('Patrol tent', 'Six person shelter', 'tents-shelters', 1, 'd1000000-0000-4000-8000-000000000001', 'listed', 'fair') $$,
  'a second canonical category and condition are accepted'
);
select throws_ok(
  $$ select id from public.create_group_supply('Invented', '', 'invented-category', 1, 'd1000000-0000-4000-8000-000000000001', 'listed', 'good') $$,
  'P0001', 'canonical category required',
  'client-invented categories are rejected'
);
select throws_ok(
  $$ select id from public.create_group_supply('Invented condition', '', 'other-gear', 1, 'd1000000-0000-4000-8000-000000000001', 'listed', 'mint') $$,
  'P0001', 'canonical condition required',
  'client-invented conditions are rejected'
);
select throws_ok(
  $$ select id from public.create_group_supply('Oversized group description', repeat('x', 1001), 'other-gear', 1, 'd1000000-0000-4000-8000-000000000001', 'listed', 'good') $$,
  'P0001', 'description is limited to 1000 characters',
  'group creation rejects a description over the canonical bound'
);
select throws_ok(
  $$ select id from public.create_individual_supply('Oversized individual description', repeat('x', 1001), 'other-gear', 1, 'listed', 'good') $$,
  'P0001', 'description is limited to 1000 characters',
  'individual creation rejects a description over the canonical bound'
);
select lives_ok(
  $$ select id from public.update_supply((select id from public.supplies where title = 'Patrol tent'), 'Patrol tent', repeat('x', 1000), 'tents-shelters', 1, 'listed', 'fair') $$,
  'an exact 1000-character description remains valid'
);
select throws_ok(
  $$ select id from public.update_supply((select id from public.supplies where title = 'Patrol tent'), 'Patrol tent', repeat('x', 1001), 'tents-shelters', 1, 'listed', 'fair') $$,
  'P0001', 'description is limited to 1000 characters',
  'listing update rejects a description over the canonical bound'
);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select is(
  public.set_my_postal_code(' k1a  0b1 '),
  'K1A 0B1',
  'active member postal setting is normalized server-side'
);
select is(
  public.get_my_postal_code(),
  'K1A 0B1',
  'member can read their own approximate postal context through the self-only RPC'
);
select is(
  public.private_listing_postal_code((select id from public.supplies where title = 'Field guide')),
  '78664',
  'postal context is returned only for one exact listed supply and its current contact'
);
select throws_ok(
  $$ select postal_code from public.member_postal_codes $$,
  '42501', 'permission denied for table member_postal_codes',
  'authenticated clients cannot turn the raw table into a member-to-ZIP lookup'
);
select throws_ok(
  $$ select public.set_my_postal_code(repeat('A', 41)) $$,
  'P0001', 'postal code input is too large',
  'oversized postal input is rejected before normalization'
);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select public.set_my_postal_code('78664') $$,
  'P0001', 'active member required',
  'pending member cannot set postal context'
);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.supply_condition_history),
  2,
  'initial canonical conditions are recorded in immutable history'
);
select is(
  (select count(*)::integer from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 1)),
  2,
  'active member catalog returns listed same-community gear'
);
select is(
  (select count(*)::integer from public.private_gear_catalog('%', 'all', 'all', 'all', 'all', 1)),
  1,
  'percent search is literal and does not broaden the catalog'
);
select is(
  (select title from public.private_gear_catalog('', 'books-guides', 'group', 'good', '78664', 1)),
  'Field guide',
  'canonical category ownership condition and exact postal filters compose'
);
select throws_ok(
  $$ select * from public.private_gear_catalog('', 'all', 'all', 'all', '786*', 1) $$,
  'P0001', 'unsupported postal filter',
  'wildcard postal filters are rejected'
);
select throws_ok(
  $$ select * from public.private_gear_catalog(repeat('x', 101), 'all', 'all', 'all', 'all', 1) $$,
  'P0001', 'search is limited to 100 characters',
  'overlong search is rejected'
);
select throws_ok(
  $$ select * from public.private_gear_catalog(repeat('x', 401), 'all', 'all', 'all', 'all', 1) $$,
  'P0001', 'search input is too large',
  'oversized raw search is rejected before normalization'
);
select throws_ok(
  $$ select * from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 1001) $$,
  'P0001', 'page must be between 1 and 1000',
  'page number is bounded'
);
select throws_ok(
  $$ select * from public.private_gear_catalog('', 'invented', 'all', 'all', 'all', 1) $$,
  'P0001', 'unsupported category filter',
  'unknown category filter is rejected'
);
select throws_ok(
  $$ select * from public.private_gear_catalog('', 'all', 'shared', 'all', 'all', 1) $$,
  'P0001', 'unsupported ownership filter',
  'unknown ownership filter is rejected'
);
select throws_ok(
  $$ select * from public.private_gear_catalog('', 'all', 'all', 'mint', 'all', 1) $$,
  'P0001', 'unsupported condition filter',
  'unknown condition filter is rejected'
);

reset role;
select throws_ok(
  $$ insert into public.supplies (
       community_id, title, description, category, condition, ownership_kind,
       owner_id, custodian_id, quantity_total, listing_status, created_by
     ) select p.community_id, 'Privileged oversized description', repeat('x', 1001),
       'other-gear', 'good', 'individual', p.id, p.id, 1, 'unlisted', p.id
     from public.profiles p where p.id = 'd1000000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "supplies" violates check constraint "supplies_description_bounded"',
  'database integrity rejects oversized privileged or imported rows'
);
insert into public.supplies (
  community_id, title, description, category, condition, ownership_kind,
  owner_id, custodian_id, quantity_total, listing_status, created_by
)
select p.community_id, 'Bulk ' || lpad(series::text, 2, '0'), '', 'other-gear', 'excellent',
  'group', null, p.id, 1, 'listed', p.id
from public.profiles p
cross join generate_series(1, 23) series
where p.id = 'd1000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 1)),
  24,
  'catalog page size is fixed at 24'
);
select is(
  (select max(total_count)::integer from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 1)),
  25,
  'catalog page carries the complete protected result count'
);
select is(
  (select title from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 2)),
  'Patrol tent',
  'second page follows stable normalized-title ordering'
);
select is(
  (select resolved_page from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 999) limit 1),
  2,
  'an emptied out-of-range page resolves to the last nonempty page'
);

reset role;
insert into public.supplies (
  community_id, title, description, category, condition, ownership_kind,
  owner_id, custodian_id, quantity_total, listing_status, created_by
)
select p.community_id, 'Administrator lantern', 'Listed member-owned gear',
  'other-gear', 'good', 'individual', p.id, p.id, 1, 'listed', p.id
from public.profiles p where p.id = 'd1000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select is(
  (select title from public.private_gear_catalog('Field guide', 'all', 'all', 'all', 'all', 1)),
  'Field guide',
  'Regular member can see listed group-owned gear stored with another member'
);
select is(
  (select title from public.private_gear_catalog('Administrator lantern', 'all', 'all', 'all', 'all', 1)),
  'Administrator lantern',
  'Regular member can see listed gear owned by another member'
);
select is(
  (select custodian_name from public.private_gear_catalog('Administrator lantern', 'all', 'all', 'all', 'all', 1)),
  'Catalog Admin',
  'Regular member receives only the listing-associated contact name'
);

reset role;
insert into public.supplies (
  id, community_id, title, description, category, condition, ownership_kind,
  owner_id, custodian_id, quantity_total, listing_status, created_by
)
select 'd2000000-0000-4000-8000-000000000001', p.community_id, 'Legacy condition tent', '',
  'tents-shelters', null, 'group', null, p.id, 1, 'listed', p.id
from public.profiles p where p.id = 'd1000000-0000-4000-8000-000000000001';
insert into public.gear_loans (
  id, community_id, supply_id, borrower_id, custodian_at_request_id,
  quantity, start_date, end_date, borrower_note
)
select 'd3000000-0000-4000-8000-000000000001', community_id, id,
  'd1000000-0000-4000-8000-000000000002', custodian_id, 1,
  date '2028-08-01', date '2028-08-02', 'legacy condition gate'
from public.supplies where id = 'd2000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select id from public.approve_gear_loan('d3000000-0000-4000-8000-000000000001') $$,
  'P0001', 'canonical listing condition required before approval',
  'legacy conditionless listing cannot receive approval'
);
select lives_ok(
  $$ select id from public.update_supply('d2000000-0000-4000-8000-000000000001', 'Legacy condition tent', '', 'tents-shelters', 1, 'listed', 'fair') $$,
  'authorized edit records a canonical condition on a legacy listing'
);
select lives_ok(
  $$ select id from public.approve_gear_loan('d3000000-0000-4000-8000-000000000001') $$,
  'approval succeeds after canonical condition correction'
);
select results_eq(
  $$ select prior_condition, next_condition, changed_by
     from public.supply_condition_history
     where supply_id = 'd2000000-0000-4000-8000-000000000001' $$,
  $$ values (null::text, 'fair'::text, 'd1000000-0000-4000-8000-000000000001'::uuid) $$,
  'legacy condition correction appends exact immutable actor/from/to history'
);

reset role;
select throws_ok(
  $$ update public.supply_condition_history set next_condition = 'good' where supply_id = 'd2000000-0000-4000-8000-000000000001' $$,
  'P0001', 'condition history is immutable',
  'condition history rejects rewrites even by the table owner'
);
update public.supplies
set custodian_id = 'd1000000-0000-4000-8000-000000000002'
where title = 'Patrol tent';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select id from public.update_supply(
    (select id from public.supplies where title = 'Patrol tent'),
    'Patrol tent', 'Six person shelter', 'tents-shelters', 1, 'listed', 'excellent'
  ) $$,
  'P0001', 'inventory manager required for group gear',
  'being Stored with a group listing does not grant condition-edit authority'
);

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000004', true);
select is(
  (select count(*)::integer from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 1)),
  0,
  'an active member in another community receives no gear-share-community catalog rows or count'
);

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::integer from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 1)),
  0,
  'pending member receives no catalog rows or protected count'
);

reset role;
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.member_postal_codes'::regclass),
  'postal-code table has enabled and forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.supply_condition_history'::regclass),
  'condition-history table has enabled and forced RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.member_postal_codes', 'SELECT,INSERT,UPDATE,DELETE'),
  'authenticated clients have no direct postal table privilege'
);
select ok(
  not has_table_privilege('authenticated', 'public.supply_condition_history', 'INSERT,UPDATE,DELETE'),
  'authenticated clients have no direct condition-history mutation privilege'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.private_gear_catalog(text,text,text,text,text,integer)'::regprocedure),
  true,
  'catalog uses a bounded definer boundary for listed same-community gear and its contact'
);
select is(
  (select proconfig from pg_proc where oid = 'public.private_gear_catalog(text,text,text,text,text,integer)'::regprocedure),
  array['search_path=""']::text[],
  'catalog function pins an empty search path'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.private_listing_postal_code(uuid)'::regprocedure),
  true,
  'exact listing-associated postal lookup uses its narrow security-definer boundary'
);
select is(
  (select proconfig from pg_proc where oid = 'public.private_listing_postal_code(uuid)'::regprocedure),
  array['search_path=""']::text[],
  'exact listing-associated postal lookup pins an empty search path'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.get_my_postal_code()'::regprocedure),
  true,
  'self postal read uses its narrow security-definer boundary'
);
select is(
  (select proconfig from pg_proc where oid = 'public.get_my_postal_code()'::regprocedure),
  array['search_path=""']::text[],
  'self postal read pins an empty search path'
);
select ok(
  not has_function_privilege('anon', 'public.private_listing_postal_code(uuid)', 'EXECUTE'),
  'anonymous callers cannot execute exact listing-associated postal lookup'
);
select is(
  to_regprocedure('public.private_listing_postal_context()'),
  null::regprocedure,
  'no bulk listing-to-ZIP context endpoint exists'
);
select ok(
  not has_function_privilege('anon', 'public.get_my_postal_code()', 'EXECUTE'),
  'anonymous callers cannot execute self postal reads'
);
select is(
  to_regprocedure('public.create_group_supply(text,text,text,integer,uuid,public.listing_status)'),
  null::regprocedure,
  'legacy conditionless group-create signature is absent'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select is(
  (select available_quantity from public.private_gear_catalog('Legacy condition tent', 'all', 'all', 'all', 'all', 1, '2028-08-01', '2028-08-02', false)),
  0,
  'dated Catalog uses committed inclusive overlap to report zero available units'
);
select is(
  (select available_quantity from public.private_gear_catalog('Legacy condition tent', 'all', 'all', 'all', 'all', 1, null, null, false)),
  null::integer,
  'undated Catalog makes no availability claim'
);
select is(
  (select count(*)::integer from public.private_gear_catalog('Legacy condition tent', 'all', 'all', 'all', 'all', 1, '2028-08-01', '2028-08-02', true)),
  0,
  'available-only filtering removes a fully committed listing before pagination'
);
select is(
  (select available_quantity from public.private_gear_catalog('Legacy condition tent', 'all', 'all', 'all', 'all', 1, '2028-08-03', '2028-08-04', true)),
  1,
  'commitments outside the selected Catalog range do not reduce availability'
);
select throws_ok(
  $$ select * from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 1, '2028-08-01', null, false) $$,
  'P0001', 'complete start and end dates are required',
  'Catalog rejects a start date without an end date'
);
select throws_ok(
  $$ select * from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 1, null, '2028-08-02', false) $$,
  'P0001', 'complete start and end dates are required',
  'Catalog rejects an end date without a start date'
);
select throws_ok(
  $$ select * from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 1, current_date - 1, current_date, false) $$,
  'P0001', 'catalog start date must be today or later',
  'Catalog rejects a past start date'
);
select throws_ok(
  $$ select * from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 1, '2028-08-03', '2028-08-02', false) $$,
  'P0001', 'catalog end date must be on or after start date',
  'Catalog rejects a reversed date range'
);
select throws_ok(
  $$ select * from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 1, null, null, true) $$,
  'P0001', 'availability filter requires start and end dates',
  'Catalog rejects available-only filtering without dates'
);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000004', true);
select is(
  (select count(*)::integer from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 1, '2028-08-01', '2028-08-02', false)),
  0,
  'dated Catalog does not expose another community result or count'
);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::integer from public.private_gear_catalog('', 'all', 'all', 'all', 'all', 1, '2028-08-01', '2028-08-02', false)),
  0,
  'dated Catalog returns no protected result to a pending member'
);

reset role;
select is(
  (select prosecdef from pg_proc where oid = 'public.private_gear_catalog(text,text,text,text,text,integer,date,date,boolean)'::regprocedure),
  true,
  'dated Catalog uses a bounded security-definer boundary'
);
select is(
  (select proconfig from pg_proc where oid = 'public.private_gear_catalog(text,text,text,text,text,integer,date,date,boolean)'::regprocedure),
  array['search_path=""']::text[],
  'dated Catalog pins an empty search path'
);
select ok(
  not has_function_privilege('anon', 'public.private_gear_catalog(text,text,text,text,text,integer,date,date,boolean)', 'EXECUTE'),
  'anonymous callers cannot execute dated Catalog availability'
);
select ok(
  has_function_privilege('authenticated', 'public.private_gear_catalog(text,text,text,text,text,integer,date,date,boolean)', 'EXECUTE'),
  'authenticated callers can execute dated Catalog availability'
);
select ok(
  to_regprocedure('public.private_gear_catalog(text,text,text,text,text,integer)') is not null,
  'the prior Catalog signature remains available during additive rollout'
);

select * from finish();
rollback;
