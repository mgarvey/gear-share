begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.communities (id, slug, name)
values
  ('7b000000-0000-4000-8000-000000000020', 'formal-loan-test', 'Formal Loan Test'),
  ('7b000000-0000-4000-8000-000000000021', 'formal-loan-cross', 'Formal Loan Cross');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'attention-admin@example.test', '', now(), now(), now(), '{"display_name":"Attention Admin"}'),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'attention-custodian@example.test', '', now(), now(), now(), '{"display_name":"Attention Custodian"}'),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'attention-second@example.test', '', now(), now(), now(), '{"display_name":"Second Custodian"}'),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'attention-owner@example.test', '', now(), now(), now(), '{"display_name":"Attention Owner"}'),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'attention-borrower@example.test', '', now(), now(), now(), '{"display_name":"Attention Borrower"}'),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'attention-stored@example.test', '', now(), now(), now(), '{"display_name":"Stored Only"}'),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'attention-cross@example.test', '', now(), now(), now(), '{"display_name":"Cross Member"}'),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'attention-inactive@example.test', '', now(), now(), now(), '{"display_name":"Inactive Custodian"}');

update public.profiles
set community_id = '7b000000-0000-4000-8000-000000000020', membership_status = 'active',
    approved_by = 'd1000000-0000-4000-8000-000000000001', approved_at = now()
where id between 'd1000000-0000-4000-8000-000000000001' and 'd1000000-0000-4000-8000-000000000006';
update public.profiles
set community_id = '7b000000-0000-4000-8000-000000000021', membership_status = 'active',
    approved_by = 'd1000000-0000-4000-8000-000000000007', approved_at = now()
where id = 'd1000000-0000-4000-8000-000000000007';
update public.profiles
set community_id = '7b000000-0000-4000-8000-000000000020', membership_status = 'deactivated',
    deactivated_by = 'd1000000-0000-4000-8000-000000000001', deactivated_at = now()
where id = 'd1000000-0000-4000-8000-000000000008';

insert into public.community_roles (community_id, user_id, role, granted_by)
values
  ('7b000000-0000-4000-8000-000000000020', 'd1000000-0000-4000-8000-000000000001', 'member', 'd1000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-000000000020', 'd1000000-0000-4000-8000-000000000001', 'steward', 'd1000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-000000000020', 'd1000000-0000-4000-8000-000000000002', 'member', 'd1000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-000000000020', 'd1000000-0000-4000-8000-000000000002', 'custodian', 'd1000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-000000000020', 'd1000000-0000-4000-8000-000000000003', 'member', 'd1000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-000000000020', 'd1000000-0000-4000-8000-000000000003', 'custodian', 'd1000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-000000000020', 'd1000000-0000-4000-8000-000000000004', 'member', 'd1000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-000000000020', 'd1000000-0000-4000-8000-000000000005', 'member', 'd1000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-000000000020', 'd1000000-0000-4000-8000-000000000006', 'member', 'd1000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-000000000020', 'd1000000-0000-4000-8000-000000000008', 'member', 'd1000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-000000000020', 'd1000000-0000-4000-8000-000000000008', 'custodian', 'd1000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-000000000021', 'd1000000-0000-4000-8000-000000000007', 'member', 'd1000000-0000-4000-8000-000000000007');

insert into public.supplies (
  id, community_id, title, description, category, condition, ownership_kind,
  owner_id, custodian_id, quantity_total, listing_status, created_by
) values
  ('d2000000-0000-4000-8000-000000000001', '7b000000-0000-4000-8000-000000000020', 'Attention group tent', '', 'tents-shelters', 'good', 'group', null, 'd1000000-0000-4000-8000-000000000006', 4, 'listed', 'd1000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000002', '7b000000-0000-4000-8000-000000000020', 'Attention owner stove', '', 'camp-kitchen', 'good', 'individual', 'd1000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000006', 2, 'listed', 'd1000000-0000-4000-8000-000000000004');

