begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.communities (id, slug, name) values
  ('c7000000-0000-4000-8000-000000000001', 'm7-primary', 'Milestone Seven'),
  ('c7000000-0000-4000-8000-000000000002', 'm7-cross', 'Milestone Seven Cross');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000000', 'c7100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'm7-admin@example.test', '', now(), now(), now(), '{"display_name":"M7 Administrator"}'),
  ('00000000-0000-0000-0000-000000000000', 'c7100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'm7-owner@example.test', '', now(), now(), now(), '{"display_name":"M7 Owner"}'),
  ('00000000-0000-0000-0000-000000000000', 'c7100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'm7-borrower@example.test', '', now(), now(), now(), '{"display_name":"M7 Borrower"}'),
  ('00000000-0000-0000-0000-000000000000', 'c7100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'm7-stored@example.test', '', now(), now(), now(), '{"display_name":"M7 Stored"}'),
  ('00000000-0000-0000-0000-000000000000', 'c7100000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'm7-cross@example.test', '', now(), now(), now(), '{"display_name":"M7 Cross"}');

alter table public.profiles disable trigger profile_membership_notification;
update public.profiles set community_id = 'c7000000-0000-4000-8000-000000000001', membership_status = 'active',
  approved_by = 'c7100000-0000-4000-8000-000000000001', approved_at = now()
where id between 'c7100000-0000-4000-8000-000000000001' and 'c7100000-0000-4000-8000-000000000004';
update public.profiles set community_id = 'c7000000-0000-4000-8000-000000000002', membership_status = 'active',
  approved_by = 'c7100000-0000-4000-8000-000000000005', approved_at = now()
where id = 'c7100000-0000-4000-8000-000000000005';
alter table public.profiles enable trigger profile_membership_notification;

insert into public.community_roles (community_id, user_id, role, granted_by) values
  ('c7000000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000001', 'member', 'c7100000-0000-4000-8000-000000000001'),
  ('c7000000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000001', 'steward', 'c7100000-0000-4000-8000-000000000001'),
  ('c7000000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000002', 'member', 'c7100000-0000-4000-8000-000000000001'),
  ('c7000000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000003', 'member', 'c7100000-0000-4000-8000-000000000001'),
  ('c7000000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000004', 'member', 'c7100000-0000-4000-8000-000000000001'),
  ('c7000000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000004', 'custodian', 'c7100000-0000-4000-8000-000000000001'),
  ('c7000000-0000-4000-8000-000000000002', 'c7100000-0000-4000-8000-000000000005', 'member', 'c7100000-0000-4000-8000-000000000005');

insert into public.supplies (id, community_id, title, description, category, condition, ownership_kind, owner_id, custodian_id, quantity_total, listing_status, created_by) values
  ('c7200000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'M7 owner tent', '', 'tents-shelters', 'good', 'individual', 'c7100000-0000-4000-8000-000000000002', 'c7100000-0000-4000-8000-000000000004', 2, 'listed', 'c7100000-0000-4000-8000-000000000002'),
  ('c7200000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000001', 'M7 group stove', '', 'camp-kitchen', 'good', 'group', null, 'c7100000-0000-4000-8000-000000000004', 3, 'listed', 'c7100000-0000-4000-8000-000000000001');

select has_table('public', 'supply_guideline_versions', 'versioned guideline history exists');
select has_table('public', 'gear_loan_guideline_acceptances', 'immutable loan guideline acceptance exists');
select has_table('public', 'wanted_requests', 'private wanted requests exist');
select has_table('public', 'wanted_offers', 'private wanted offers exist');
select has_table('public', 'wanted_request_moderation_audit', 'wanted moderation audit exists');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
  'public.supply_guideline_versions'::regclass,
  'public.gear_loan_guideline_acceptances'::regclass,
  'public.wanted_requests'::regclass,
  'public.wanted_offers'::regclass,
  'public.wanted_request_moderation_audit'::regclass
)), 'every M7 private relation uses forced RLS');
select ok(not has_table_privilege('authenticated', 'public.wanted_requests', 'SELECT'), 'members cannot query wanted tables directly');
select ok(not has_table_privilege('authenticated', 'public.wanted_requests', 'INSERT'), 'members cannot mutate wanted tables directly');
select ok(not has_table_privilege('authenticated', 'public.supply_guideline_versions', 'UPDATE'), 'members cannot rewrite guideline history');
select ok(has_function_privilege('authenticated', 'public.private_wanted_requests(text,timestamptz,uuid)', 'EXECUTE'), 'members may call the bounded wanted board');
select ok(has_function_privilege('authenticated', 'public.offer_wanted_once(uuid,integer,text)', 'EXECUTE'), 'members may offer one-time help through the bounded RPC');
select ok(has_function_privilege('authenticated', 'public.select_wanted_one_off_offer(uuid,uuid,bigint,integer,date,date)', 'EXECUTE'), 'requesters may accept one-time help through the bounded RPC');
select ok(not has_function_privilege('anon', 'public.private_wanted_requests(text,timestamptz,uuid)', 'EXECUTE'), 'anonymous callers cannot call the wanted board');
select ok(not has_function_privilege('authenticated', 'public.user_has_listing_descriptive_authority(uuid,uuid,uuid)', 'EXECUTE'), 'client cannot call the internal arbitrary-user authority helper');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select * from public.set_supply_guidelines('c7200000-0000-4000-8000-000000000001', 0, array['Manager rewrite']) $$,
  'P0001', 'descriptive listing authority required', 'Administrator cannot edit another member individual listing guidelines'
);
select is((select count(*)::integer from public.private_manageable_listings_for_wanted()), 1, 'Administrator offer choices exclude another member individual gear and include group gear');
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$ select * from public.set_supply_guidelines('c7200000-0000-4000-8000-000000000001', 0, array['Return dry']) $$,
  'P0001', 'descriptive listing authority required', 'Stored with alone cannot edit guidelines'
);
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000002', true);
select is((select guideline_version from public.set_supply_guidelines('c7200000-0000-4000-8000-000000000001', 0, array['Return dry', 'No food inside'])), 1::bigint, 'owner creates first complete guideline version');
select is((select array_length(rules, 1) from public.private_supply_guidelines('c7200000-0000-4000-8000-000000000001')), 2, 'current ordered rules are readable through bounded RPC');
select throws_ok(
  $$ select * from public.set_supply_guidelines('c7200000-0000-4000-8000-000000000001', 1, array['Same', ' same ']) $$,
  'P0001', 'borrowing guidelines must be unique', 'normalized duplicate guidelines are rejected'
);
select throws_ok(
  $$ select * from public.set_supply_guidelines('c7200000-0000-4000-8000-000000000001', 1, array_fill('rule'::text, array[9])) $$,
  'P0001', 'zero to eight borrowing guidelines are required', 'nine guidelines are rejected'
);
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select public.request_gear_loan('c7200000-0000-4000-8000-000000000001', 1, '2028-04-01', '2028-04-02', null, null, false) $$,
  'P0001', 'current borrowing guidelines must be reviewed and accepted', 'nonempty guidelines require explicit acceptance'
);
select throws_ok(
  $$ select public.request_gear_loan('c7200000-0000-4000-8000-000000000001', 1, '2028-04-01', '2028-04-02', null, 0, true) $$,
  'P0001', 'current borrowing guidelines must be reviewed and accepted', 'stale guideline version is rejected'
);
select lives_ok(
  $$ select public.request_gear_loan('c7200000-0000-4000-8000-000000000001', 1, '2028-04-01', '2028-04-02', 'Weekend trip', 1, true) $$,
  'borrower accepts the exact current guideline version'
);
reset role;
select is((select count(*) from public.gear_loan_guideline_acceptances where supply_id = 'c7200000-0000-4000-8000-000000000001'), 1::bigint, 'one immutable acceptance snapshot is stored');
select is((select rules[1] from public.gear_loan_guideline_acceptances where supply_id = 'c7200000-0000-4000-8000-000000000001'), 'Return dry', 'snapshot contains server-copied ordered rules');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000002', true);
select is((select guideline_version from public.set_supply_guidelines('c7200000-0000-4000-8000-000000000001', 1, array['Return clean'])), 2::bigint, 'later edit creates a new full version');
reset role;
select is((select rules[1] from public.gear_loan_guideline_acceptances where supply_id = 'c7200000-0000-4000-8000-000000000001'), 'Return dry', 'later edits do not rewrite accepted snapshots');
select throws_ok(
  $$ update public.supply_guideline_versions set rules = array['forged'] where supply_id = 'c7200000-0000-4000-8000-000000000001' $$,
  'P0001', 'Milestone 7 history is immutable', 'guideline history rejects rewrites even by table owner'
);
select lives_ok(
  $$ select public.normalize_guideline_rules((select array_agg(lpad(i::text, 3, '0') || repeat('a', 147)) from generate_series(1, 8) i)) $$,
  'eight guidelines totaling exactly 1,200 characters are valid'
);
select throws_ok(
  $$ select public.normalize_guideline_rules((select array_agg(lpad(i::text, 3, '0') || repeat('a', 148)) from generate_series(1, 8) i)) $$,
  'P0001', 'borrowing guidelines exceed total length', 'guideline total over 1,200 characters is rejected'
);
select throws_ok(
  $$ select public.normalize_guideline_rules(array[repeat('a', 201)]) $$,
  'P0001', 'invalid borrowing guideline', 'one guideline over 200 characters is rejected'
);
create temporary table m7_loan_id as
select id from public.gear_loans where supply_id = 'c7200000-0000-4000-8000-000000000001';
grant select on m7_loan_id to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.private_loan_guideline_acceptances(array[(select id from m7_loan_id)])), 1, 'borrower can read the accepted snapshot');
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.private_loan_guideline_acceptances(array[(select id from m7_loan_id)])), 0, 'Custodian cannot read an individual-loan snapshot');
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.private_loan_guideline_acceptances(array[(select id from m7_loan_id)])), 1, 'Administrator has read-only individual-loan oversight');
reset role;
alter table public.profiles disable trigger profiles_terminal_membership;
alter table public.profiles disable trigger profile_membership_notification;
update public.profiles set membership_status = 'deactivated', deactivated_by = 'c7100000-0000-4000-8000-000000000001', deactivated_at = now()
where id = 'c7100000-0000-4000-8000-000000000004';
alter table public.profiles enable trigger profile_membership_notification;
alter table public.profiles enable trigger profiles_terminal_membership;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$ select * from public.private_wanted_requests('open', null, null) $$,
  'P0001', 'active member required', 'deactivated member receives no wanted board data or count'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000003', true);
