import { describe, expect, it } from "vitest";
import { isPrivateNetworkAddress, parseEnvelope, parseSesFeedback, signingString, validatedCertificateUrl, validatedSubscriptionConfirmationUrl, verifySignature } from "./sns";

const envelope = {
  Type: "Notification" as const, MessageId: "sns-message", TopicArn: "arn:aws:sns:us-east-1:123456789012:gear-share",
  Message: "payload", Timestamp: "2026-08-14T12:00:00.000Z", SignatureVersion: "2" as const,
  Signature: "pending", SigningCertURL: "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-example.pem",
};

describe("SNS and SES feedback parsing", () => {
  it("verifies the canonical SNS notification string with RSA SHA-256", async () => {
    const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, false, ["sign", "verify"]);
    const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, pair.privateKey, new TextEncoder().encode(signingString(envelope)));
    const signed = { ...envelope, Signature: btoa(String.fromCharCode(...new Uint8Array(signature))) };
    expect(await verifySignature(parseEnvelope(signed), pair.publicKey)).toBe(true);
  });

  it("accepts only bounded confirmation envelopes and rejects unknown fields", () => {
    const token = "t".repeat(40); const topic = envelope.TopicArn;
    expect(parseEnvelope({ ...envelope, Type: "SubscriptionConfirmation", Token: token, SubscribeURL: `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(topic)}&Token=${token}` })).toMatchObject({ Type: "SubscriptionConfirmation", Token: token });
    expect(() => parseEnvelope({ ...envelope, extra: "field" })).toThrow();
  });

  it("pins subscription confirmation to the exact AWS region, topic, token, action, and query", () => {
    const token = "t".repeat(40); const topic = envelope.TopicArn;
    const valid = `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(topic)}&Token=${token}`;
    expect(validatedSubscriptionConfirmationUrl(valid, "us-east-1", topic, token).href).toBe(valid);
    for (const invalid of [valid.replace("us-east-1", "us-west-2"), valid.replace("ConfirmSubscription", "Unsubscribe"), valid.replace(token, "wrong"), `${valid}&Redirect=https://evil.test`, `${valid}&Token=${token}`, valid.replace("https:", "http:")]) expect(() => validatedSubscriptionConfirmationUrl(invalid, "us-east-1", topic, token)).toThrow();
  });

  it("pins certificate URLs and rejects private network results", () => {
    expect(validatedCertificateUrl("https://sns.us-east-1.amazonaws.com/SimpleNotificationService-example.pem", "us-east-1").hostname).toBe("sns.us-east-1.amazonaws.com");
    for (const url of ["http://sns.us-east-1.amazonaws.com/SimpleNotificationService-x.pem", "https://sns.us-east-1.amazonaws.com:444/SimpleNotificationService-x.pem", "https://sns.us-west-2.amazonaws.com/SimpleNotificationService-x.pem", "https://sns.us-east-1.amazonaws.com/other.pem", "https://127.0.0.1/SimpleNotificationService-x.pem"]) expect(() => validatedCertificateUrl(url, "us-east-1")).toThrow();
    expect(isPrivateNetworkAddress("127.0.0.1")).toBe(true);
    expect(isPrivateNetworkAddress("10.1.2.3")).toBe(true);
    expect(isPrivateNetworkAddress("172.20.0.1")).toBe(true);
    expect(isPrivateNetworkAddress("192.168.1.1")).toBe(true);
    expect(isPrivateNetworkAddress("::1")).toBe(true);
    expect(isPrivateNetworkAddress("54.239.28.85")).toBe(false);
  });

  it.each([
    ["Permanent", "permanent_bounce"],
    ["Transient", "transient_bounce"],
  ])("maps one bound %s bounce", (bounceType, expected) => {
    const message = JSON.stringify({
      eventType: "Bounce",
      mail: { messageId: "ses-message", destination: ["member@example.test"], tags: { "ses:configuration-set": ["gear-share"], "ses:source-ip": ["192.0.2.10"], "ses:source-tls-version": ["TLSv1.3"], "ses:from-domain": ["example.test"], "ses:caller-identity": ["gear share-mailer"], "ses:outgoing-ip": ["192.0.2.20"], "ses:outgoing-tls-version": ["TLSv1.3"], delivery_tag: ["00000000-0000-4000-8000-000000000001"] } },
      bounce: { bounceType, bouncedRecipients: [{ emailAddress: "member@example.test" }], timestamp: "2026-08-14T12:00:00Z" },
    });
    expect(parseSesFeedback(message, "gear-share")).toMatchObject({ kind: expected, recipientEmail: "member@example.test", sesMessageId: "ses-message" });
  });

  it("rejects multiple recipients and wrong configuration sets", () => {
    const base = { eventType: "Complaint", mail: { messageId: "ses-message", destination: ["a@example.test", "b@example.test"], tags: { "ses:configuration-set": ["wrong"], delivery_tag: ["00000000-0000-4000-8000-000000000001"] } }, complaint: { complainedRecipients: [{ emailAddress: "a@example.test" }], timestamp: "2026-08-14T12:00:00Z" } };
    expect(() => parseSesFeedback(JSON.stringify(base), "gear-share")).toThrow();
  });

  it("rejects an unreviewed tag even when the required application tag is present", () => {
    const message = { eventType: "Complaint", mail: { messageId: "ses-message", destination: ["member@example.test"], tags: { "ses:configuration-set": ["gear-share"], delivery_tag: ["00000000-0000-4000-8000-000000000001"], arbitrary: ["value"] } }, complaint: { complainedRecipients: [{ emailAddress: "member@example.test" }], timestamp: "2026-08-14T12:00:00Z" } };
    expect(() => parseSesFeedback(JSON.stringify(message), "gear-share")).toThrow("invalid SES tags");
  });
});
