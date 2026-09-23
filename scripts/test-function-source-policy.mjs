import assert from "node:assert/strict";
import { EXACT_FUNCTION_FILES, validateFunctionInventory, validateFunctionRuntimeSource } from "./function-source-policy.mjs";
import { FINAL_FUNCTIONS, validateHostedFunctionInventory } from "./function-policy.mjs";

assert.doesNotThrow(() => validateHostedFunctionInventory(FINAL_FUNCTIONS));
assert.doesNotThrow(() => validateHostedFunctionInventory(["sanitize-gear-image", "invite-preapproved-member", "delete-deactivated-member"]));
assert.throws(() => validateHostedFunctionInventory(["sanitize-gear-image", "deliver-transactional-notifications"]), /partial SES pair/);
assert.throws(() => validateHostedFunctionInventory([...FINAL_FUNCTIONS, "unknown-function"]), /unknown/);

for (const [name, files] of Object.entries(EXACT_FUNCTION_FILES)) validateFunctionInventory(name, files);
assert.throws(() => validateFunctionInventory("draft-gear-listing", [...EXACT_FUNCTION_FILES["draft-gear-listing"], "retry.ts"]), /source inventory changed/);
assert.throws(() => validateFunctionInventory("deliver-transactional-notifications", [...EXACT_FUNCTION_FILES["deliver-transactional-notifications"], "unreviewed.ts"]), /source inventory changed/);
assert.throws(() => validateFunctionInventory("receive-ses-feedback", EXACT_FUNCTION_FILES["receive-ses-feedback"].filter((name) => name !== "sns.ts")), /source inventory changed/);
assert.throws(() => validateFunctionInventory("invite-preapproved-member", [...EXACT_FUNCTION_FILES["invite-preapproved-member"], "redirect.ts"]), /source inventory changed/);
assert.throws(() => validateFunctionInventory("delete-deactivated-member", [...EXACT_FUNCTION_FILES["delete-deactivated-member"], "cleanup.ts"]), /source inventory changed/);

const deliveryRequired = ["MAX_BATCH = 25;", "MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024;", "GEAR_SHARE_TRANSACTIONAL_EMAIL_ENABLED", "GEAR_SHARE_SES_FEEDBACK_ENABLED", "GEAR_SHARE_NOTIFICATION_WORKER_TOKEN", "claim_transactional_notifications", "complete_transactional_notification_delivery", "isSesEmailAddress", "permanent_address", "PROVIDER_TIMEOUT_MS = 8_000;"].join("\n");
validateFunctionRuntimeSource("deliver-transactional-notifications", deliveryRequired);
assert.throws(() => validateFunctionRuntimeSource("deliver-transactional-notifications", `${deliveryRequired}\nResend`), /forbidden provider surface/);
assert.throws(() => validateFunctionRuntimeSource("deliver-transactional-notifications", deliveryRequired.replace("MAX_BATCH = 25;", "MAX_BATCH = 250;")), /missing bounded control/);

const feedbackRequired = ["MAX_BODY_BYTES = 256 * 1024;", "MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;", "CERT_TIMEOUT_MS = 2_000;", "DNS_TIMEOUT_MS = 2_000;", "CONFIRMATION_TIMEOUT_MS = 2_000;", "MAX_CERT_CACHE = 8;", "MAX_REQUESTS_PER_MINUTE = 120;", "npm:@peculiar/x509@1.12.3", "GEAR_SHARE_SES_FEEDBACK_ENABLED", "GEAR_SHARE_TRANSACTIONAL_EMAIL_ENABLED", "GEAR_SHARE_SES_FEEDBACK_CONFIRMATION_ENABLED", "validatedSubscriptionConfirmationUrl", "apply_verified_ses_feedback", "ses:source-tls-version", "ses:outgoing-tls-version", "redirect: \"error\"", "Deno.resolveDns"].join("\n");
validateFunctionRuntimeSource("receive-ses-feedback", feedbackRequired);
assert.throws(() => validateFunctionRuntimeSource("receive-ses-feedback", feedbackRequired.replace("validatedSubscriptionConfirmationUrl", "new URL")), /missing bounded control/);
assert.throws(() => validateFunctionRuntimeSource("receive-ses-feedback", feedbackRequired.replace("Deno.resolveDns", "fetch")), /missing bounded control/);