select has_column('public', 'supplies', 'needs_attention', 'supplies have a separate Needs Attention hold');
select has_table('public', 'supply_attention_audit', 'Needs Attention has immutable audit');
select has_table('public', 'loan_handoff_audit', 'handoff reassignment has immutable audit');
select has_table('public', 'loan_reminder_events', 'reminders use private immutable events');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.supply_attention_audit'::regclass), 'attention audit uses forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.loan_handoff_audit'::regclass), 'handoff audit uses forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.loan_reminder_events'::regclass), 'reminder events use forced RLS');
select has_fk('public', 'supply_attention_audit', 'attention audit relationships are foreign-key bound');
select has_fk('public', 'loan_handoff_audit', 'handoff audit relationships are foreign-key bound');
select has_fk('public', 'loan_reminder_events', 'reminder relationships are foreign-key bound');
select ok(not has_table_privilege('authenticated', 'public.supply_attention_audit', 'SELECT'), 'authenticated has no direct attention-audit read');
select ok(not has_table_privilege('authenticated', 'public.loan_reminder_events', 'SELECT'), 'authenticated has no direct reminder read');
select ok(has_function_privilege('authenticated', 'public.set_supply_needs_attention(uuid,boolean,text)', 'EXECUTE'), 'authenticated may call exact attention workflow');
select ok(not has_function_privilege('anon', 'public.set_supply_needs_attention(uuid,boolean,text)', 'EXECUTE'), 'anonymous cannot call attention workflow');
select ok(not has_function_privilege('authenticated', 'public.enqueue_due_loan_reminders(timestamptz,integer)', 'EXECUTE'), 'members cannot invoke scheduler');
select ok(has_function_privilege('service_role', 'public.enqueue_due_loan_reminders(timestamptz,integer)', 'EXECUTE'), 'service role may invoke bounded scheduler');
select is((select needs_attention from public.supplies where id = 'd2000000-0000-4000-8000-000000000001'), false, 'existing listing begins clear');
select is((select needs_attention_version from public.supplies where id = 'd2000000-0000-4000-8000-000000000001'), 0::bigint, 'existing listing begins at hold version zero');
select throws_ok(
  $$ insert into public.supplies (
       id, community_id, title, description, category, condition, ownership_kind,
       owner_id, custodian_id, quantity_total, listing_status, created_by,
       needs_attention, needs_attention_reason, needs_attention_version
     ) values (
       'd2000000-0000-4000-8000-000000000009', '7b000000-0000-4000-8000-000000000020',
       'Forged held listing', '', 'tents-shelters', 'good', 'group', null,
       'd1000000-0000-4000-8000-000000000002', 1, 'listed',
       'd1000000-0000-4000-8000-000000000001', true, 'Unaudited hold', 1
     ) $$,
  'P0001', 'new supplies must begin without a Needs Attention hold',
  'even the table owner cannot insert an unaudited initial hold'
);
select lives_ok(
  $$ insert into public.supplies (
       id, community_id, title, description, category, condition, ownership_kind,
       owner_id, custodian_id, quantity_total, listing_status, created_by
     ) values (
       'd2000000-0000-4000-8000-000000000009', '7b000000-0000-4000-8000-000000000020',
       'Clear new listing', '', 'tents-shelters', 'good', 'group', null,
       'd1000000-0000-4000-8000-000000000002', 1, 'listed',
       'd1000000-0000-4000-8000-000000000001'
     ) $$,
  'ordinary inserts retain the canonical clear initial state'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$ select public.set_supply_needs_attention('d2000000-0000-4000-8000-000000000001', true, 'Stored with concern') $$,
  'P0001', 'authorized listing required', 'Stored with alone cannot set Needs Attention'
);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000007', true);
select throws_ok(
  $$ select public.set_supply_needs_attention('d2000000-0000-4000-8000-000000000001', true, 'Cross concern') $$,
  'P0001', 'authorized listing required', 'cross-community member cannot set Needs Attention'
);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select public.set_supply_needs_attention('d2000000-0000-4000-8000-000000000001', true, 'See https://example.test') $$,
  'P0001', 'reason must be 1-500 characters of bounded plain text', 'hold reason rejects URLs'
);
select lives_ok(
  $$ select public.set_supply_needs_attention('d2000000-0000-4000-8000-000000000001', true, 'Inspect the torn pole sleeve') $$,
  'Custodian can mark group gear Needs Attention'
);
reset role;
select ok((select needs_attention from public.supplies where id = 'd2000000-0000-4000-8000-000000000001'), 'hold is authoritative');
select is((select needs_attention_version from public.supplies where id = 'd2000000-0000-4000-8000-000000000001'), 1::bigint, 'hold increments version');
select is((select count(*) from public.supply_attention_audit where supply_id = 'd2000000-0000-4000-8000-000000000001'), 1::bigint, 'hold appends one audit event');
select throws_ok(
  $$ update public.supplies set needs_attention = false where id = 'd2000000-0000-4000-8000-000000000001' $$,
  'P0001', 'Needs Attention changes require the audited workflow', 'direct hold rewrite is denied even to table owner'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000004', true);
select set_config('app.supply_attention_change', 'allowed', true);
select throws_ok(
  $$ update public.supplies
     set needs_attention = true, needs_attention_reason = 'Forged hold', needs_attention_version = 1
     where id = 'd2000000-0000-4000-8000-000000000002' $$,
  '42501', 'permission denied for table supplies',
  'member cannot directly rewrite the hold even after forging the custom setting'
);
reset role;
select ok(
  pg_get_functiondef('public.protect_supply_attention_state()'::regprocedure)
    like '%current_user <> pg_catalog.pg_get_userbyid%',
  'defense-in-depth trigger also binds its internal setting to the reviewed security-definer owner'
);

insert into public.gear_loans (
  id, community_id, supply_id, borrower_id, custodian_at_request_id,
  quantity, start_date, end_date, status
) values
  ('d3000000-0000-4000-8000-000000000001', '7b000000-0000-4000-8000-000000000020', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000006', 1, '2028-03-01', '2028-03-03', 'pending');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select public.approve_gear_loan('d3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003') $$,
  'P0001', 'Needs Attention must be cleared before approval', 'held gear cannot be approved'
);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.set_supply_needs_attention('d2000000-0000-4000-8000-000000000001', false, 'Inspection completed') $$,
  'Administrator can clear the hold through a distinct workflow'
);
select is((select count(*)::integer from public.private_supply_attention_flags(array['d2000000-0000-4000-8000-000000000001'::uuid])), 1, 'active member receives exact listing attention context');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$ select public.approve_gear_loan('d3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003') $$,
  'Custodian approves group loan with an explicit authorized handoff'
);
reset role;
select is((select handoff_contact_id from public.gear_loans where id = 'd3000000-0000-4000-8000-000000000001'), 'd1000000-0000-4000-8000-000000000003'::uuid, 'approval records selected handoff atomically');