select lives_ok(
  $$ select public.create_wanted_request('Two-person backpacking tent', 'tents-shelters', 1, '2028-05-01', '2028-05-03', 'For a weekend outing') $$,
  'active member creates a bounded wanted request'
);
select throws_ok(
  $$ select public.create_wanted_request('Bad dates', null, 1, '2028-05-03', null, null) $$,
  'P0001', 'invalid wanted request', 'paired dates are enforced'
);
select throws_ok(
  $$ select public.create_wanted_request('Bad URL', null, 1, null, null, 'See https://example.test') $$,
  'P0001', 'invalid wanted request', 'wanted notes reject URLs and markup-like content'
);
select is((select count(*)::integer from public.private_wanted_requests('open', null, null)), 1, 'open board returns the private same-community request');
reset role;
create temporary table m7_test_ids (request_id uuid, offer_id uuid);
insert into m7_test_ids (request_id)
select id from public.wanted_requests where title = 'Two-person backpacking tent';
grant select, update on m7_test_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$ select public.offer_wanted_listing((select request_id from m7_test_ids), 'c7200000-0000-4000-8000-000000000001', 'This may fit') $$,
  'authorized owner offers an existing listed item'
);
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.offer_wanted_listing((select request_id from m7_test_ids), 'c7200000-0000-4000-8000-000000000001', null) $$,
  'P0001', 'offerable request and listing authority required', 'Administrator cannot offer another member individual listing'
);
reset role;
update m7_test_ids set offer_id = (select id from public.wanted_offers limit 1);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$ select public.offer_wanted_listing((select request_id from m7_test_ids), 'c7200000-0000-4000-8000-000000000001', null) $$,
  'P0001', 'offerable request and listing authority required', 'Stored with alone cannot offer another member listing'
);
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select public.select_wanted_offer((select request_id from m7_test_ids), (select offer_id from m7_test_ids), 1) $$,
  'P0001', 'selectable current offer required', 'offerer cannot fulfill the request'
);
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000003', true);
select lives_ok(
  $$ select public.select_wanted_offer((select request_id from m7_test_ids), (select offer_id from m7_test_ids), 1) $$,
  'requester alone selects the offered listing'
);
reset role;
select is((select status::text from public.wanted_requests where title = 'Two-person backpacking tent'), 'fulfilled', 'selection records a match without creating a loan');
select is((select count(*) from public.gear_loans where supply_id = 'c7200000-0000-4000-8000-000000000001'), 1::bigint, 'wanted selection creates no additional loan');

