export const EXACT_FUNCTION_FILES = {
  "sanitize-gear-image": ["index.ts"],
  "draft-gear-listing": ["handler.test.ts", "handler.ts", "image-core.ts", "image-header.test.ts", "image-header.ts", "image.test.ts", "image.ts", "index.ts", "openai.test.ts", "openai.ts", "safety.test.ts", "safety.ts"],
  "deliver-transactional-notifications": ["handler.test.ts", "handler.ts", "index.ts", "ses.test.ts", "ses.ts"],
  "receive-ses-feedback": ["certificate.test.ts", "certificate.ts", "handler.test.ts", "handler.ts", "index.ts", "sns.test.ts", "sns.ts"],
  "invite-preapproved-member": ["handler.test.ts", "handler.ts", "index.ts"],
  "delete-deactivated-member": ["handler.test.ts", "handler.ts", "index.ts"],
};

const RULES = {
  "draft-gear-listing": {
    forbidden: ["ai.gateway.lovable.dev", "LOVABLE_API_KEY", "detail: \"auto\"", "detail: \"high\"", "detail: \"original\"", "store: true", "console.log", "console.error", "draft-item-from-image", "String.fromCharCode(...safe)"],
    required: ["https://api.openai.com", "/v1/responses", "gpt-5.6-luna", "OPENAI_STANDARD_SERVICE_TIER = \"default\";", "store: false", "tools: []", "detail: \"low\"", "x-gear-share-image-count", "MIN_SAFETY_SECRET_LENGTH = 32;", "MAX_BODY_BYTES = 8 * 1024 * 1024;", "MAX_AI_IMAGE_BYTES = 512 * 1024;", "MAX_AI_IMAGE_EDGE = 1024;", "MAX_AI_IMAGE_PIXELS = 1_048_576;", "PROVIDER_TIMEOUT_MS = 20_000;", "MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;", "MAX_REPORTED_INPUT_TOKENS = 100_000;", "MAX_REPORTED_OUTPUT_TOKENS = 2_400;", "OPENAI_SAFETY_IDENTIFIER_SECRET", "buildOpenAiActivationBody", "authorize_ai_activation_check", "record_ai_activation_check", "parseOpenAiUsage", "reserve_ai_drafting_attempt", "mark_ai_drafting_provider_started", "complete_ai_drafting_attempt"],
  },
  "deliver-transactional-notifications": {
    forbidden: ["Resend", "smtp", "SendRawEmail", "BulkEmail", "ReplyToAddresses", "GEAR_SHARE_SES_ENDPOINT"],
    required: ["MAX_BATCH = 25;", "MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024;", "GEAR_SHARE_TRANSACTIONAL_EMAIL_ENABLED", "GEAR_SHARE_SES_FEEDBACK_ENABLED", "GEAR_SHARE_NOTIFICATION_WORKER_TOKEN", "claim_transactional_notifications", "complete_transactional_notification_delivery", "isSesEmailAddress", "permanent_address", "PROVIDER_TIMEOUT_MS = 8_000;"],
  },
  "receive-ses-feedback": {
    forbidden: ["access-control-allow-origin", "console.log", "console.error"],
    required: ["MAX_BODY_BYTES = 256 * 1024;", "MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;", "CERT_TIMEOUT_MS = 2_000;", "DNS_TIMEOUT_MS = 2_000;", "CONFIRMATION_TIMEOUT_MS = 2_000;", "MAX_CERT_CACHE = 8;", "MAX_REQUESTS_PER_MINUTE = 120;", "npm:@peculiar/x509@1.12.3", "GEAR_SHARE_SES_FEEDBACK_ENABLED", "GEAR_SHARE_TRANSACTIONAL_EMAIL_ENABLED", "GEAR_SHARE_SES_FEEDBACK_CONFIRMATION_ENABLED", "validatedSubscriptionConfirmationUrl", "apply_verified_ses_feedback", "ses:source-tls-version", "ses:outgoing-tls-version", "redirect: \"error\"", "Deno.resolveDns"],
  },
  "invite-preapproved-member": {
    forbidden: ["createUser(", "email_confirm", "generateLink", "signedSesInvitationRequest", "AWS_SES_", "INVITATION_LOGO_BASE64", "console.log", "console.error"],
    required: ["MAX_BODY_BYTES = 4 * 1024;", "PROVIDER_TIMEOUT_MS = 8_000;", "GEAR_SHARE_APP_ORIGIN", "reserve_preapproved_member_invitation", "authorize_preapproved_member_invitation_resend", "fail_preapproved_member_invitation", "inviteUserByEmail"],
  },
  "delete-deactivated-member": {
    forbidden: ["console.log", "console.error", "deleteUser(userId, false)", "deleteUser(userId)"],
    required: ["MAX_BODY_BYTES = 1024;", "PROVIDER_TIMEOUT_MS = 8_000;", "GEAR_SHARE_APP_ORIGIN", "reserve_deactivated_member_deletion", "finalize_deactivated_member_deletion", "updateUserById", "deleteUser(memberId, true)", "userIsDeleted"],
  },
};

export function validateFunctionInventory(name, files) {
  const actual = [...files].sort(); const expected = [...(EXACT_FUNCTION_FILES[name] ?? [])].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name} source inventory changed: ${actual.join(", ")}`);
}

export function validateFunctionRuntimeSource(name, source) {
  const rule = RULES[name]; if (!rule) return;
  for (const forbidden of rule.forbidden) if (source.includes(forbidden)) throw new Error(`${name} contains forbidden provider surface: ${forbidden}`);
  for (const required of rule.required) if (!source.includes(required)) throw new Error(`${name} is missing bounded control: ${required}`);
}
