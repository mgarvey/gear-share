begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'steward@example.test', '', now(), now(), now(), '{"display_name":"Steward"}'),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'individual@example.test', '', now(), now(), now(), '{"display_name":"Individual"}'),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'borrower@example.test', '', now(), now(), now(), '{"display_name":"Borrower"}'),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'costeward@example.test', '', now(), now(), now(), '{"display_name":"Co-steward"}');

select lives_ok(
  $$ select public.bootstrap_founding_steward('30000000-0000-4000-8000-000000000001', 'local-test', 'pgTAP founding bootstrap') $$,
  'first confirmed pending member can be bootstrapped'
);
select throws_ok(
  $$ select public.bootstrap_founding_steward('30000000-0000-4000-8000-000000000002', 'local-test', 'second attempt') $$,
  'P0001', 'founding steward already bootstrapped',
  'second founding bootstrap is rejected'
);

insert into public.membership_applications (community_id, applicant_id, question_version_id, answer_snapshot, answer_count)
select p.community_id, p.id, q.id, '[]'::jsonb, 0
from public.profiles p join public.join_question_versions q on q.community_id = p.community_id and q.is_current
where p.membership_status = 'pending' and p.id <> '30000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select lives_ok($$ select public.decide_membership('30000000-0000-4000-8000-000000000002', true) $$, 'steward approves individual');
select lives_ok($$ select public.decide_membership('30000000-0000-4000-8000-000000000003', true) $$, 'steward approves borrower');
select lives_ok($$ select public.decide_membership('30000000-0000-4000-8000-000000000004', true) $$, 'steward approves co-steward candidate');
select lives_ok($$ select public.set_steward('30000000-0000-4000-8000-000000000004', true) $$, 'steward promotes a co-steward');
select lives_ok($$ select public.create_group_supply('Six tents', 'Matching patrol tents', 'tents-shelters', 6, '30000000-0000-4000-8000-000000000001', 'listed', 'good') $$, 'one aggregate six-tent listing is created');

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
select lives_ok(format(
  $$ select public.request_gear_loan(%L, 4, '2026-09-01', '2026-09-03', 'weekend camp') $$,
  (select id from public.supplies where title = 'Six tents')
), 'individual submits a multi-day quantity request');

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select lives_ok(format(
  $$ select public.approve_gear_loan(%L) $$,
  (select id from public.gear_loans where borrower_id = '30000000-0000-4000-8000-000000000002')
), 'custodian approves within capacity');

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
select lives_ok(format(
  $$ select public.request_gear_loan(%L, 2, '2026-09-02', '2026-09-03', 'fills exact six-tent capacity') $$,
  (select id from public.supplies where title = 'Six tents')
), 'an overlapping request may fill the remaining two tents');
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select lives_ok(format(
  $$ select public.approve_gear_loan(%L) $$,
  (select id from public.gear_loans where borrower_note = 'fills exact six-tent capacity')
), 'custodian may approve overlapping commitments exactly up to total stock');
select is(
  (select sum(quantity)::integer from public.gear_loans where status = 'approved' and start_date <= '2026-09-03' and end_date >= '2026-09-02'),
  6,
  'overlapping approvals may commit all six tents without overbooking'
);

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000003', true);
select lives_ok(format(
  $$ select public.request_gear_loan(%L, 3, '2026-09-03', '2026-09-04', 'inclusive boundary') $$,
  (select id from public.supplies where title = 'Six tents')
), 'pending request above current availability is retained');

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select throws_ok(format(
  $$ select public.approve_gear_loan(%L) $$,
  (select id from public.gear_loans where borrower_id = '30000000-0000-4000-8000-000000000003')
), 'P0001', 'insufficient date-sensitive availability', 'inclusive end/start boundary consumes capacity');
select is(
  (select status::text from public.gear_loans where borrower_id = '30000000-0000-4000-8000-000000000003'),
  'pending',
  'capacity conflict leaves request pending unchanged'
);

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
select lives_ok(format(
  $$ select public.create_individual_supply('Individual stove', 'Small stove', 'camp-kitchen', 1, 'listed', 'good') $$
), 'active individual creates and manages its own gear');

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select lives_ok($$ select public.deactivate_member('30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000004') $$, 'deactivation transfers custody to an active steward');
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000004', true);
select throws_ok(format(
  $$ select public.update_supply(%L, 'Individual stove', 'Small stove', 'camp-kitchen', 1, 'listed', 'good') $$,
  (select id from public.supplies where title = 'Individual stove')
), 'P0001', 'inactive-owner individual gear cannot be changed', 'Stored with successor cannot relist inactive-owner individual gear');
select lives_ok(format(
  $$ select public.retire_supply(%L) $$,
  (select id from public.supplies where title = 'Individual stove')
), 'successor steward may retire the inactive-individual record without editing it');
select is(
  (select listing_status::text from public.supplies where title = 'Individual stove'),
  'retired',
  'successor retirement is terminal and leaves the record unavailable'
);

reset role;
select throws_ok(
  $$ update public.profiles set membership_status = 'active' where id = '30000000-0000-4000-8000-000000000002' $$,
  'P0001', 'deactivated membership requires the reviewed Administrator reactivation workflow',
  'even direct privileged mutation cannot bypass the reviewed reactivation workflow'
);

select * from finish();
rollback;