insert into public.gear_loans (
  id, community_id, supply_id, borrower_id, custodian_at_request_id,
  quantity, start_date, end_date, status
) values
  ('d3000000-0000-4000-8000-000000000002', '7b000000-0000-4000-8000-000000000020', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000006', 1, '2028-04-01', '2028-04-02', 'pending'),
  ('d3000000-0000-4000-8000-000000000003', '7b000000-0000-4000-8000-000000000020', 'd2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000006', 1, '2028-05-01', '2028-05-02', 'pending');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select public.approve_gear_loan('d3000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000006') $$,
  'P0001', 'active Custodian or Administrator handoff contact required', 'regular Stored with contact cannot be selected as group handoff'
);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$ select public.approve_gear_loan('d3000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000002') $$,
  'P0001', 'individual loan handoff must be the active owner', 'individual borrower workflow cannot nominate another handoff'
);
select lives_ok(
  $$ select public.approve_gear_loan('d3000000-0000-4000-8000-000000000003', null) $$,
  'individual approval derives the active owner handoff'
);
reset role;
select is((select handoff_contact_id from public.gear_loans where id = 'd3000000-0000-4000-8000-000000000003'), 'd1000000-0000-4000-8000-000000000004'::uuid, 'individual handoff is authoritative owner');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
select lives_ok(
  $$ select public.reassign_loan_handoff('d3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001') $$,
  'recorded group handoff can reassign to another authorized manager'
);
reset role;
select is((select count(*) from public.loan_handoff_audit where loan_id = 'd3000000-0000-4000-8000-000000000001'), 1::bigint, 'reassignment appends immutable audit');
select is((select next_handoff_id from public.loan_handoff_audit where loan_id = 'd3000000-0000-4000-8000-000000000001'), 'd1000000-0000-4000-8000-000000000001'::uuid, 'handoff audit records replacement');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$ select public.reassign_loan_handoff('d3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002') $$,
  'P0001', 'active group loan handoff required', 'unrelated Stored with member cannot reassign handoff'
);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select * from public.private_handoff_candidates('d3000000-0000-4000-8000-000000000001') $$,
  'P0001', 'active group loan handoff context required',
  'unrelated Custodian cannot enumerate reassignment candidates for an approved loan'
);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.private_handoff_candidates('d3000000-0000-4000-8000-000000000001')), 3, 'handoff candidates contain only active Custodians and Administrators');
select is((select count(*)::integer from public.private_loan_operations(array['d3000000-0000-4000-8000-000000000001'::uuid])), 1, 'authorized participant receives bounded loan operations context');

