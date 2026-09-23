begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into public.communities (id, slug, name)
values ('7b000000-0000-4000-8000-000000000011', 'state-machine-other', 'State Machine Other');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'state-steward@example.test', '', now(), now(), now(), '{"display_name":"State Steward"}'),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'state-owner@example.test', '', now(), now(), now(), '{"display_name":"Individual Owner"}'),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'state-borrower@example.test', '', now(), now(), now(), '{"display_name":"Borrower"}'),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'state-custodian@example.test', '', now(), now(), now(), '{"display_name":"Group Custodian"}'),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'state-unrelated@example.test', '', now(), now(), now(), '{"display_name":"Unrelated Member"}'),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'state-inactive@example.test', '', now(), now(), now(), '{"display_name":"Inactive Custodian"}'),
  ('00000000-0000-0000-8000-000000000000', 'b0000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'state-cross@example.test', '', now(), now(), now(), '{"display_name":"Cross Community"}');

update public.profiles
set community_id = '7b000000-0000-4000-8000-000000000011', membership_status = 'active'
where id = 'b0000000-0000-4000-8000-000000000007';

select public.bootstrap_founding_steward(
  'b0000000-0000-4000-8000-000000000001',
  'local-test',
  'complete loan state-machine fixture'
);

insert into public.membership_applications (community_id, applicant_id, question_version_id, answer_snapshot, answer_count)
select p.community_id, p.id, q.id, '[]'::jsonb, 0
from public.profiles p join public.join_question_versions q on q.community_id = p.community_id and q.is_current
where p.membership_status = 'pending' and p.id <> 'b0000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000001', true);
select public.decide_membership('b0000000-0000-4000-8000-000000000002', true);
select public.decide_membership('b0000000-0000-4000-8000-000000000003', true);
select public.decide_membership('b0000000-0000-4000-8000-000000000004', true);
select public.decide_membership('b0000000-0000-4000-8000-000000000005', true);
select public.decide_membership('b0000000-0000-4000-8000-000000000006', true);
select public.create_group_supply('State group gear', 'State-machine fixture', 'other-gear', 50, 'b0000000-0000-4000-8000-000000000004', 'listed', 'good');
select public.create_group_supply('Inactive-custodian group gear', 'Authorization fixture', 'other-gear', 5, 'b0000000-0000-4000-8000-000000000006', 'listed', 'good');

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
select public.create_individual_supply('State individual gear', 'State-machine fixture', 'other-gear', 50, 'listed', 'good');

reset role;
update public.profiles
set membership_status = 'deactivated', deactivated_by = 'b0000000-0000-4000-8000-000000000001', deactivated_at = now()
where id = 'b0000000-0000-4000-8000-000000000006';

create temporary table state_cases (
  label text primary key,
  supply_kind text not null,
  initial_status public.gear_loan_status not null,
  loan_id uuid
) on commit drop;

insert into state_cases (label, supply_kind, initial_status) values
  ('allow-individual-approve', 'individual', 'pending'),
  ('allow-individual-decline', 'individual', 'pending'),
  ('allow-borrower-cancel-pending', 'individual', 'pending'),
  ('allow-borrower-cancel-approved', 'individual', 'approved'),
  ('allow-individual-checkout', 'individual', 'approved'),
  ('allow-individual-return', 'individual', 'checked_out'),
  ('allow-group-steward-approve', 'group', 'pending'),
  ('allow-group-steward-decline', 'group', 'pending'),
  ('allow-group-steward-checkout', 'group', 'approved'),
  ('allow-group-steward-return', 'group', 'checked_out'),
  ('allow-group-steward-cancel', 'group', 'pending'),
  ('deny-individual-steward', 'individual', 'pending'),
  ('deny-individual-borrower', 'individual', 'pending'),
  ('deny-group-unrelated', 'group', 'pending'),
  ('deny-group-inactive', 'inactive-group', 'pending'),
  ('deny-group-cross', 'group', 'pending'),
  ('deny-cancel-inactive-borrower', 'group', 'pending');

insert into state_cases (label, supply_kind, initial_status)
select 'forbid-' || source_status || '-' || operation, 'individual', source_status::public.gear_loan_status
from (values ('pending'), ('approved'), ('checked_out'), ('returned'), ('declined'), ('cancelled')) statuses(source_status)
cross join (values ('approve'), ('decline'), ('checkout'), ('return'), ('cancel')) operations(operation)
where not (
  (source_status = 'pending' and operation in ('approve', 'decline', 'cancel'))
  or (source_status = 'approved' and operation in ('checkout', 'cancel'))
  or (source_status = 'checked_out' and operation = 'return')
);

insert into public.gear_loans (
  community_id, supply_id, borrower_id, custodian_at_request_id,
  quantity, start_date, end_date, status, borrower_note
)
select
  s.community_id, s.id,
  case when c.label = 'deny-cancel-inactive-borrower'
    then 'b0000000-0000-4000-8000-000000000006'::uuid
    else 'b0000000-0000-4000-8000-000000000003'::uuid
  end,
  s.custodian_id,
  1, date '2028-01-01', date '2028-01-01', c.initial_status, c.label