const draftRequired = ["https://api.openai.com", "/v1/responses", "gpt-5.6-luna", "OPENAI_STANDARD_SERVICE_TIER = \"default\";", "store: false", "tools: []", "detail: \"low\"", "x-gear-share-image-count", "MIN_SAFETY_SECRET_LENGTH = 32;", "MAX_BODY_BYTES = 8 * 1024 * 1024;", "MAX_AI_IMAGE_BYTES = 512 * 1024;", "MAX_AI_IMAGE_EDGE = 1024;", "MAX_AI_IMAGE_PIXELS = 1_048_576;", "PROVIDER_TIMEOUT_MS = 20_000;", "MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;", "MAX_REPORTED_INPUT_TOKENS = 100_000;", "MAX_REPORTED_OUTPUT_TOKENS = 2_400;", "OPENAI_SAFETY_IDENTIFIER_SECRET", "buildOpenAiActivationBody", "authorize_ai_activation_check", "record_ai_activation_check", "parseOpenAiUsage", "reserve_ai_drafting_attempt", "mark_ai_drafting_provider_started", "complete_ai_drafting_attempt"].join("\n");
validateFunctionRuntimeSource("draft-gear-listing", draftRequired);
for (const unsafe of ["ai.gateway.lovable.dev", "LOVABLE_API_KEY", "detail: \"auto\"", "store: true", "console.log", "String.fromCharCode(...safe)"]) assert.throws(() => validateFunctionRuntimeSource("draft-gear-listing", `${draftRequired}\n${unsafe}`), /forbidden provider surface/);

const invitationRequired = ["MAX_BODY_BYTES = 4 * 1024;", "PROVIDER_TIMEOUT_MS = 8_000;", "GEAR_SHARE_APP_ORIGIN", "reserve_preapproved_member_invitation", "authorize_preapproved_member_invitation_resend", "fail_preapproved_member_invitation", "inviteUserByEmail"].join("\n");
validateFunctionRuntimeSource("invite-preapproved-member", invitationRequired);
assert.throws(() => validateFunctionRuntimeSource("invite-preapproved-member", invitationRequired.replace("MAX_BODY_BYTES = 4 * 1024;", "MAX_BODY_BYTES = 4 * 1024 * 1024;")), /missing bounded control/);
assert.throws(() => validateFunctionRuntimeSource("invite-preapproved-member", `${invitationRequired}\ncreateUser(`), /forbidden provider surface/);
assert.throws(() => validateFunctionRuntimeSource("invite-preapproved-member", `${invitationRequired}\ngenerateLink`), /forbidden provider surface/);

const deletionRequired = ["MAX_BODY_BYTES = 1024;", "PROVIDER_TIMEOUT_MS = 8_000;", "GEAR_SHARE_APP_ORIGIN", "reserve_deactivated_member_deletion", "finalize_deactivated_member_deletion", "updateUserById", "deleteUser(memberId, true)", "userIsDeleted"].join("\n");
validateFunctionRuntimeSource("delete-deactivated-member", deletionRequired);
assert.throws(() => validateFunctionRuntimeSource("delete-deactivated-member", deletionRequired.replace("MAX_BODY_BYTES = 1024;", "MAX_BODY_BYTES = 1024 * 1024;")), /missing bounded control/);
assert.throws(() => validateFunctionRuntimeSource("delete-deactivated-member", `${deletionRequired}\nconsole.error`), /forbidden provider surface/);
assert.throws(() => validateFunctionRuntimeSource("delete-deactivated-member", `${deletionRequired}\ndeleteUser(userId)`), /forbidden provider surface/);

process.stdout.write("Gear Share function source-policy negative fixtures OK.\n");
