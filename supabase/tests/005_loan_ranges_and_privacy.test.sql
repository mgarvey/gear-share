begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into public.communities (id, slug, name)
values ('7b000000-0000-4000-8000-000000000005', 'loan-other', 'Loan Other');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'loan-steward@example.test', '', now(), now(), now(), '{"display_name":"Loan Steward"}'),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'loan-borrower@example.test', '', now(), now(), now(), '{"display_name":"Loan Borrower"}'),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'loan-unrelated@example.test', '', now(), now(), now(), '{"display_name":"Loan Unrelated"}'),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'loan-cross@example.test', '', now(), now(), now(), '{"display_name":"Loan Cross"}');

update public.profiles
set community_id = '7b000000-0000-4000-8000-000000000005', membership_status = 'active'
where id = '50000000-0000-4000-8000-000000000004';

select public.bootstrap_founding_steward(
  '50000000-0000-4000-8000-000000000001',
  'local-test',
  'loan range and privacy fixture'
);

insert into public.membership_applications (community_id, applicant_id, question_version_id, answer_snapshot, answer_count)
select p.community_id, p.id, q.id, '[]'::jsonb, 0
from public.profiles p join public.join_question_versions q on q.community_id = p.community_id and q.is_current
where p.membership_status = 'pending' and p.id <> '50000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000001', true);
select public.decide_membership('50000000-0000-4000-8000-000000000002', true);
select public.decide_membership('50000000-0000-4000-8000-000000000003', true);
select public.create_group_supply(
  'Range test tents', 'Six interchangeable tents', 'tents-shelters', 6,
  '50000000-0000-4000-8000-000000000001', 'listed', 'good'
);

select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000002', true);
select throws_ok(format(
  $$ select public.request_gear_loan(%L, 1, current_date - 1, current_date, 'past request') $$,
  (select id from public.supplies where title = 'Range test tents')
), 'P0001', 'loan start date must be today or later', 'loan requests cannot begin in the past');
select lives_ok(format(
  $$ select public.request_gear_loan(%L, 2, '2026-09-11', '2026-09-13', '  private weekend note  ') $$,
  (select id from public.supplies where title = 'Range test tents')
), 'Friday-through-Sunday request is accepted');
select ok(
  exists (
    select 1 from public.gear_loans
    where borrower_id = '50000000-0000-4000-8000-000000000002'
      and start_date = '2026-09-11'
      and end_date = '2026-09-13'
      and quantity = 2
      and borrower_note = 'private weekend note'
  ),
  'weekend request records inclusive dates, quantity, and trimmed private note'
);
select lives_ok(format(
  $$ select public.request_gear_loan(%L, 1, '2026-10-01', '2027-01-15', 'long-term patrol gear') $$,
  (select id from public.supplies where title = 'Range test tents')
), 'multi-month request uses the same request operation');
select ok(
  exists (
    select 1 from public.gear_loans
    where borrower_id = '50000000-0000-4000-8000-000000000002'
      and start_date = '2026-10-01'
      and end_date = '2027-01-15'
      and status = 'pending'
  ),
  'multi-month request remains a normal non-reserving pending request'
);
select ok(
  exists (
    select 1 from public.gear_loans gl
    join public.profiles borrower on borrower.id = gl.borrower_id
    join public.supplies item on item.id = gl.supply_id
    where gl.borrower_note = 'private weekend note'
      and gl.community_id = borrower.community_id
      and gl.community_id = item.community_id
      and gl.borrower_id = '50000000-0000-4000-8000-000000000002'
      and gl.custodian_at_request_id = '50000000-0000-4000-8000-000000000001'
  ),
  'request derives community, borrower, and custodian from authoritative rows'
);
select throws_ok(format(
  $$ insert into public.gear_loans (community_id, supply_id, borrower_id, custodian_at_request_id, quantity, start_date, end_date)
     values ('7b000000-0000-4000-8000-000000000005', %L, '50000000-0000-4000-8000-000000000004',
             '50000000-0000-4000-8000-000000000004', 1, '2026-11-01', '2026-11-02') $$,
  (select id from public.supplies where title = 'Range test tents')
), '42501', 'permission denied for table gear_loans', 'client cannot forge authoritative loan relationships');

