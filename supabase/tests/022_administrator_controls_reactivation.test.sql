begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.communities (id, slug, name)
values
  ('8b000000-0000-4000-8000-000000000001', 'm6-primary', 'Milestone Six'),
  ('8b000000-0000-4000-8000-000000000002', 'm6-cross', 'Cross Community');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '8b100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'm6-admin@example.test', '', now(), now(), now(), '{"display_name":"M6 Administrator"}'),
  ('00000000-0000-0000-0000-000000000000', '8b100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'm6-custodian@example.test', '', now(), now(), now(), '{"display_name":"M6 Custodian"}'),
  ('00000000-0000-0000-0000-000000000000', '8b100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'm6-member@example.test', '', now(), now(), now(), '{"display_name":"M6 Member"}'),
  ('00000000-0000-0000-0000-000000000000', '8b100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'm6-successor@example.test', '', now(), now(), now(), '{"display_name":"M6 Successor"}'),
  ('00000000-0000-0000-0000-000000000000', '8b100000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'm6-stale@example.test', '', now(), now(), now(), '{"display_name":"M6 Stale Target"}'),
  ('00000000-0000-0000-0000-000000000000', '8b100000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'm6-cross@example.test', '', now(), now(), now(), '{"display_name":"M6 Cross Admin"}'),
  ('00000000-0000-0000-0000-000000000000', '8b100000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'm6-second-admin@example.test', '', now(), now(), now(), '{"display_name":"M6 Second Administrator"}');

alter table public.profiles disable trigger profile_membership_notification;
update public.profiles
set community_id = '8b000000-0000-4000-8000-000000000001', membership_status = 'active',
    approved_by = '8b100000-0000-4000-8000-000000000001', approved_at = now()
where id between '8b100000-0000-4000-8000-000000000001' and '8b100000-0000-4000-8000-000000000005';
update public.profiles
set community_id = '8b000000-0000-4000-8000-000000000001', membership_status = 'active',
    approved_by = '8b100000-0000-4000-8000-000000000001', approved_at = now()
where id = '8b100000-0000-4000-8000-000000000007';
update public.profiles
set community_id = '8b000000-0000-4000-8000-000000000002', membership_status = 'active',
    approved_by = '8b100000-0000-4000-8000-000000000006', approved_at = now()
where id = '8b100000-0000-4000-8000-000000000006';
alter table public.profiles enable trigger profile_membership_notification;

insert into public.community_roles (community_id, user_id, role, granted_by)
values
  ('8b000000-0000-4000-8000-000000000001', '8b100000-0000-4000-8000-000000000001', 'member', '8b100000-0000-4000-8000-000000000001'),
  ('8b000000-0000-4000-8000-000000000001', '8b100000-0000-4000-8000-000000000001', 'steward', '8b100000-0000-4000-8000-000000000001'),
  ('8b000000-0000-4000-8000-000000000001', '8b100000-0000-4000-8000-000000000002', 'member', '8b100000-0000-4000-8000-000000000001'),
  ('8b000000-0000-4000-8000-000000000001', '8b100000-0000-4000-8000-000000000002', 'custodian', '8b100000-0000-4000-8000-000000000001'),
  ('8b000000-0000-4000-8000-000000000001', '8b100000-0000-4000-8000-000000000003', 'member', '8b100000-0000-4000-8000-000000000001'),
  ('8b000000-0000-4000-8000-000000000001', '8b100000-0000-4000-8000-000000000004', 'member', '8b100000-0000-4000-8000-000000000001'),
  ('8b000000-0000-4000-8000-000000000001', '8b100000-0000-4000-8000-000000000005', 'member', '8b100000-0000-4000-8000-000000000001'),
  ('8b000000-0000-4000-8000-000000000002', '8b100000-0000-4000-8000-000000000006', 'member', '8b100000-0000-4000-8000-000000000006'),
  ('8b000000-0000-4000-8000-000000000002', '8b100000-0000-4000-8000-000000000006', 'steward', '8b100000-0000-4000-8000-000000000006'),
  ('8b000000-0000-4000-8000-000000000001', '8b100000-0000-4000-8000-000000000007', 'member', '8b100000-0000-4000-8000-000000000001'),
  ('8b000000-0000-4000-8000-000000000001', '8b100000-0000-4000-8000-000000000007', 'steward', '8b100000-0000-4000-8000-000000000001');

select set_config('app.milestone_six_internal_change', 'allowed', true);
insert into public.community_setting_versions
  (community_id, version, display_name, ai_drafting_enabled, operator_identifier)
values
  ('8b000000-0000-4000-8000-000000000001', 1, 'Milestone Six', false, 'milestone-6-migration'),
  ('8b000000-0000-4000-8000-000000000002', 1, 'Cross Community', false, 'milestone-6-migration');
insert into public.community_settings
  (community_id, current_version, display_name, ai_drafting_enabled)
values
  ('8b000000-0000-4000-8000-000000000001', 1, 'Milestone Six', false),
  ('8b000000-0000-4000-8000-000000000002', 1, 'Cross Community', false);
select set_config('app.milestone_six_internal_change', '', true);

select has_table('public', 'community_setting_versions', 'immutable community setting versions exist');
select has_table('public', 'legacy_deactivation_backfill_manifest', 'legacy deactivation evidence has a bounded predecessor manifest');
select has_table('public', 'administrator_ai_setting_audit', 'AI setting attempts have immutable audit evidence');
select has_table('public', 'membership_reactivation_audit', 'reactivation has immutable audit evidence');
select has_table('public', 'administrator_orientation_progress', 'Administrator orientation progress exists');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
  'public.community_setting_versions'::regclass,
  'public.community_settings'::regclass,
  'public.legacy_deactivation_backfill_manifest'::regclass,
  'public.administrator_ai_setting_audit'::regclass,
  'public.membership_deactivation_consequences'::regclass,
  'public.membership_reactivation_audit'::regclass,
  'public.administrator_orientation_registry'::regclass,
  'public.administrator_orientation_progress'::regclass
)), 'all Milestone 6 relations use forced RLS');
select ok(not has_table_privilege('authenticated', 'public.community_settings', 'UPDATE'), 'clients cannot update settings tables directly');
select ok(not has_table_privilege('authenticated', 'public.membership_reactivation_audit', 'SELECT'), 'clients cannot browse reactivation audit directly');
select ok(not has_table_privilege('service_role', 'public.legacy_deactivation_backfill_manifest', 'INSERT'), 'runtime service authority cannot author historical deactivation evidence');
select ok(has_function_privilege('authenticated', 'public.private_member_administration()', 'EXECUTE'), 'authenticated callers may attempt the bounded member RPC');

alter table public.profiles disable trigger profiles_terminal_membership;
alter table public.profiles disable trigger profile_membership_notification;
update public.profiles set membership_status = 'deactivated' where id = '8b100000-0000-4000-8000-000000000004';
alter table public.profiles enable trigger profile_membership_notification;
alter table public.profiles enable trigger profiles_terminal_membership;
select throws_ok(
  $$ select public.validate_m6_legacy_deactivation_manifest() $$,
  'P0001', 'milestone 6 preflight: every pre-existing deactivated profile requires one exact reviewed predecessor-manifest row',
  'ambiguous pre-existing deactivation blocks the Milestone 6 migration path'
);
select set_config('app.m6_reviewed_legacy_manifest', 'allowed', true);
insert into public.legacy_deactivation_backfill_manifest
  (profile_id, community_id, deactivated_by, successor_user_id, prior_access_level,
   affected_listings, cancelled_loans, checked_out_loans, deactivated_at, evidence_reference)
values
  ('8b100000-0000-4000-8000-000000000004', '8b000000-0000-4000-8000-000000000001',
   '8b100000-0000-4000-8000-000000000001', '8b100000-0000-4000-8000-000000000003',
   'regular', 0, 0, 0, now() - interval '1 day', 'reviewed-audit-export-row-004');
select set_config('app.m6_reviewed_legacy_manifest', '', true);
select lives_ok(
  $$ select public.validate_m6_legacy_deactivation_manifest() $$,
  'one exact evidence row makes the predecessor migration path compatible'
);
select set_config('app.m6_reviewed_legacy_manifest', 'allowed', true);
delete from public.legacy_deactivation_backfill_manifest where profile_id = '8b100000-0000-4000-8000-000000000004';
select set_config('app.m6_reviewed_legacy_manifest', '', true);
alter table public.profiles disable trigger profiles_terminal_membership;
alter table public.profiles disable trigger profile_membership_notification;
update public.profiles set membership_status = 'active' where id = '8b100000-0000-4000-8000-000000000004';
alter table public.profiles enable trigger profile_membership_notification;
alter table public.profiles enable trigger profiles_terminal_membership;

set local role authenticated;
select set_config('request.jwt.claim.sub', '8b100000-0000-4000-8000-000000000001', true);
select is((select display_name from public.get_my_community_settings()), 'Milestone Six', 'active member reads bounded community settings');
select is((select configuration_version from public.update_community_display_name('  New   Scout Community  ', 1)), 2::bigint, 'Administrator publishes a normalized versioned name');
select throws_ok(
  $$ select public.update_community_display_name('Null bypass', null) $$,
  'P0001', 'positive expected settings version required', 'NULL cannot bypass the community-setting version guard'
);
select throws_ok(
  $$ select * from public.set_ai_drafting_enabled(true, null) $$,
  'P0001', 'positive expected settings version required', 'NULL cannot bypass the AI-setting version guard'
);
select throws_ok(
  $$ select public.update_community_display_name('Stale', 1) $$,
  'P0001', 'community settings changed; reload before saving', 'stale setting version is rejected'
);
select is((select ai_drafting_enabled from public.set_ai_drafting_enabled(true, 2)), false, 'AI enable remains fail-closed before Milestone 8 gates');
select is(
  (select status_reason from public.set_ai_drafting_enabled(true, 2)),
  'Run the AI connection check before turning on suggestions.',
  'safe-off response explains the current activation gate'
);
select is((select count(*)::integer from public.private_member_administration()), 6, 'Administrator sees bounded active and deactivated member rows in their community');
select is(
  (select account_email from public.private_member_administration() where id = '8b100000-0000-4000-8000-000000000003'),
  'm6-member@example.test',
  'Administrator member administration identifies a member by Auth account email'
);
select is((select count(*)::integer from public.get_my_administrator_orientation()), 6, 'Administrator sees the exact generic orientation registry');
select is((select count(*)::integer from public.get_my_administrator_orientation() where applicable_role = 'administrator'), 6, 'every orientation item declares its exact applicable role');
select lives_ok(
  $$ select public.set_my_administrator_orientation(1, 'review_privacy', 'completed') $$,
  'Administrator records self-scoped orientation progress'
);
select is((select status from public.get_my_administrator_orientation() where item_id = 'review_privacy'), 'completed', 'orientation progress is returned for the same Administrator');
reset role;

select set_config('app.milestone_six_internal_change', 'allowed', true);
insert into public.administrator_orientation_registry
  (registry_version, item_id, label, help_text, route_id, display_order, required, applicable_role)
values (2, 'review_privacy', 'Review revised privacy', 'Review the current private-community terms.', 'privacy', 1, true, 'administrator');
select set_config('app.milestone_six_internal_change', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '8b100000-0000-4000-8000-000000000001', true);
select is((select registry_version from public.get_my_administrator_orientation()), 2, 'a checked-in registry version becomes the visible orientation version');
select is((select status from public.get_my_administrator_orientation()), null, 'new orientation version visibly resets current completion without deleting history');
reset role;

select is((select name from public.communities where id = '8b000000-0000-4000-8000-000000000001'), 'New Scout Community', 'public join source receives the reviewed display name');
select is((select ai_drafting_enabled from public.community_settings where community_id = '8b000000-0000-4000-8000-000000000001'), false, 'failed enable does not mutate authoritative state');
select is((select count(*) from public.administrator_ai_setting_audit where community_id = '8b000000-0000-4000-8000-000000000001' and outcome = 'rejected_missing_gates'), 2::bigint, 'each failed enable readiness check records bounded immutable audit');
select is((select count(*) from public.community_setting_versions where community_id = '8b000000-0000-4000-8000-000000000001'), 2::bigint, 'only committed settings changes create versions');

set local role authenticated;
select set_config('request.jwt.claim.sub', '8b100000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select public.update_community_display_name('Unauthorized', 2) $$,
  'P0001', 'active administrator required', 'Regular member cannot rename the community'
);
select throws_ok(
  $$ select * from public.private_member_administration() $$,
  'P0001', 'active administrator required', 'Regular member cannot enumerate administration rows'
);
select throws_ok(
  $$ select * from public.get_my_administrator_orientation() $$,
  'P0001', 'active administrator required', 'Regular member cannot read Administrator orientation'
);
select throws_ok(
  $$ select * from public.set_ai_drafting_enabled(true, 2) $$,
  'P0001', 'active administrator required', 'Regular member cannot inspect or mutate AI readiness state'
);
reset role;

insert into public.supplies (
  id, community_id, title, description, category, condition, ownership_kind,
  owner_id, custodian_id, quantity_total, listing_status, created_by
) values
  ('8b200000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000001', 'Group tent', '', 'tents-shelters', 'good', 'group', null, '8b100000-0000-4000-8000-000000000002', 1, 'listed', '8b100000-0000-4000-8000-000000000001'),
  ('8b200000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-000000000001', 'Stale pack', '', 'packs-storage', 'good', 'individual', '8b100000-0000-4000-8000-000000000005', '8b100000-0000-4000-8000-000000000005', 1, 'listed', '8b100000-0000-4000-8000-000000000005');

set local role authenticated;
select set_config('request.jwt.claim.sub', '8b100000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.deactivate_member('8b100000-0000-4000-8000-000000000002', '8b100000-0000-4000-8000-000000000004') $$,
  'Administrator deactivates through the consequence-recording workflow'
);
select is((select membership_status from public.reactivation_impact('8b100000-0000-4000-8000-000000000002')), 'deactivated', 'target is deactivated');
select is((select custodian_id from public.supplies where id = '8b200000-0000-4000-8000-000000000001'), '8b100000-0000-4000-8000-000000000004'::uuid, 'deactivation reassigns Stored with authority');
select set_config('test.m6_preview', (select preview_version from public.reactivation_impact('8b100000-0000-4000-8000-000000000002')), true);
select lives_ok(
  $$ select public.reactivate_member('8b100000-0000-4000-8000-000000000002', current_setting('test.m6_preview'), 'Administrator reviewed prior consequences') $$,
  'Administrator confirms the exact reviewed reactivation impact'
);
reset role;

select is((select membership_status from public.profiles where id = '8b100000-0000-4000-8000-000000000002'), 'active'::public.membership_status, 'reactivation restores active membership');
select is((select count(*) from public.community_roles where user_id = '8b100000-0000-4000-8000-000000000002' and role = 'member'), 1::bigint, 'reactivation restores only baseline Regular role');
select is((select count(*) from public.community_roles where user_id = '8b100000-0000-4000-8000-000000000002' and role in ('custodian', 'steward')), 0::bigint, 'reactivation does not restore elevated roles');
select is((select custodian_id from public.supplies where id = '8b200000-0000-4000-8000-000000000001'), '8b100000-0000-4000-8000-000000000004'::uuid, 'reactivation preserves reassigned Stored with authority');
select is((select count(*) from public.membership_reactivation_audit where profile_id = '8b100000-0000-4000-8000-000000000002'), 1::bigint, 'reactivation records one immutable audit row');
select is((select count(*) from public.private_notifications where event_type = 'membership_reactivated' and recipient_user_id = '8b100000-0000-4000-8000-000000000002'), 1::bigint, 'reactivation emits exactly one member lifecycle notification');
select is((select count(*) from public.transactional_email_outbox where event_type = 'membership_reactivated' and recipient_user_id = '8b100000-0000-4000-8000-000000000002'), 1::bigint, 'reactivation atomically creates required email work');
select is((select count(*) from public.private_notifications where event_type = 'membership_reactivated_admin' and recipient_user_id = '8b100000-0000-4000-8000-000000000001'), 1::bigint, 'initiating Administrator keeps the Administrator-directed in-app notification');
select is((select count(*) from public.transactional_email_outbox where event_type = 'membership_reactivated_admin' and recipient_user_id = '8b100000-0000-4000-8000-000000000001'), 0::bigint, 'initiating Administrator receives no reactivation email');
select is((select count(*) from public.transactional_email_outbox where event_type = 'membership_reactivated_admin' and recipient_user_id = '8b100000-0000-4000-8000-000000000007' and status = 'pending'), 1::bigint, 'another Administrator receives one Administrator-directed reactivation email');
select is((select email_body from public.notification_event_registry where event_type = 'membership_reactivated_admin'), 'A member''s membership was restored. Open Gear Share to review member access.', 'other Administrator email does not claim their own membership was restored');
set local role authenticated;
select set_config('request.jwt.claim.sub', '8b100000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.reactivate_member('8b100000-0000-4000-8000-000000000002', current_setting('test.m6_preview'), 'Administrator reviewed prior consequences') $$,
  'exact retry is idempotent after successful reactivation'
);
reset role;
select is((select count(*) from public.membership_reactivation_audit where profile_id = '8b100000-0000-4000-8000-000000000002'), 1::bigint, 'idempotent retry creates no duplicate audit');
select is((select count(*) from public.private_notifications where event_type = 'membership_reactivated' and recipient_user_id = '8b100000-0000-4000-8000-000000000002'), 1::bigint, 'idempotent retry creates no duplicate notification');
set local role authenticated;
select set_config('request.jwt.claim.sub', '8b100000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.deactivate_member('8b100000-0000-4000-8000-000000000002', '8b100000-0000-4000-8000-000000000004') $$,
  'a later reviewed deactivation creates a new immutable lifecycle cycle'
);
select set_config('test.m6_second_preview', (select preview_version from public.reactivation_impact('8b100000-0000-4000-8000-000000000002')), true);
select lives_ok(
  $$ select public.reactivate_member('8b100000-0000-4000-8000-000000000002', current_setting('test.m6_second_preview'), 'Reviewed the second deactivation cycle') $$,
  'the same member can be reactivated after a later independent deactivation'
);
reset role;
select is((select count(*) from public.membership_deactivation_consequences where profile_id = '8b100000-0000-4000-8000-000000000002'), 2::bigint, 'each deactivation cycle retains distinct immutable consequence evidence');
select is((select count(*) from public.membership_reactivation_audit where profile_id = '8b100000-0000-4000-8000-000000000002'), 2::bigint, 'each completed reactivation cycle retains distinct immutable audit evidence');
select is((select count(*) from public.private_notifications where event_type = 'membership_reactivated' and recipient_user_id = '8b100000-0000-4000-8000-000000000002'), 2::bigint, 'each real reactivation cycle emits exactly one lifecycle notification');

set local role authenticated;
select set_config('request.jwt.claim.sub', '8b100000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.deactivate_member('8b100000-0000-4000-8000-000000000005', '8b100000-0000-4000-8000-000000000004') $$,
  'second member is deactivated for stale-preview coverage'
);
select set_config('test.m6_stale_preview', (select preview_version from public.reactivation_impact('8b100000-0000-4000-8000-000000000005')), true);
reset role;
update public.supplies set custodian_id = '8b100000-0000-4000-8000-000000000001' where id = '8b200000-0000-4000-8000-000000000002';
select is((select custodian_id from public.supplies where id = '8b200000-0000-4000-8000-000000000002'), '8b100000-0000-4000-8000-000000000001'::uuid, 'stale-preview fixture changes authoritative listing authority');
select isnt(public.reactivation_state_version('8b100000-0000-4000-8000-000000000005', '8b000000-0000-4000-8000-000000000001'), current_setting('test.m6_stale_preview'), 'reactivation state version covers listing authority changes');
set local role authenticated;
select set_config('request.jwt.claim.sub', '8b100000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.reactivate_member('8b100000-0000-4000-8000-000000000005', current_setting('test.m6_stale_preview'), 'This preview is stale') $$,
  'P0001', 'reactivation impact changed; reload before confirming', 'material consequence change invalidates a stale preview'
);
reset role;
select is((select membership_status from public.profiles where id = '8b100000-0000-4000-8000-000000000005'), 'deactivated'::public.membership_status, 'stale preview leaves membership unchanged');
set local role authenticated;
select set_config('request.jwt.claim.sub', '8b100000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select * from public.reactivation_impact('8b100000-0000-4000-8000-000000000005') $$,
  'P0001', 'active administrator required', 'Regular member cannot preview reactivation consequences'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '8b100000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$ select * from public.reactivation_impact('8b100000-0000-4000-8000-000000000005') $$,
  'P0001', 'deactivated same-community member required', 'cross-community Administrator cannot preview a target'
);
reset role;
update public.profiles set membership_status = 'rejected' where id = '8b100000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub', '8b100000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select * from public.reactivation_impact('8b100000-0000-4000-8000-000000000003') $$,
  'P0001', 'deactivated same-community member required', 'rejected applicant cannot enter the reactivation workflow'
);
reset role;
select throws_ok(
  $$ update public.profiles set membership_status = 'active' where id = '8b100000-0000-4000-8000-000000000005' $$,
  'P0001', 'deactivated membership requires the reviewed Administrator reactivation workflow', 'direct reactivation remains blocked'
);

select is((select slug from public.communities where id = '8b000000-0000-4000-8000-000000000001'), 'm6-primary', 'community rename preserves the stable slug');
select is((select count(*) from public.community_roles where community_id = '8b000000-0000-4000-8000-000000000001'), 7::bigint, 'community settings never grant roles or automatic admission');

select ok(not exists (
  select 1 from information_schema.routines
  where routine_schema = 'public' and routine_name ~ '(statistic|member_count|automatic|join_mode)'
), 'Milestone 6 adds no statistics or automatic-admission API');

select * from finish();
rollback;