insert into public.wanted_requests (id, community_id, requester_id, title, category, desired_quantity)
values ('c7300000-0000-4000-8000-000000000004', 'c7000000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000003', 'One-time lanterns', 'other-gear', 2);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select public.offer_wanted_once('c7300000-0000-4000-8000-000000000004', 1, null) $$,
  'P0001', 'open same-community wanted request required', 'requester cannot answer their own wanted request'
);
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select public.offer_wanted_once('c7300000-0000-4000-8000-000000000004', 3, null) $$,
  'P0001', 'offered quantity must fit the wanted request', 'one-time offer cannot exceed requested quantity'
);
select lives_ok(
  $$ select public.offer_wanted_once('c7300000-0000-4000-8000-000000000004', 2, 'I can bring two') $$,
  'member offers one-time help without creating a listing'
);
reset role;
create temporary table m7_one_off_offer_id as
select id from public.wanted_offers where request_id = 'c7300000-0000-4000-8000-000000000004';
grant select on m7_one_off_offer_id to authenticated;
select is((select count(*) from public.supplies where wanted_only), 0::bigint, 'one-time offer creates no hidden supply before requester acceptance');
select is((select offer_kind from public.wanted_offers where request_id = 'c7300000-0000-4000-8000-000000000004'), 'one_off', 'one-time offer is explicitly distinguished');
select is((select offered_quantity from public.wanted_offers where request_id = 'c7300000-0000-4000-8000-000000000004'), 2, 'one-time offer records bounded available quantity');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000003', true);
select is((select offer_kind from public.private_wanted_offers('c7300000-0000-4000-8000-000000000004')), 'one_off', 'requester can review the one-time offer');
select throws_ok(
  $$ select public.select_wanted_one_off_offer('c7300000-0000-4000-8000-000000000004', (select id from m7_one_off_offer_id), 1, 1, current_date - 1, current_date + 1) $$,
  'P0001', 'valid current or future borrowing dates are required', 'one-time offer cannot create a loan beginning in the past'
);
select lives_ok(
  $$ select public.select_wanted_one_off_offer('c7300000-0000-4000-8000-000000000004', (select id from m7_one_off_offer_id), 1, 1, current_date + 1, current_date + 2) $$,
  'requester accepts one-time help through the normal borrowing workflow'
);
reset role;
select is((select status::text from public.wanted_requests where id = 'c7300000-0000-4000-8000-000000000004'), 'fulfilled', 'accepted one-time offer fulfills the wanted request');
select is((select count(*) from public.supplies where wanted_only and listing_status = 'unlisted'), 1::bigint, 'accepted one-time offer creates one non-catalog loan item');
select is((select count(*) from public.gear_loans gl join public.supplies s on s.id = gl.supply_id where s.wanted_only and gl.status = 'pending'), 1::bigint, 'accepted one-time offer creates the ordinary pending loan');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.private_supplies() where title = 'One-time lanterns'), 0, 'one-time loan item stays out of My Gear');
reset role;

