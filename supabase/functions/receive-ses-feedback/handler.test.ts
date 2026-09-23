import { describe, expect, it, vi } from "vitest";
import { handleFeedbackRequest, type FeedbackDependencies } from "./handler";
import { signingString } from "./sns";

const now = Date.parse("2026-08-14T12:00:00Z");
const values: Record<string, string> = { GEAR_SHARE_SES_FEEDBACK_ENABLED: "true", GEAR_SHARE_TRANSACTIONAL_EMAIL_ENABLED: "true", GEAR_SHARE_SES_FEEDBACK_CONFIRMATION_ENABLED: "false", GEAR_SHARE_SES_FEEDBACK_TOPIC_ARN: "arn:aws:sns:us-east-1:123456789012:gear-share", GEAR_SHARE_AWS_ACCOUNT_ID: "123456789012", AWS_SES_REGION: "us-east-1", AWS_SES_CONFIGURATION_SET: "gear-share" };

async function signedRequest(pair: CryptoKeyPair, changes: Record<string, unknown> = {}) {
  const feedback = { eventType: "Complaint", mail: { messageId: "ses-message", destination: ["member@example.test"], tags: { "ses:configuration-set": ["gear-share"], "ses:source-ip": ["192.0.2.10"], "ses:source-tls-version": ["TLSv1.3"], "ses:from-domain": ["example.test"], "ses:caller-identity": ["gear share-mailer"], "ses:outgoing-ip": ["192.0.2.20"], "ses:outgoing-tls-version": ["TLSv1.3"], delivery_tag: ["00000000-0000-4000-8000-000000000001"] } }, complaint: { complainedRecipients: [{ emailAddress: "member@example.test" }], timestamp: "2026-08-14T12:00:00Z", feedbackId: "feedback" } };
  const envelope = { Type: "Notification", MessageId: "sns-message", TopicArn: values.GEAR_SHARE_SES_FEEDBACK_TOPIC_ARN, Message: JSON.stringify(feedback), Timestamp: "2026-08-14T12:00:00Z", SignatureVersion: "2", Signature: "pending", SigningCertURL: "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-example.pem", ...changes };
  const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, pair.privateKey, new TextEncoder().encode(signingString(envelope as any)));
  envelope.Signature = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return new Request("https://gear.example.test/functions/v1/receive-ses-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope) });
}

