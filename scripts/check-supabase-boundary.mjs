import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { CLIENT_INVOKABLE_FUNCTIONS, DENIED_ROOT_FUNCTIONS, FINAL_FUNCTIONS, IMPLEMENTED_FUNCTIONS, validateHostedFunctionInventory } from "./function-policy.mjs";
import { validateFunctionInventory, validateFunctionRuntimeSource } from "./function-source-policy.mjs";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const commandSources = [
  ["package.json", JSON.stringify(packageJson.scripts, null, 2)],
  ["README.md", await readFile(resolve(root, "README.md"), "utf8")],
  ["docs/hosting.md", await readFile(resolve(root, "docs/hosting.md"), "utf8")],
];

for (const [source, contents] of commandSources) {
  for (const line of contents.split("\n")) {
    if (/\bsupabase\b/.test(line) && /\b(start|stop|status|reset|migration|db)\b/.test(line)) {
      if (line.includes("--workdir")) {
        throw new Error(`${source} contains an obsolete Supabase workdir argument: ${line.trim()}`);
      }
    }
  }
}

const migrations = await readdir(resolve(root, "supabase/migrations"));
if (migrations.length === 0 || migrations.some((name) => !/^\d+_[a-z0-9_]+\.sql$/.test(name))) {
  throw new Error("supabase/migrations must contain only timestamped SQL migrations");
}
const expectedMigrations = [
  "202608150001_consolidated_schema.sql",
  "202608150002_reference_data_and_jobs.sql",
  "202608150003_simplify_ai_activation.sql",
  "202608150004_initialize_community.sql",
  "20260816164912_bounded_membership_snapshot.sql",
  "20260816170154_rejected_membership_reapplication.sql",
  "20260816171635_notify_membership_reapplication_allowed.sql",
  "20260816175357_fix_regular_member_catalog_visibility.sql",
  "20260816183918_reject_past_loan_dates.sql",
  "20260816184306_distinguish_loan_request_notifications.sql",
  "20260816190138_one_time_wanted_offers.sql",
  "20260816193000_preapproved_member_invitations.sql",
  "20260817004358_invitation_ses_delivery_retries.sql",
  "20260817011756_fix_invitation_email_validation.sql",
  "20260817034442_expose_confirmed_email_to_administrators.sql",
  "20260817035350_show_auth_account_email_to_administrators.sql",
  "20260817120000_suppress_actor_transactional_email.sql",
  "20260817144924_delete_deactivated_member.sql",
  "20260817153719_dismiss_all_notifications.sql",
  "20260817161027_expose_pending_loan_demand.sql",
  "20260817163252_date_aware_catalog_availability.sql",
];
if (JSON.stringify(migrations.sort()) !== JSON.stringify(expectedMigrations)) {
  throw new Error(`gear share migration inventory must equal the reviewed baseline plus forward changes: ${expectedMigrations.join(", ")}`);
}
const migrationSource = (await Promise.all(migrations.map((name) => readFile(resolve(root, "supabase/migrations", name), "utf8")))).join("\n");
// Supabase's generated squash quotes schema identifiers. Normalize only for
// static contract discovery; the database tests remain authoritative for SQL
// behavior and privileges.
const migrationContractSource = migrationSource
  .replaceAll('"', "")
  .toLowerCase()
  .replaceAll("if not exists ", "");