insert into public.wanted_requests (id, community_id, requester_id, title, desired_quantity)
values ('c7300000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000003', 'Composite target', 1);
insert into public.wanted_offers (id, community_id, request_id, supply_id, offerer_id)
values ('c7400000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000001', 'c7300000-0000-4000-8000-000000000002', 'c7200000-0000-4000-8000-000000000002', 'c7100000-0000-4000-8000-000000000001');
select throws_ok(
  $$ update public.wanted_requests set selected_offer_id = 'c7400000-0000-4000-8000-000000000002' where id = (select request_id from m7_test_ids) $$,
  '23503', null, 'selected offer must belong to the same authoritative request and community'
);

insert into public.community_roles (community_id, user_id, role, granted_by)
values ('c7000000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000002', 'custodian', 'c7100000-0000-4000-8000-000000000001');
insert into public.wanted_requests (id, community_id, requester_id, title, desired_quantity)
values ('c7300000-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000003', 'Authority expiry target', 1);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$ select public.offer_wanted_listing('c7300000-0000-4000-8000-000000000003', 'c7200000-0000-4000-8000-000000000002', null) $$,
  'active Custodian can offer group gear'
);
reset role;
delete from public.community_roles where community_id = 'c7000000-0000-4000-8000-000000000001'
  and user_id = 'c7100000-0000-4000-8000-000000000002' and role = 'custodian';