reset role;
insert into public.gear_loans (
  community_id, supply_id, borrower_id, custodian_at_request_id,
  quantity, start_date, end_date, status, borrower_note
)
select
  '7b000000-0000-4000-8000-000000000001', s.id,
  '50000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001',
  fixture.quantity, fixture.start_date, fixture.end_date, fixture.status::public.gear_loan_status, fixture.note
from public.supplies s
cross join (values
  (2, date '2027-02-01', date '2027-02-03', 'approved', 'approved capacity'),
  (3, date '2027-02-01', date '2027-02-03', 'checked_out', 'checked capacity'),
  (1, date '2027-02-01', date '2027-02-03', 'pending', 'pending no capacity'),
  (1, date '2027-02-01', date '2027-02-03', 'declined', 'declined no capacity'),
  (1, date '2027-02-01', date '2027-02-03', 'returned', 'returned no capacity'),
  (1, date '2027-02-01', date '2027-02-03', 'cancelled', 'cancelled no capacity'),
  (4, date '2027-03-05', date '2027-03-05', 'approved', 'Friday commitment'),
  (4, date '2027-03-07', date '2027-03-07', 'approved', 'Sunday commitment')
) as fixture(quantity, start_date, end_date, status, note)
where s.title = 'Range test tents';

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000002', true);
select is(
  public.available_quantity((select id from public.supplies where title = 'Range test tents'), '2027-02-01', '2027-02-03'),
  1,
  'only approved and checked-out statuses consume capacity'
);
select is(
  (select available_quantity from public.loan_availability_summary(
    (select id from public.supplies where title = 'Range test tents'),
    '2027-02-01', '2027-02-03'
  )),
  1,
  'availability summary keeps pending requests non-reserving'
);
select is(
  (select pending_quantity from public.loan_availability_summary(
    (select id from public.supplies where title = 'Range test tents'),
    '2027-02-01', '2027-02-03'
  )),
  1,
  'availability summary reports overlapping pending units'
);
select is(
  (select pending_request_count from public.loan_availability_summary(
    (select id from public.supplies where title = 'Range test tents'),
    '2027-02-01', '2027-02-03'
  )),
  1,
  'availability summary reports overlapping pending request count'
);
select is(
  public.available_quantity((select id from public.supplies where title = 'Range test tents'), '2027-02-04', '2027-02-28'),
  6,
  'commitments outside the requested range do not reduce availability'
);
select is(
  public.available_quantity((select id from public.supplies where title = 'Range test tents'), '2027-03-05', '2027-03-07'),
  2,
  'separated commitments use peak simultaneous demand rather than their sum'
);
select is(
  (select count(*) from public.gear_loans where borrower_note = 'private weekend note'),
  1::bigint,
  'borrower can read their own private request note'
);

select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*) from public.gear_loans where borrower_note = 'private weekend note'),
  0::bigint,
  'unrelated active member cannot read a private request note'
);
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*) from public.gear_loans where borrower_note = 'private weekend note'),
  1::bigint,
  'current custodian can read the request note they administer'
);
select lives_ok(format(
  $$ select public.update_supply(%L, 'Range test tents', 'Six interchangeable tents', 'tents-shelters', 5, 'listed', 'good') $$,
  (select id from public.supplies where title = 'Range test tents')
), 'quantity may be reduced to peak simultaneous demand despite a larger historical sum');
select throws_ok(format(
  $$ select public.update_supply(%L, 'Range test tents', 'Six interchangeable tents', 'tents-shelters', 4, 'listed', 'good') $$,
  (select id from public.supplies where title = 'Range test tents')
), 'P0001', 'quantity conflicts with committed loans', 'quantity cannot be reduced below simultaneous committed demand');
select is(
  (select quantity_total from public.supplies where title = 'Range test tents'),
  5,
  'rejected quantity reduction preserves the last valid total'
);
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000004', true);
select is(
  (select count(*) from public.loan_availability_summary(
    (select id from public.supplies where title = 'Range test tents'),
    '2027-02-01', '2027-02-03'
  )),
  0::bigint,
  'cross-community member cannot inspect pending demand'
);
select is(
  (select count(*) from public.gear_loans where borrower_note = 'private weekend note'),
  0::bigint,
  'cross-community member cannot read the request note'
);

select * from finish();
rollback;
