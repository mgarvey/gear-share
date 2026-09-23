const encoder = new TextEncoder();

export interface SnsNotificationEnvelope {
  Type: "Notification";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  UnsubscribeURL?: string;
}

export interface SnsSubscriptionConfirmationEnvelope {
  Type: "SubscriptionConfirmation";
  MessageId: string;
  Token: string;
  TopicArn: string;
  Message: string;
  SubscribeURL: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
}

export type SnsEnvelope = SnsNotificationEnvelope | SnsSubscriptionConfirmationEnvelope;

function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function parseEnvelope(value: unknown): SnsEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid SNS envelope");
  const row = value as Record<string, unknown>;
  const notification = row.Type === "Notification";
  const confirmation = row.Type === "SubscriptionConfirmation";
  const allowed = notification
    ? ["Type", "MessageId", "TopicArn", "Message", "Timestamp", "SignatureVersion", "Signature", "SigningCertURL", "Subject", "UnsubscribeURL"]
    : ["Type", "MessageId", "Token", "TopicArn", "Message", "SubscribeURL", "Timestamp", "SignatureVersion", "Signature", "SigningCertURL"];
  if ((!notification && !confirmation) || !exactKeys(row, allowed) || !["1", "2"].includes(String(row.SignatureVersion))) throw new Error("invalid SNS notification type");
  for (const key of ["MessageId", "TopicArn", "Message", "Timestamp", "Signature", "SigningCertURL"] as const) {
    if (typeof row[key] !== "string" || row[key].length < 1) throw new Error("invalid SNS envelope");
  }
  if (confirmation && (typeof row.Token !== "string" || row.Token.length < 20 || row.Token.length > 2_000 || typeof row.SubscribeURL !== "string" || row.SubscribeURL.length < 1 || row.SubscribeURL.length > 4_000)) throw new Error("invalid SNS confirmation");
  if (String(row.MessageId).length > 200 || String(row.TopicArn).length > 300 || String(row.Message).length > 250_000 || String(row.Signature).length > 1_000 || String(row.SigningCertURL).length > 500) throw new Error("invalid SNS envelope");
  return row as unknown as SnsEnvelope;
}

export function signingString(envelope: SnsEnvelope) {
  const fields: Array<[string, string | undefined]> = envelope.Type === "SubscriptionConfirmation"
    ? [["Message", envelope.Message], ["MessageId", envelope.MessageId], ["SubscribeURL", envelope.SubscribeURL], ["Timestamp", envelope.Timestamp], ["Token", envelope.Token], ["TopicArn", envelope.TopicArn], ["Type", envelope.Type]]
    : [["Message", envelope.Message], ["MessageId", envelope.MessageId], ["Subject", envelope.Subject], ["Timestamp", envelope.Timestamp], ["TopicArn", envelope.TopicArn], ["Type", envelope.Type]];
  return fields.filter(([, value]) => value !== undefined).map(([name, value]) => `${name}\n${value}\n`).join("");
}

export function validatedSubscriptionConfirmationUrl(rawUrl: string, region: string, topicArn: string, token: string) {
  const url = new URL(rawUrl);
  const keys = [...new Set(url.searchParams.keys())].sort();
  const allowedKeys = ["Action", "Token", "TopicArn", "Version"];
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hostname !== `sns.${region}.amazonaws.com` || url.pathname !== "/" || url.hash
    || keys.some((key) => !allowedKeys.includes(key)) || ![3, 4].includes(keys.length)
    || keys.some((key) => url.searchParams.getAll(key).length !== 1)
    || url.searchParams.get("Action") !== "ConfirmSubscription" || url.searchParams.get("TopicArn") !== topicArn || url.searchParams.get("Token") !== token
    || (url.searchParams.has("Version") && url.searchParams.get("Version") !== "2010-03-31")) throw new Error("invalid subscription confirmation URL");
  return url;
}

export function validatedCertificateUrl(rawUrl: string, region: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hostname !== `sns.${region}.amazonaws.com` || !/^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(url.pathname) || url.search || url.hash) throw new Error("invalid signing certificate URL");
  return url;
}

export function isPrivateNetworkAddress(address: string) {
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|localhost$)/i.test(address)) return true;
  const match = address.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return address === "::1" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd");
}

export async function verifySignature(envelope: SnsEnvelope, publicKey: CryptoKey) {
  let signature: Uint8Array;
  try { signature = Uint8Array.from(atob(envelope.Signature), (character) => character.charCodeAt(0)); } catch { return false; }
  return crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, publicKey, signature, encoder.encode(signingString(envelope)));
}