reset role;
update public.gear_loans
set status = 'checked_out', checked_out_by = 'd1000000-0000-4000-8000-000000000001', checked_out_at = now()
where id = 'd3000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.return_gear_loan('d3000000-0000-4000-8000-000000000001', true, 'Pole sleeve tore during use') $$,
  'authorized return atomically marks Needs Attention when explicitly selected'
);
reset role;
select is((select status::text from public.gear_loans where id = 'd3000000-0000-4000-8000-000000000001'), 'returned', 'return remains authoritative');
select ok((select needs_attention from public.supplies where id = 'd2000000-0000-4000-8000-000000000001'), 'return-created hold remains separate from loan status');
select is((select source_loan_id from public.supply_attention_audit where source_loan_id is not null), 'd3000000-0000-4000-8000-000000000001'::uuid, 'return-created hold audit cites source loan');

insert into public.gear_loans (
  id, community_id, supply_id, borrower_id, custodian_at_request_id, handoff_contact_id,
  quantity, start_date, end_date, status, decided_by, decided_at, checked_out_by, checked_out_at
) values (
  'd3000000-0000-4000-8000-000000000004', '7b000000-0000-4000-8000-000000000020',
  'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000005',
  'd1000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000001',
  1, '2028-02-10', '2028-02-12', 'checked_out',
  'd1000000-0000-4000-8000-000000000001', '2028-02-09 12:00:00+00',
  'd1000000-0000-4000-8000-000000000001', '2028-02-10 12:00:00+00'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.return_gear_loan('d3000000-0000-4000-8000-000000000004', true, 'Concern already recorded') $$,
  'an existing Needs Attention hold never blocks the authorized return'
);
reset role;
select is((select status::text from public.gear_loans where id = 'd3000000-0000-4000-8000-000000000004'), 'returned', 'return succeeds while preserving an existing hold');
select is((select count(*) from public.supply_attention_audit where source_loan_id = 'd3000000-0000-4000-8000-000000000004'), 0::bigint, 'preserving an existing hold appends no false state-change audit');