from state_cases c
join public.supplies s on s.title = case c.supply_kind
  when 'individual' then 'State individual gear'
  when 'group' then 'State group gear'
  else 'Inactive-custodian group gear'
end;

update state_cases c set loan_id = gl.id
from public.gear_loans gl where gl.borrower_note = c.label;
grant select on state_cases to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
select lives_ok(format($$ select public.approve_gear_loan(%L) $$, (select id from public.gear_loans where borrower_note = 'allow-individual-approve')), 'pending individual request may be approved by its owner-custodian');
select lives_ok(format($$ select public.decline_gear_loan(%L) $$, (select id from public.gear_loans where borrower_note = 'allow-individual-decline')), 'pending individual request may be declined by its owner-custodian');
select lives_ok(format($$ select public.checkout_gear_loan(%L) $$, (select id from public.gear_loans where borrower_note = 'allow-individual-checkout')), 'approved individual request may be checked out by its owner-custodian');
select lives_ok(format($$ select public.return_gear_loan(%L) $$, (select id from public.gear_loans where borrower_note = 'allow-individual-return')), 'checked-out individual request may be returned by its owner-custodian');

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
select lives_ok(format($$ select public.cancel_gear_loan(%L, 'borrower cancelled pending') $$, (select id from public.gear_loans where borrower_note = 'allow-borrower-cancel-pending')), 'borrower may cancel a pending request');
select lives_ok(format($$ select public.cancel_gear_loan(%L, 'borrower cancelled approved') $$, (select id from public.gear_loans where borrower_note = 'allow-borrower-cancel-approved')), 'borrower may cancel an approved request');

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000001', true);
select lives_ok(format($$ select public.approve_gear_loan(%L) $$, (select id from public.gear_loans where borrower_note = 'allow-group-steward-approve')), 'steward may approve Group gear without being its custodian');
select lives_ok(format($$ select public.decline_gear_loan(%L) $$, (select id from public.gear_loans where borrower_note = 'allow-group-steward-decline')), 'steward may decline Group gear without being its custodian');
select lives_ok(format($$ select public.checkout_gear_loan(%L) $$, (select id from public.gear_loans where borrower_note = 'allow-group-steward-checkout')), 'steward may check out approved Group gear');
select lives_ok(format($$ select public.return_gear_loan(%L) $$, (select id from public.gear_loans where borrower_note = 'allow-group-steward-return')), 'steward may return checked-out Group gear');
select lives_ok(format($$ select public.cancel_gear_loan(%L, 'steward cancellation') $$, (select id from public.gear_loans where borrower_note = 'allow-group-steward-cancel')), 'steward may cancel pending Group gear');

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
select throws_ok(
  format($$ select public.%s_gear_loan(%L) $$, operation, gl.id),
  'P0001',
  case operation
    when 'approve' then 'request is no longer pending'
    when 'decline' then 'pending request and current authorized manager required'
    when 'checkout' then 'approved request and current authorized manager required'
    when 'return' then 'checked-out loan and current authorized manager required'
    else 'only pending or approved requests can be cancelled'
  end,
  format('%s cannot transition via %s', source_status, operation)
)
from (
  select split_part(borrower_note, '-', 2) source_status,
         split_part(borrower_note, '-', 3) operation,
         id
  from public.gear_loans
  where borrower_note like 'forbid-%'
) gl
order by source_status, operation;

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000001', true);
select throws_ok(format($$ select public.approve_gear_loan(%L) $$, (select loan_id from state_cases where label = 'deny-individual-steward')), 'P0001', 'current authorized manager required', 'steward status alone cannot administer individual gear');
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
select throws_ok(format($$ select public.approve_gear_loan(%L) $$, (select loan_id from state_cases where label = 'deny-individual-borrower')), 'P0001', 'current authorized manager required', 'borrower cannot approve their individual-gear request');
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000005', true);
select throws_ok(format($$ select public.approve_gear_loan(%L) $$, (select loan_id from state_cases where label = 'deny-group-unrelated')), 'P0001', 'current authorized manager required', 'unrelated active member cannot administer Group gear');
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000006', true);
select throws_ok(format($$ select public.approve_gear_loan(%L) $$, (select loan_id from state_cases where label = 'deny-group-inactive')), 'P0001', 'current authorized manager required', 'inactive current custodian cannot administer Group gear');
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000007', true);
select throws_ok(format($$ select public.approve_gear_loan(%L) $$, (select loan_id from state_cases where label = 'deny-group-cross')), 'P0001', 'current authorized manager required', 'cross-community member cannot administer Group gear');
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000006', true);
select throws_ok(format($$ select public.cancel_gear_loan(%L, 'inactive borrower attempt') $$, (select loan_id from state_cases where label = 'deny-cancel-inactive-borrower')), 'P0001', 'active same-community member required', 'inactive borrower cannot cancel a pending request');

select * from finish();
rollback;
