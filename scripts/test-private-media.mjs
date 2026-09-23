import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const status = spawnSync("supabase", ["status", "-o", "env"], {
  cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DOCKER_API_VERSION: "1.43" },
});
if (status.status !== 0) throw new Error(`Unable to inspect local gear share stack: ${status.stderr.trim()}`);
const setting = (name) => {
  const match = status.stdout.match(new RegExp(`^${name}="([^"]+)"$`, "m"));
  if (!match) throw new Error(`Local Supabase status did not provide ${name}`);
  return match[1];
};
const apiUrl = setting("API_URL");
const anonKey = setting("ANON_KEY");
const serviceKey = setting("SERVICE_ROLE_KEY");
const boundedServiceFetch = (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) });
const service = createClient(apiUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: boundedServiceFetch },
});
const discovery = spawnSync("docker", ["ps", "--filter", "label=com.supabase.cli.project=community-gear-lending", "--filter", "name=supabase_db_", "--format", "{{.Names}}"], { encoding: "utf8" });
const containers = discovery.stdout.trim().split("\n").filter(Boolean);
if (discovery.status !== 0 || containers.length !== 1) throw new Error(`Expected one local gear share database container; found ${containers.length}`);
function runSql(sql) {
  const result = spawnSync("docker", ["exec", "-i", containers[0], "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: sql, encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL" });
  if (result.status !== 0) throw new Error(`Private-media fixture SQL failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}
const child = spawn("supabase", ["functions", "serve", "--env-file", "scripts/fixtures/private-media-function.env", "--no-verify-jwt"], {
  cwd: process.cwd(), env: { ...process.env, DOCKER_API_VERSION: "1.43" }, stdio: ["ignore", "pipe", "pipe"],
});
let functionLogs = "";
child.stdout.on("data", (chunk) => { functionLogs += chunk.toString(); });
child.stderr.on("data", (chunk) => { functionLogs += chunk.toString(); });

async function waitForFunction() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Local function runtime exited early:\n${functionLogs.slice(-4000)}`);
    if (!functionLogs.includes("Serving functions on")) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    try {
      const response = await fetch(`${apiUrl}/functions/v1/sanitize-gear-image`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer local-readiness-probe" }, body: "{}" });
      if (response.status === 400 && (await response.text()).includes("valid attempt and digest required")) return;
    } catch { /* runtime is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for local sanitizer:\n${functionLogs.slice(-4000)}`);
}

const suffix = randomUUID();
const email = `media-e2e-${suffix}@example.test`;
const password = `Local-only-${suffix}!`;
let userId;
let supplyId;
let stagingPath;
let finalPath;
try {
  await waitForFunction();
  const deniedOrigin = await fetch(`${apiUrl}/functions/v1/sanitize-gear-image`, { method: "POST", headers: { origin: "https://untrusted.example", authorization: "Bearer local-readiness-probe", "content-type": "application/json" }, body: "{}" });
  if (deniedOrigin.status !== 403) throw new Error(`sanitizer accepted an untrusted browser origin: ${deniedOrigin.status}`);
  const allowedOrigin = await fetch(`${apiUrl}/functions/v1/sanitize-gear-image`, { method: "POST", headers: { origin: "http://127.0.0.1:4173", authorization: "Bearer local-readiness-probe", "content-type": "application/json" }, body: "{}" });
  if (allowedOrigin.status !== 400) throw new Error(`sanitizer did not accept the configured browser origin: ${allowedOrigin.status}`);
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Media E2E" } });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const communityId = runSql("select id from public.communities where slug = 'gear-share-community';");
  runSql(`
update public.profiles set membership_status = 'active', approved_by = '${userId}', approved_at = now() where id = '${userId}';
insert into public.community_roles (community_id, user_id, role, granted_by) values ('${communityId}', '${userId}', 'member', '${userId}');
`);
  const caller = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await caller.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const publicationAttempt = randomUUID();
  const draft = await caller.rpc("create_or_resume_individual_draft", {
    supplied_attempt_id: publicationAttempt, supplied_title: "Sanitized local fixture", supplied_description: "Disposable",
    supplied_category: "other-gear", supplied_quantity: 1, supplied_condition: "good", supplied_expected_images: 1,
  });
  if (draft.error) throw draft.error;
  supplyId = draft.data.id;
  const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAACKADAAQAAAABAAAACAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgACAAIAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAExMTExMTIBMTIC0gICAtPS0tLS09TT09PT09TV1NTU1NTU1dXV1dXV1dXXBwcHBwcIODg4ODk5OTk5OTk5OTk//bAEMBFxgYJSMlQCMjQJloVWiZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmf/dAAQAAf/aAAwDAQACEQMRAD8A6jnPtS0UVym5/9k=", "base64");
  const digest = createHash("sha256").update(jpeg).digest("hex");
  const mediaAttempt = await caller.rpc("begin_gear_media_upload", { target_supply_id: supplyId, supplied_slot: 0, supplied_source_digest: digest });
  if (mediaAttempt.error) throw mediaAttempt.error;
  stagingPath = mediaAttempt.data.staging_path;
  const staged = await caller.storage.from("gear-image-staging").upload(stagingPath, jpeg, { contentType: "image/jpeg" });
  if (staged.error) throw staged.error;
  const sanitized = await caller.functions.invoke("sanitize-gear-image", { body: { attemptId: mediaAttempt.data.id, sourceDigest: digest } });
  if (sanitized.error) {
    const detail = sanitized.error.context instanceof Response ? await sanitized.error.context.text() : sanitized.error.message;
    throw new Error(`sanitizer request failed: ${detail}\n${functionLogs.slice(-4000)}`);
  }
  if (!sanitized.data?.path) throw new Error("sanitizer returned no path");
  finalPath = sanitized.data.path;
  const retried = await caller.functions.invoke("sanitize-gear-image", { body: { attemptId: mediaAttempt.data.id, sourceDigest: digest } });
  if (retried.error) {
    const detail = retried.error.context instanceof Response ? await retried.error.context.text() : retried.error.message;
    throw new Error(`sanitizer retry failed: ${detail}\n${functionLogs.slice(-4000)}`);
  }
  if (retried.data?.path !== finalPath || retried.data?.recovered !== true) throw new Error("sanitizer retry was not idempotent");
  const published = await caller.rpc("publish_supply_draft", { target_supply_id: supplyId, supplied_attempt_id: publicationAttempt });
  if (published.error || published.data.listing_status !== "listed" || published.data.image_paths[0] !== finalPath) throw published.error ?? new Error("sanitized draft did not publish");
  const finalObject = await service.storage.from("gear-images").download(finalPath);
  if (finalObject.error) throw finalObject.error;
  const finalBytes = Buffer.from(await finalObject.data.arrayBuffer());
  if (finalBytes.length > 2 * 1024 * 1024 || finalBytes[0] !== 0xff || finalBytes[1] !== 0xd8) throw new Error("final object is not a bounded JPEG");
  for (let offset = 2; offset < Math.min(finalBytes.length, 256 * 1024);) {
    while (offset < finalBytes.length && finalBytes[offset] === 0xff) offset += 1;
    const marker = finalBytes[offset++];
    if (marker === 0xd9 || marker === 0xda || marker === undefined) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = finalBytes[offset] * 256 + finalBytes[offset + 1];
    if (marker === 0xfe || (marker >= 0xe1 && marker <= 0xef)) throw new Error("sanitized JPEG retained disallowed metadata");
    offset += length;
  }
  const directPath = `${communityId}/${supplyId}/${randomUUID()}.jpg`;
  const denied = await caller.storage.from("gear-images").upload(directPath, jpeg, { contentType: "image/jpeg" });
  if (!denied.error) throw new Error("authenticated client unexpectedly inserted a final media object directly");
  process.stdout.write(`Private media end-to-end invariant OK: ${JSON.stringify({ finalBytes: finalBytes.length, retryRecovered: true, directFinalWriteDenied: true, configuredOriginEnforced: true, metadataStripped: true })}\n`);
} finally {
  const cleanupErrors = [];
  const debugCleanup = (label) => { if (process.env.MEDIA_CLEANUP_DEBUG === "1") process.stderr.write(`media cleanup: ${label}\n`); };
  const cleanup = async (label, operation) => {
    try {
      const result = await operation();
      if (result?.error) throw result.error;
    } catch { cleanupErrors.push(label); }
  };
  debugCleanup("staging object");
  if (stagingPath) await cleanup("staging object", () => service.storage.from("gear-image-staging").remove([stagingPath]));
  debugCleanup("final object");
  if (finalPath) await cleanup("final object", () => service.storage.from("gear-images").remove([finalPath]));
  if (supplyId) {
    debugCleanup("database fixture");
    try {
      runSql(`delete from public.gear_media_upload_attempts where supply_id = '${supplyId}'; set session_replication_role = replica; delete from public.supply_condition_history where supply_id = '${supplyId}'; set session_replication_role = origin; delete from public.supplies where id = '${supplyId}';`);
    } catch { cleanupErrors.push("database fixture"); }
  }
  if (userId) {
    debugCleanup("notification fixtures");
    try {
      runSql(`
begin;
alter table public.ses_feedback_events disable trigger ses_feedback_events_protected;
alter table public.notification_delivery_attempts disable trigger notification_delivery_attempts_protected;
alter table public.transactional_email_outbox disable trigger transactional_email_outbox_protected;
alter table public.transactional_email_suppressions disable trigger transactional_email_suppressions_protected;
alter table public.transactional_email_preferences disable trigger transactional_email_preferences_protected;
alter table public.transactional_email_suppression_audit disable trigger transactional_email_suppression_audit_protected;
alter table public.transactional_email_preference_audit disable trigger transactional_email_preference_audit_protected;
alter table public.private_notifications disable trigger private_notifications_protected;
delete from public.ses_feedback_events where outbox_id in (select id from public.transactional_email_outbox where recipient_user_id = '${userId}');
delete from public.notification_delivery_attempts where outbox_id in (select id from public.transactional_email_outbox where recipient_user_id = '${userId}');
delete from public.transactional_email_suppressions where recipient_user_id = '${userId}';
delete from public.transactional_email_preferences where profile_id = '${userId}';
delete from public.transactional_email_suppression_audit where recipient_user_id = '${userId}' or actor_user_id = '${userId}';
delete from public.transactional_email_preference_audit where profile_id = '${userId}' or actor_user_id = '${userId}';
delete from public.transactional_email_outbox where recipient_user_id = '${userId}';
delete from public.private_notifications where recipient_user_id = '${userId}';
alter table public.ses_feedback_events enable trigger ses_feedback_events_protected;
alter table public.notification_delivery_attempts enable trigger notification_delivery_attempts_protected;
alter table public.transactional_email_outbox enable trigger transactional_email_outbox_protected;
alter table public.transactional_email_suppressions enable trigger transactional_email_suppressions_protected;
alter table public.transactional_email_preferences enable trigger transactional_email_preferences_protected;
alter table public.transactional_email_suppression_audit enable trigger transactional_email_suppression_audit_protected;
alter table public.transactional_email_preference_audit enable trigger transactional_email_preference_audit_protected;
alter table public.private_notifications enable trigger private_notifications_protected;
commit;
`);
    } catch { cleanupErrors.push("notification fixtures"); }
    debugCleanup("fixture role");
    try { runSql(`delete from public.community_roles where user_id = '${userId}';`); } catch { cleanupErrors.push("fixture role"); }
    debugCleanup("fixture profile");
    try { runSql(`delete from public.profiles where id = '${userId}';`); } catch { cleanupErrors.push("fixture profile"); }
    debugCleanup("fixture Auth user");
    await cleanup("fixture Auth user", () => service.auth.admin.deleteUser(userId));
  }
  debugCleanup("function runner");
  child.kill("SIGINT");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Local function test runner did not terminate")), 3000)),
    ]);
  }
  if (cleanupErrors.length) throw new Error(`Private-media cleanup failed for: ${cleanupErrors.join(", ")}`);
  debugCleanup("complete");
}

// Supabase's local function runner can leave inherited handles after a clean
// signal-driven shutdown. All assertions and bounded cleanup are complete here.
process.exit(0);