describe("SES feedback handler", () => {
  it("authenticates and binds a provider-real configuration-set complaint before the RPC", async () => {
    const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, false, ["sign", "verify"]);
    const rpc = vi.fn().mockResolvedValue({ data: "processed", error: null });
    const certificateKey = vi.fn().mockResolvedValue(pair.publicKey);
    const deps: FeedbackDependencies = { env: (name) => values[name], nowMs: () => now, allowRequest: () => true, certificateKey, confirmSubscription: vi.fn(), rpc };
    const response = await handleFeedbackRequest(await signedRequest(pair), deps);
    expect(response.status).toBe(200);
    expect(certificateKey).toHaveBeenCalledWith("https://sns.us-east-1.amazonaws.com/SimpleNotificationService-example.pem", "us-east-1", "2");
    expect(rpc).toHaveBeenCalledWith("apply_verified_ses_feedback", { supplied_topic_arn: values.GEAR_SHARE_SES_FEEDBACK_TOPIC_ARN, supplied_sns_message_id: "sns-message", supplied_feedback_kind: "complaint", supplied_ses_message_id: "ses-message", supplied_recipient_email: "member@example.test", supplied_delivery_tag: "00000000-0000-4000-8000-000000000001", supplied_occurred_at: "2026-08-14T12:00:00Z" });
  });

  it("keeps the paired safe-off gate before request parsing and RPC", async () => {
    const rpc = vi.fn(); const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, false, ["sign", "verify"]);
    const response = await handleFeedbackRequest(await signedRequest(pair), { env: (name) => name === "GEAR_SHARE_TRANSACTIONAL_EMAIL_ENABLED" ? "false" : values[name], nowMs: () => now, allowRequest: () => true, certificateKey: vi.fn(), confirmSubscription: vi.fn(), rpc });
    expect(response.status).toBe(503); expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects wrong topic, stale time, invalid signature, oversize bodies, and rate exhaustion before RPC", async () => {
    const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, false, ["sign", "verify"]);
    const rpc = vi.fn(); const base = { env: (name: string) => values[name], nowMs: () => now, allowRequest: () => true, certificateKey: async () => pair.publicKey, confirmSubscription: vi.fn(), rpc };
    expect((await handleFeedbackRequest(await signedRequest(pair, { TopicArn: "arn:aws:sns:us-east-1:999999999999:wrong" }), base)).status).toBe(400);
    expect((await handleFeedbackRequest(await signedRequest(pair, { Timestamp: "2026-08-14T11:00:00Z" }), base)).status).toBe(400);
    const invalid = await signedRequest(pair); const body = await invalid.json() as any; body.Signature = btoa("wrong");
    expect((await handleFeedbackRequest(new Request(invalid.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), base)).status).toBe(400);
    expect((await handleFeedbackRequest(new Request("https://local.test", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(256 * 1024 + 1) }), base)).status).toBe(400);
    expect((await handleFeedbackRequest(await signedRequest(pair), { ...base, allowRequest: () => false })).status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 5xx for a valid signed event whose database commit fails", async () => {
    const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, false, ["sign", "verify"]);
    const response = await handleFeedbackRequest(await signedRequest(pair), { env: (name) => values[name], nowMs: () => now, allowRequest: () => true, certificateKey: async () => pair.publicKey, confirmSubscription: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: new Error("database unavailable") }) });
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "feedback persistence failed" });
  });

  it("confirms only a current signed message from the exact configured topic while setup mode is enabled", async () => {
    const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, false, ["sign", "verify"]);
    const token = "t".repeat(40);
    const confirmation = { Type: "SubscriptionConfirmation", MessageId: "confirmation-message", Token: token, TopicArn: values.GEAR_SHARE_SES_FEEDBACK_TOPIC_ARN, Message: "Confirm the exact Gear Share feedback topic.", SubscribeURL: `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(values.GEAR_SHARE_SES_FEEDBACK_TOPIC_ARN)}&Token=${token}`, Timestamp: "2026-08-14T12:00:00Z", SignatureVersion: "2", Signature: "pending", SigningCertURL: "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-example.pem" };
    const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, pair.privateKey, new TextEncoder().encode(signingString(confirmation as any)));
    confirmation.Signature = btoa(String.fromCharCode(...new Uint8Array(signature)));
    const confirmSubscription = vi.fn().mockResolvedValue(undefined); const rpc = vi.fn();
    const response = await handleFeedbackRequest(new Request("https://local.test", { method: "POST", headers: { "content-type": "text/plain; charset=UTF-8" }, body: JSON.stringify(confirmation) }), { env: (name) => name === "GEAR_SHARE_SES_FEEDBACK_CONFIRMATION_ENABLED" ? "true" : name === "GEAR_SHARE_SES_FEEDBACK_ENABLED" || name === "GEAR_SHARE_TRANSACTIONAL_EMAIL_ENABLED" ? "false" : values[name], nowMs: () => now, allowRequest: () => true, certificateKey: async () => pair.publicKey, confirmSubscription, rpc });
    expect(response.status).toBe(200);
    expect(confirmSubscription).toHaveBeenCalledWith(new URL(confirmation.SubscribeURL));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not confirm subscriptions outside explicit setup mode", async () => {
    const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, false, ["sign", "verify"]);
    const confirmSubscription = vi.fn(); const rpc = vi.fn();
    const response = await handleFeedbackRequest(await signedRequest(pair, { Type: "SubscriptionConfirmation", Token: "t".repeat(40), SubscribeURL: `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(values.GEAR_SHARE_SES_FEEDBACK_TOPIC_ARN)}&Token=${"t".repeat(40)}` }), { env: (name) => values[name], nowMs: () => now, allowRequest: () => true, certificateKey: async () => pair.publicKey, confirmSubscription, rpc });
    expect(response.status).toBe(503); expect(confirmSubscription).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
});