if (migrationContractSource.includes("automatic_regular")) {
  throw new Error("gear share migrations must not contain an automatic admission value or branch");
}
if (!/create type\s+public\.community_join_mode\s+as enum\s*\(\s*'approval_required'\s*\)/.test(migrationContractSource)) {
  throw new Error("gear share admission policy must remain the singleton approval_required enum");
}
for (const requiredM6Contract of [
  "create table public.legacy_deactivation_backfill_manifest",
  "create or replace function public.validate_m6_legacy_deactivation_manifest()",
  "create or replace function public.private_member_administration()",
  "create or replace function public.update_community_display_name(",
  "create or replace function public.set_ai_drafting_enabled(",
  "create or replace function public.reactivation_impact(",
  "create or replace function public.reactivate_member(",
  "create or replace function public.get_my_administrator_orientation()",
]) {
  if (!migrationContractSource.includes(requiredM6Contract)) throw new Error(`gear share migrations are missing the legacy-deactivation contract: ${requiredM6Contract}`);
}
if (!migrationContractSource.includes("app.m6_reviewed_legacy_manifest")
  || !/evidence_origin\s+text\s+default\s+'workflow'(?:::text)?\s+not null/.test(migrationContractSource)) {
  throw new Error("migrations must preserve the exact evidence-gated legacy-deactivation path");
}
if (/create\s+(or\s+replace\s+)?function\s+public\.[a-z0-9_]*(statistics|member_count|automatic_admission)/i.test(migrationContractSource)) {
  throw new Error("gear share migrations must not expose statistics, member-count, or automatic-admission functions");
}
if (!migrationContractSource.includes("create or replace function public.my_membership_snapshot()")
  || !migrationContractSource.includes("security invoker")) {
  throw new Error("gear share membership must use the bounded caller-derived membership snapshot");
}
if (!migrationContractSource.includes("create or replace function public.allow_membership_reapplication(target_user_id uuid)")
  || !migrationContractSource.includes("p.membership_status in ('active', 'rejected', 'deactivated')")
  || !migrationContractSource.includes("'membership_reapplication_allowed',")
  || !migrationContractSource.includes("perform public.emit_private_notification(")
  || !migrationContractSource.includes("after insert or update on public.membership_applications")
  || !migrationContractSource.includes("new.submission_count = old.submission_count + 1")) {
  throw new Error("gear share membership administration must include the bounded rejected-applicant recovery path");
}
if (!migrationContractSource.includes("requested_start < current_date")
  || !migrationContractSource.includes("loan start date must be today or later")) {
  throw new Error("gear share loan requests must reject past start dates server-side");
}
if (!migrationContractSource.includes("'loan_request_received', 'loan_activity'")
  || !migrationContractSource.includes("event_name := 'loan_request_received'")) {
  throw new Error("gear share loan requests must distinguish borrower confirmation from manager review notices");
}
if (!migrationContractSource.includes("supplied_recipient_user_id = auth.uid()")) {
  throw new Error("gear share transactional email must exclude the authenticated action initiator");
}
for (const requiredLoanDemandContract of [
  "create or replace function public.loan_availability_summary(",
  "gl.status = 'pending'",
  "grant execute on function public.loan_availability_summary(uuid, date, date) to authenticated",
]) {
  if (!migrationContractSource.includes(requiredLoanDemandContract)) throw new Error(`gear share migrations are missing pending loan-demand visibility: ${requiredLoanDemandContract}`);
}
for (const requiredDatedCatalogContract of [
  "create or replace function public.private_gear_catalog(",
  "supplied_available_only boolean",
  "available_quantity integer",
  "catalog start date must be today or later",
  "public.max_committed_quantity(s.id, supplied_start, supplied_end)",
  "grant execute on function public.private_gear_catalog(text, text, text, text, text, integer, date, date, boolean) to authenticated",
]) {
  if (!migrationContractSource.includes(requiredDatedCatalogContract)) throw new Error(`gear share migrations are missing date-aware Catalog availability: ${requiredDatedCatalogContract}`);
}
if (!migrationContractSource.includes("create or replace function public.offer_wanted_once(")
  || !migrationContractSource.includes("create or replace function public.select_wanted_one_off_offer(")
  || !migrationContractSource.includes("wanted_only boolean not null default false")
  || !migrationContractSource.includes("not s.wanted_only")) {
  throw new Error("gear share wanted requests must support one-time offers without catalog publication");
}
for (const requiredInvitationContract of [
  "create table public.preapproved_member_invitations",
  "alter table public.preapproved_member_invitations force row level security",
  "create or replace function public.reserve_preapproved_member_invitation(",
  "create or replace function public.fail_preapproved_member_invitation(",
  "create or replace function public.authorize_preapproved_member_invitation_resend(",
  "grant execute on function public.reserve_preapproved_member_invitation(uuid, text, text) to service_role",
  "grant execute on function public.authorize_preapproved_member_invitation_resend(uuid, text) to service_role",
]) {
  if (!migrationContractSource.includes(requiredInvitationContract)) throw new Error(`gear share migrations are missing the personal invitation contract: ${requiredInvitationContract}`);
}
for (const requiredDeletionContract of [
  "create table public.member_account_deletion_reservations",
  "alter table public.member_account_deletion_reservations force row level security",
  "create or replace function public.reserve_deactivated_member_deletion(",
  "create or replace function public.finalize_deactivated_member_deletion(",
  "grant execute on function public.reserve_deactivated_member_deletion(uuid) to authenticated",
  "grant execute on function public.finalize_deactivated_member_deletion(uuid, uuid) to service_role",
  "account_deleted_at is null",
  "display_name = 'deleted member'",
]) {
  if (!migrationContractSource.includes(requiredDeletionContract)) throw new Error(`gear share migrations are missing the deactivated-account deletion contract: ${requiredDeletionContract}`);
}
for (const requiredM8Contract of [
  "create table public.ai_model_price_snapshots",
  "create table public.ai_activation_evidence",
  "create table public.ai_draft_attempts",
  "create or replace function public.batch_stage_gear_drafts(",
  "create or replace function public.private_bulk_draft_attempt_status(",
  "create or replace function public.reserve_ai_drafting_attempt(",
  "create or replace function public.get_ai_drafting_availability()",
  "create or replace function public.complete_ai_drafting_attempt(",
  "create or replace function public.expire_stale_ai_draft_attempts(",
  "cached_input_microdollars_per_million",
  "reasoning_output_tokens",
  "create or replace function public.authorize_ai_activation_check(",
  "create or replace function public.record_ai_activation_check(",
  "activation_check_passed",
  "at most ten",
  "5000000",
]) if (!migrationContractSource.includes(requiredM8Contract)) throw new Error(`gear share migrations are missing the AI-drafting contract: ${requiredM8Contract}`);