create temporary table m7_stale_offer_id as
select id from public.wanted_offers where request_id = 'c7300000-0000-4000-8000-000000000003';
grant select on m7_stale_offer_id to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select public.select_wanted_offer('c7300000-0000-4000-8000-000000000003', (select id from m7_stale_offer_id), 1) $$,
  'P0001', 'selectable current offer required', 'requester cannot select an offer after the offerer loses group authority'
);
reset role;
select is((select status::text from public.wanted_requests where id = 'c7300000-0000-4000-8000-000000000003'), 'open', 'failed stale-authority selection leaves request open');
select is((select status::text from public.wanted_offers where request_id = 'c7300000-0000-4000-8000-000000000003'), 'active', 'failed stale-authority selection leaves offer unchanged for explicit later invalidation');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$ select public.update_supply('c7200000-0000-4000-8000-000000000001', 'M7 owner tent', '', 'tents-shelters', 2, 'unlisted', 'good') $$,
  'owner unlists the offered item through the ordinary listing workflow'
);
reset role;
select is((select status::text from public.wanted_requests where title = 'Two-person backpacking tent'), 'open', 'unlisting invalidates selection and reopens the wanted request');
select is((select status::text from public.wanted_offers where id = (select offer_id from m7_test_ids)), 'invalidated', 'unlisting invalidates the selected offer');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.moderate_wanted_request((select request_id from m7_test_ids), 3, 'Duplicate request after direct discussion') $$,
  'Administrator moderates with an audited reason'
);
select is((select count(*)::integer from public.private_wanted_requests('moderated', null, null)), 1, 'Administrator can read the bounded moderated view');
select lives_ok(
  $$ select public.restore_wanted_request((select request_id from m7_test_ids), 4, 'closed', 'Keep as resolved history') $$,
  'Administrator restores to non-reopenable closed state with a second audit'
);
reset role;
select is((select count(*) from public.wanted_request_moderation_audit), 2::bigint, 'moderation and restoration each append immutable audit');

insert into public.wanted_requests
  (community_id, requester_id, title, desired_quantity, status, closure_kind, created_at)
select 'c7000000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000002',
  'Closed page row ' || i, 1, 'closed', 'voluntary', '2028-07-01T00:00:00Z'::timestamptz + i * interval '1 second'
from generate_series(1, 25) i;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.private_wanted_requests('closed', null, null)), 24, 'wanted board enforces a 24-row page');
select is((with first_page as (select * from public.private_wanted_requests('closed', null, null) order by created_at, id limit 1)
  select count(*)::integer from public.private_wanted_requests('closed', (select created_at from first_page), (select id from first_page))), 2, 'stable creation/id cursor returns the remaining rows without duplication');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select * from public.private_wanted_requests('moderated', null, null) $$,
  'P0001', 'administrator required', 'ordinary member cannot browse moderated requests'
);
select throws_ok(
  $$ select public.reopen_wanted_request((select request_id from m7_test_ids), 5) $$,
  'P0001', 'reopenable current wanted request required', 'moderation-restored closed request cannot be reopened by requester'
);

reset role;
delete from public.wanted_offers where request_id in (
  'c7300000-0000-4000-8000-000000000002',
  'c7300000-0000-4000-8000-000000000003'
);
delete from public.wanted_requests where id in (
  'c7300000-0000-4000-8000-000000000002',
  'c7300000-0000-4000-8000-000000000003'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000003', true);

do $$
begin
  for i in 1..10 loop
    perform public.create_wanted_request('Open request ' || i, null, 1, null, null, null);
  end loop;
end;
$$;
select throws_ok(
  $$ select public.create_wanted_request('Eleventh open request', null, 1, null, null, null) $$,
  'P0001', 'at most ten open wanted requests are allowed', 'server enforces ten concurrent open requests per member'
);
select is((select count(*)::integer from public.private_wanted_requests('open', null, null)), 10, 'failed eleventh creation leaves the exact ten requests');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7100000-0000-4000-8000-000000000005', true);
select is((select count(*)::integer from public.private_wanted_requests('open', null, null)), 0, 'cross-community member receives no request rows or counts');
select is((select count(*)::integer from public.private_manageable_listings_for_wanted()), 0, 'cross-community member receives no listing choices');
reset role;

select ok((select count(*) from public.private_notifications where event_type like 'wanted_%') >= 8, 'authoritative wanted transitions emitted bounded private notification records');
select ok(not exists (select 1 from public.transactional_email_outbox where event_type like 'wanted_%' and payload::text like '%weekend%'), 'notification payloads contain no wanted prose');

select * from finish();
rollback;
