begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'review-steward@example.test', '', now(), now(), now(), '{"display_name":"Review Steward"}'),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'review-successor@example.test', '', now(), now(), now(), '{"display_name":"Review Successor"}'),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'review-individual@example.test', '', now(), now(), now(), '{"display_name":"Review Individual"}'),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'review-custodian@example.test', '', now(), now(), now(), '{"display_name":"Review Custodian"}');

update public.profiles
set membership_status = 'active',
    approved_by = 'c0000000-0000-4000-8000-000000000001',
    approved_at = now()
where id = 'c0000000-0000-4000-8000-000000000001';
insert into public.community_roles (community_id, user_id, role, granted_by)
select p.community_id, p.id, fixture.role, p.id
from public.profiles p
cross join (values ('member'::public.app_role), ('steward'::public.app_role)) fixture(role)
where p.id = 'c0000000-0000-4000-8000-000000000001';
select pass('steward fixture is created without invoking the one-time bootstrap');
insert into public.membership_applications (community_id, applicant_id, question_version_id, answer_snapshot, answer_count)
select p.community_id, p.id, q.id, '[]'::jsonb, 0
from public.profiles p join public.join_question_versions q on q.community_id = p.community_id and q.is_current
where p.membership_status = 'pending' and p.id <> 'c0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
select lives_ok($$ select public.decide_membership('c0000000-0000-4000-8000-000000000002', true) $$, 'successor is approved');
select lives_ok($$ select public.decide_membership('c0000000-0000-4000-8000-000000000003', true) $$, 'individual is approved');
select lives_ok($$ select public.decide_membership('c0000000-0000-4000-8000-000000000004', true) $$, 'custodian is approved');
select public.set_steward('c0000000-0000-4000-8000-000000000002', true);

select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', true);
select public.create_individual_supply('Retired individual tent', 'Historical tent', 'tents-shelters', 1, 'listed', 'good');
select public.retire_supply((select id from public.supplies where title = 'Retired individual tent'));

select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
select lives_ok($$ select public.deactivate_member('c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002') $$, 'individual deactivation succeeds');
select is((select listing_status::text from public.supplies where title = 'Retired individual tent'), 'retired', 'deactivation preserves terminal retirement');
select ok((select retired_at is not null from public.supplies where title = 'Retired individual tent'), 'deactivation preserves retirement timestamp');
select throws_ok(format($$ select public.convert_individual_donation(%L, 'c0000000-0000-4000-8000-000000000002') $$, (select id from public.supplies where title = 'Retired individual tent')), 'P0001', 'administrator and individual listing required', 'retired gear cannot be converted after removal');
select is((select concat_ws('|', ownership_kind::text, listing_status::text) from public.supplies where title = 'Retired individual tent'), 'individual|retired', 'rejected conversion preserves ownership and retirement');
select throws_ok(format($$ select public.update_supply(%L, 'Retired individual tent', 'Historical tent', 'tents-shelters', 1, 'listed', 'good') $$, (select id from public.supplies where title = 'Retired individual tent')), 'P0001', 'retired listings cannot be changed', 'retired individual gear cannot be relisted');

select public.create_group_supply('Custodian stove', 'Availability fixture', 'camp-kitchen', 1, 'c0000000-0000-4000-8000-000000000004', 'listed', 'good');
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000004', true);
select throws_ok(format($$ select public.update_supply(%L, 'Custodian stove', 'Availability fixture', 'camp-kitchen', 1, 'unlisted', 'good') $$, (select id from public.supplies where title = 'Custodian stove')), 'P0001', 'inventory manager required for group gear', 'Stored with contact cannot change Group gear availability');
select throws_ok(format($$ select public.update_supply(%L, 'Renamed by contact', 'Availability fixture', 'camp-kitchen', 1, 'unlisted', 'good') $$, (select id from public.supplies where title = 'Custodian stove')), 'P0001', 'inventory manager required for group gear', 'Stored with contact cannot edit Group inventory metadata');

select * from finish();
rollback;