reset role;
insert into public.loan_reminder_policies (community_id, time_zone, policy_version, enabled, reviewed_at)
values ('7b000000-0000-4000-8000-000000000020', 'America/Chicago', 1, true, '2028-01-01 00:00:00+00');
select throws_ok(
  $$ update public.loan_reminder_policies set time_zone = 'America/Denver' where community_id = '7b000000-0000-4000-8000-000000000020' $$,
  'P0001', 'time-zone changes require exactly the next reminder policy version', 'time-zone drift cannot reuse reminder idempotency version'
);
select throws_ok(
  $$ update public.loan_reminder_policies set time_zone = 'America/Chicago', policy_version = 2 where community_id = '7b000000-0000-4000-8000-000000000020' $$,
  'P0001', 'reminder policy version changes require a time-zone change',
  'same-zone policy review cannot reset reminder idempotency'
);
select ok(
  (select proconfig @> array['lock_timeout=5s', 'statement_timeout=45s']
   from pg_proc where oid = 'public.enqueue_due_loan_reminders(timestamptz,integer)'::regprocedure),
  'bounded scheduler has explicit lock and statement timeouts'
);
insert into public.gear_loans (
  id, community_id, supply_id, borrower_id, custodian_at_request_id, handoff_contact_id,
  quantity, start_date, end_date, status, decided_by, decided_at, checked_out_by, checked_out_at
) values
  ('d3000000-0000-4000-8000-000000000010', '7b000000-0000-4000-8000-000000000020', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000002', 1, '2028-03-08', '2028-03-10', 'checked_out', 'd1000000-0000-4000-8000-000000000001', '2028-03-08 12:00:00+00', 'd1000000-0000-4000-8000-000000000001', '2028-03-08 12:00:00+00'),
  ('d3000000-0000-4000-8000-000000000011', '7b000000-0000-4000-8000-000000000020', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000002', 1, '2028-02-01', '2028-02-02', 'approved', 'd1000000-0000-4000-8000-000000000001', '2028-02-01 12:00:00+00', null, null),
  ('d3000000-0000-4000-8000-000000000012', '7b000000-0000-4000-8000-000000000020', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000002', 1, '2028-04-01', '2028-04-02', 'returned', 'd1000000-0000-4000-8000-000000000001', '2028-04-01 12:00:00+00', 'd1000000-0000-4000-8000-000000000001', '2028-04-01 12:00:00+00');

select is(public.enqueue_due_loan_reminders('2028-03-09 06:00:00+00', 100), 2, 'due-soon run creates one event for borrower and handoff at exact 48-hour threshold');
select is(public.enqueue_due_loan_reminders('2028-03-09 07:00:00+00', 100), 0, 'due-soon retry is idempotent');
select is(public.enqueue_due_loan_reminders('2028-03-11 06:00:01+00', 100), 2, 'first run after inclusive due date creates first-overdue recipients');
select is((select count(*) from public.loan_reminder_events where loan_id = 'd3000000-0000-4000-8000-000000000012'), 0::bigint, 'returned loan receives no reminder');
update public.gear_loans
set status = 'checked_out', checked_out_by = 'd1000000-0000-4000-8000-000000000001', checked_out_at = '2028-02-01 12:00:00+00'
where id = 'd3000000-0000-4000-8000-000000000011';
select is(public.enqueue_due_loan_reminders('2028-03-01 12:00:00+00', 100), 2, 'outage recovery emits only first-overdue for a very overdue loan');
select is((select count(distinct reminder_kind) from public.loan_reminder_events where loan_id = 'd3000000-0000-4000-8000-000000000011'), 1::bigint, 'outage recovery does not create a catch-up burst');
select is(public.enqueue_due_loan_reminders('2028-03-08 12:00:00+00', 100), 2, 'first weekly reminder waits seven elapsed days after first overdue');
select is(public.enqueue_due_loan_reminders('2028-03-15 12:00:00+00', 100), 2, 'second weekly reminder remains spaced');
select is(public.enqueue_due_loan_reminders('2028-03-22 12:00:00+00', 100), 4, 'eligible loans each emit at most one next reminder kind per run');
select is(public.enqueue_due_loan_reminders('2028-04-20 12:00:00+00', 100), 2, 'only the final remaining weekly ordinal emits');
select is(public.enqueue_due_loan_reminders('2028-05-20 12:00:00+00', 100), 2, 'the later-due loan reaches its third weekly reminder');
insert into public.gear_loans (
  id, community_id, supply_id, borrower_id, custodian_at_request_id, handoff_contact_id,
  quantity, start_date, end_date, status, decided_by, decided_at, checked_out_by, checked_out_at
) values (
  'd3000000-0000-4000-8000-000000000013', '7b000000-0000-4000-8000-000000000020',
  'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000005',
  'd1000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000002',
  1, '2028-06-15', '2028-06-18', 'checked_out',
  'd1000000-0000-4000-8000-000000000001', '2028-06-15 12:00:00+00',
  'd1000000-0000-4000-8000-000000000001', '2028-06-15 12:00:00+00'
);
select is(
  public.enqueue_due_loan_reminders('2028-06-20 12:00:00+00', 1),
  2,
  'bounded batch excludes exhausted older loans so a later eligible loan is not starved'
);
select is(public.enqueue_due_loan_reminders('2028-06-20 12:00:00+00', 100), 0, 'no fourth weekly reminder exists');
select is((select max(ordinal) from public.loan_reminder_events where reminder_kind = 'weekly_overdue'), 3::smallint, 'weekly reminder ordinal is capped at three');
select is((select count(distinct recipient_user_id) from public.loan_reminder_events where loan_id = 'd3000000-0000-4000-8000-000000000010'), 2::bigint, 'only borrower and recorded handoff receive reminders');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000005', true);
select ok((select count(*) from public.my_loan_reminders()) > 0, 'borrower reads own bounded reminder notices');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000006', true);
select is((select count(*)::integer from public.my_loan_reminders()), 0, 'unrelated Stored with member reads no reminder notice');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000007', true);
select is((select count(*)::integer from public.my_loan_reminders()), 0, 'cross-community member reads no reminder notice');

select * from finish();
rollback;