export interface Feedback {
  kind: "complaint" | "permanent_bounce" | "transient_bounce";
  sesMessageId: string;
  recipientEmail: string;
  deliveryTag: string;
  occurredAt: string;
}

export function parseSesFeedback(message: string, expectedConfigurationSet: string): Feedback {
  const value = JSON.parse(message);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid SES feedback");
  const root = value as Record<string, any>;
  if (!exactKeys(root, ["eventType", "mail", "bounce", "complaint"])) throw new Error("invalid SES feedback");
  if (!root.mail || typeof root.mail !== "object" || Array.isArray(root.mail)) throw new Error("invalid SES mail");
  if (!exactKeys(root.mail, ["timestamp", "source", "sourceArn", "sendingAccountId", "messageId", "destination", "headersTruncated", "headers", "commonHeaders", "tags"])) throw new Error("invalid SES mail");
  if (typeof root.mail.messageId !== "string" || !/^[A-Za-z0-9._:/=-]{1,200}$/.test(root.mail.messageId)) throw new Error("invalid SES message id");
  if (!Array.isArray(root.mail.destination) || root.mail.destination.length !== 1 || typeof root.mail.destination[0] !== "string") throw new Error("one SES recipient required");
  const recipient = root.mail.destination[0].trim().toLowerCase();
  if (recipient.length < 3 || recipient.length > 254 || /[\r\n]/.test(root.mail.destination[0])) throw new Error("bounded SES recipient required");
  const tags = root.mail.tags;
  const allowedTagKeys = [
    "ses:caller-identity",
    "ses:configuration-set",
    "ses:from-domain",
    "ses:outgoing-ip",
    "ses:outgoing-tls-version",
    "ses:source-ip",
    "ses:source-tls-version",
    "delivery_tag",
  ];
  if (!tags || typeof tags !== "object" || Array.isArray(tags) || !exactKeys(tags, allowedTagKeys)) throw new Error("invalid SES tags");
  for (const tag of Object.values(tags) as unknown[]) {
    if (!Array.isArray(tag) || tag.length !== 1 || typeof tag[0] !== "string" || tag[0].length < 1 || tag[0].length > 200 || /[\r\n]/.test(tag[0])) throw new Error("invalid SES tag value");
  }
  if (!Array.isArray(tags["ses:configuration-set"]) || tags["ses:configuration-set"].length !== 1 || tags["ses:configuration-set"][0] !== expectedConfigurationSet) throw new Error("wrong SES configuration set");
  if (!Array.isArray(tags.delivery_tag) || tags.delivery_tag.length !== 1 || !/^[0-9a-f-]{36}$/i.test(tags.delivery_tag[0])) throw new Error("invalid delivery tag");
  if (root.eventType === "Complaint") {
    if (!root.complaint || root.bounce || !exactKeys(root.complaint, ["complainedRecipients", "timestamp", "feedbackId", "complaintSubType", "complaintFeedbackType", "userAgent", "arrivalDate"])) throw new Error("invalid complaint");
    if (!Array.isArray(root.complaint.complainedRecipients) || root.complaint.complainedRecipients.length !== 1 || !exactKeys(root.complaint.complainedRecipients[0], ["emailAddress"]) || root.complaint.complainedRecipients[0]?.emailAddress?.toLowerCase() !== recipient) throw new Error("complaint recipient mismatch");
    return { kind: "complaint", sesMessageId: root.mail.messageId, recipientEmail: recipient, deliveryTag: tags.delivery_tag[0], occurredAt: root.complaint.timestamp };
  }
  if (root.eventType === "Bounce") {
    if (!root.bounce || root.complaint || !exactKeys(root.bounce, ["bounceType", "bounceSubType", "bouncedRecipients", "timestamp", "feedbackId", "remoteMtaIp", "reportingMTA"])) throw new Error("invalid bounce");
    if (!Array.isArray(root.bounce.bouncedRecipients) || root.bounce.bouncedRecipients.length !== 1 || root.bounce.bouncedRecipients[0]?.emailAddress?.toLowerCase() !== recipient) throw new Error("bounce recipient mismatch");
    if (!exactKeys(root.bounce.bouncedRecipients[0], ["emailAddress", "action", "status", "diagnosticCode"])) throw new Error("invalid bounce recipient");
    if (!(["Permanent", "Transient"] as const).includes(root.bounce.bounceType)) throw new Error("invalid bounce type");
    return { kind: root.bounce.bounceType === "Permanent" ? "permanent_bounce" : "transient_bounce", sesMessageId: root.mail.messageId, recipientEmail: recipient, deliveryTag: tags.delivery_tag[0], occurredAt: root.bounce.timestamp };
  }
  throw new Error("unsupported SES feedback");
}
