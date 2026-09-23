import { parseEnvelope, parseSesFeedback, signingString, validatedSubscriptionConfirmationUrl } from "./sns.ts";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface FeedbackDependencies {
  env(name: string): string | undefined;
  nowMs(): number;
  allowRequest(): boolean;
  certificateKey(url: string, region: string, signatureVersion: "1" | "2"): Promise<CryptoKey>;
  confirmSubscription(url: URL): Promise<void>;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: any }>;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

async function boundedJson(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json" && contentType !== "text/plain") throw new Error("JSON required");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new Error("request too large");
  const reader = request.body?.getReader(); if (!reader) throw new Error("body required");
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("request too large"); }
    chunks.push(value);
  }
  const body = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(body));
}

export async function handleFeedbackRequest(request: Request, dependencies: FeedbackDependencies) {
  if (request.method !== "POST") return json(405, { error: "method not allowed" });
  if (!dependencies.allowRequest()) return json(429, { error: "feedback rate limit exceeded" });
  try {
    const envelope = parseEnvelope(await boundedJson(request));
    const confirmation = envelope.Type === "SubscriptionConfirmation";
    if (confirmation) {
      if (dependencies.env("GEAR_SHARE_SES_FEEDBACK_CONFIRMATION_ENABLED") !== "true") return json(503, { error: "feedback confirmation disabled" });
    } else if (dependencies.env("GEAR_SHARE_SES_FEEDBACK_ENABLED") !== "true" || dependencies.env("GEAR_SHARE_TRANSACTIONAL_EMAIL_ENABLED") !== "true") return json(503, { error: "feedback receiver disabled" });
    const configuredTopic = dependencies.env("GEAR_SHARE_SES_FEEDBACK_TOPIC_ARN"); const configuredAccount = dependencies.env("GEAR_SHARE_AWS_ACCOUNT_ID");
    const region = dependencies.env("AWS_SES_REGION"); const configurationSet = dependencies.env("AWS_SES_CONFIGURATION_SET");
    if (![configuredTopic, configuredAccount, region, configurationSet].every(Boolean)) return json(503, { error: "feedback receiver configuration unavailable" });
    const topicParts = envelope.TopicArn.split(":");
    if (envelope.TopicArn !== configuredTopic || topicParts.length !== 6 || topicParts[0] !== "arn" || topicParts[2] !== "sns" || topicParts[3] !== region || topicParts[4] !== configuredAccount) return json(400, { error: "invalid feedback notification" });
    const timestamp = Date.parse(envelope.Timestamp);
    if (!Number.isFinite(timestamp) || Math.abs(dependencies.nowMs() - timestamp) > MAX_CLOCK_SKEW_MS) return json(400, { error: "invalid feedback notification" });
    const key = await dependencies.certificateKey(envelope.SigningCertURL, region!, envelope.SignatureVersion);
    let signature: Uint8Array;
    try { signature = Uint8Array.from(atob(envelope.Signature), (character) => character.charCodeAt(0)); } catch { return json(400, { error: "invalid feedback notification" }); }
    if (!await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signature, new TextEncoder().encode(signingString(envelope)))) return json(400, { error: "invalid feedback notification" });
    if (confirmation) {
      await dependencies.confirmSubscription(validatedSubscriptionConfirmationUrl(envelope.SubscribeURL, region!, envelope.TopicArn, envelope.Token));
      return json(200, { status: "confirmed" });
    }
    const feedback = parseSesFeedback(envelope.Message, configurationSet!);
    const occurred = Date.parse(feedback.occurredAt);
    if (!Number.isFinite(occurred) || Math.abs(dependencies.nowMs() - occurred) > MAX_CLOCK_SKEW_MS) return json(400, { error: "invalid feedback notification" });
    const { data, error } = await dependencies.rpc("apply_verified_ses_feedback", { supplied_topic_arn: envelope.TopicArn, supplied_sns_message_id: envelope.MessageId, supplied_feedback_kind: feedback.kind, supplied_ses_message_id: feedback.sesMessageId, supplied_recipient_email: feedback.recipientEmail, supplied_delivery_tag: feedback.deliveryTag, supplied_occurred_at: feedback.occurredAt });
    if (error) return json(500, { error: "feedback persistence failed" });
    return json(200, { status: data });
  } catch { return json(400, { error: "invalid feedback notification" }); }
}
