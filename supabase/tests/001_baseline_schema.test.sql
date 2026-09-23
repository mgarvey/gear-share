begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select has_table('public', 'communities', 'communities table exists');
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'community_roles', 'community roles table exists');
select has_table('public', 'supplies', 'supplies table exists');
select has_table('public', 'gear_loans', 'structured loans table exists');
select has_type('public', 'membership_status', 'membership status enum exists');
select has_type('public', 'ownership_kind', 'ownership enum exists');
select has_type('public', 'gear_loan_status', 'loan state enum exists');
select col_is_pk('public', 'communities', 'id', 'community UUID is primary key');
select col_is_pk('public', 'profiles', 'id', 'profile uses auth user UUID as primary key');
select col_is_pk('public', 'supplies', 'id', 'supply UUID is primary key');
select col_has_check('public', 'supplies', 'quantity_total', 'aggregate quantity is constrained');
select is((select count(*) from public.communities), 1::bigint, 'seed creates exactly one community');
select is((select slug from public.communities), 'gear-share-community', 'seeded community has stable slug');
select is((select join_mode::text from public.communities), 'approval_required', 'membership requires approval');
select is((select public from storage.buckets where id = 'gear-images'), false, 'gear media bucket is private');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in
    ('communities','profiles','community_roles','role_audit','founding_steward_bootstrap','supplies','supply_donation_audit','gear_loans')
    and c.relrowsecurity),
  8::bigint,
  'RLS is enabled on every protected public table'
);
select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0::bigint,
  'client roles receive no direct protected-table mutations'
);

select * from finish();
rollback;