const config = await readFile(resolve(root, "supabase/config.toml"), "utf8");
if (!config.includes('sql_paths = ["./seed.sql"]')) {
  throw new Error("gear share config must select only supabase/seed.sql");
}
if (!/\[edge_runtime\][\s\S]*?enabled = true/.test(config)) {
  throw new Error("gear share Edge runtime must be enabled only in supabase/config.toml");
}
for (const [name, verifyJwt] of [["sanitize-gear-image", true], ["draft-gear-listing", true], ["deliver-transactional-notifications", false], ["receive-ses-feedback", false], ["invite-preapproved-member", true], ["delete-deactivated-member", true]]) {
  const pattern = new RegExp(`\\[functions\\.${name}\\]\\s+verify_jwt = ${verifyJwt}`);
  if (IMPLEMENTED_FUNCTIONS.includes(name) && !pattern.test(config)) throw new Error(`${name} must pin verify_jwt = ${verifyJwt}`);
}
const configuredFunctions = [...config.matchAll(/^\[functions\.([a-z0-9-]+)\]$/gm)].map((match) => match[1]).sort();
if (JSON.stringify(configuredFunctions) !== JSON.stringify([...IMPLEMENTED_FUNCTIONS].sort())) {
  throw new Error(`Supabase function config must equal the implemented allowlist: ${IMPLEMENTED_FUNCTIONS.join(", ")}`);
}
validateHostedFunctionInventory(configuredFunctions);

const rollout = await readFile(resolve(root, "docs/transactional-email-rollout.md"), "utf8");
const documentedInventory = rollout.match(/<!-- reviewed-function-inventory:start -->([\s\S]*?)<!-- reviewed-function-inventory:end -->/)?.[1]
  .match(/`([a-z0-9-]+)`/g)?.map((name) => name.slice(1, -1)) ?? [];
if (JSON.stringify([...documentedInventory].sort()) !== JSON.stringify([...IMPLEMENTED_FUNCTIONS].sort())) {
  throw new Error(`documented function inventory must equal the implemented allowlist: ${IMPLEMENTED_FUNCTIONS.join(", ")}`);
}
validateHostedFunctionInventory(documentedInventory);
const directoryNames = async (path) => (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const functions = await directoryNames(resolve(root, "supabase/functions"));
const implemented = [...IMPLEMENTED_FUNCTIONS].sort();
if (JSON.stringify(functions) !== JSON.stringify(implemented)) {
  throw new Error(`gear share function source must equal the implemented allowlist: ${implemented.join(", ")}`);
}
validateHostedFunctionInventory(functions);
if (implemented.some((name) => !FINAL_FUNCTIONS.includes(name))) {
  throw new Error("implemented gear share function is outside the final reviewed allowlist");
}
if (CLIENT_INVOKABLE_FUNCTIONS.some((name) => !implemented.includes(name))) {
  throw new Error("client-invokable function must be implemented");
}
const functionSources = {};
for (const name of implemented) {
  const directory = resolve(root, "supabase/functions", name);
  const files = (await readdir(directory, { withFileTypes: true }));
  if (files.some((entry) => !entry.isFile())) throw new Error(`${name} contains an unreviewed nested function source path`);
  const names = files.map((entry) => entry.name).sort();
  validateFunctionInventory(name, names);
  functionSources[name] = (await Promise.all(names.filter((file) => !file.endsWith(".test.ts")).map((file) => readFile(resolve(directory, file), "utf8")))).join("\n");
}
for (const [name, source] of Object.entries(functionSources)) validateFunctionRuntimeSource(name, source);
if (functions.some((name) => DENIED_ROOT_FUNCTIONS.includes(name))) {
  throw new Error("a denied legacy function is present in the active function source");
}

console.log(`Gear Share migration/function boundary OK (${migrations.length} migrations; ${functions.join(", ")}).`);
