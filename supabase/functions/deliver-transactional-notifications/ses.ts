const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmac(key: ArrayBuffer | Uint8Array, value: string) {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, encoder.encode(value));
}

export interface SesMessage {
  recipient: string;
  subject: string;
  body: string;
  appRoute: string;
  deliveryTag: string;
}

type SesSigningInput = {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  now: Date;
};

export function isSesEmailAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 3 || value.length > 254 || value !== value.trim() || !/^[\x21-\x7e]+$/.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (local.length < 1 || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (domain.length < 1 || domain.length > 253 || !domain.includes(".")) return false;
  return domain.split(".").every((label) => label.length >= 1 && label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function brandedHtml(subject: string, body: string, appUrl: string, logoUrl: string, communityName: string) {
  const safeCommunityName = escapeHtml(communityName);
  return `<!doctype html><html><body style="margin:0;background:#f5f2e9;color:#11283a;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f2e9;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d7d5cc;border-radius:12px;overflow:hidden"><tr><td bgcolor="#075b38" style="background:#075b38;padding:20px 24px;color:#ffffff"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#075b38" style="background:#075b38;padding-right:14px"><img src="${escapeHtml(logoUrl)}" width="52" height="52" alt="${safeCommunityName}" style="display:block;width:52px;height:52px;object-fit:contain;background:#075b38;background-color:#075b38;border:0"></td><td><strong style="font-size:20px;line-height:1.2">${safeCommunityName}</strong><br><span style="font-size:14px;color:#dcebe3">Gear Share</span></td></tr></table></td></tr><tr><td style="padding:28px 24px"><h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;color:#11283a">${escapeHtml(subject)}</h1><p style="margin:0 0 24px;font-size:16px;line-height:1.55;color:#405466">${escapeHtml(body).replaceAll("\n", "<br>")}</p><a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#075b38;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:6px">Open Gear Share</a></td></tr><tr><td style="border-top:1px solid #e3e0d8;padding:16px 24px;font-size:12px;line-height:1.5;color:#667684">You&rsquo;re receiving this because you&rsquo;re a member of the private ${safeCommunityName} Gear Share.</td></tr></table></td></tr></table></body></html>`;
}

async function signSesPayload(input: SesSigningInput, payload: string) {
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(input.region)) throw new Error("invalid SES region");
  const host = `email.${input.region}.amazonaws.com`;
  const endpoint = `https://${host}/v2/email/outbound-emails`;
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = await sha256(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (input.sessionToken) headers["x-amz-security-token"] = input.sessionToken;
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = ["POST", "/v2/email/outbound-emails", "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${input.region}/ses/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(canonicalRequest)].join("\n");
  const dateKey = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), date);
  const regionKey = await hmac(dateKey, input.region);
  const serviceKey = await hmac(regionKey, "ses");
  const signingKey = await hmac(serviceKey, "aws4_request");
  const signature = hex(await hmac(signingKey, stringToSign));
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { endpoint, payload, headers };
}

export async function signedSesRequest(input: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  sender: string;
  configurationSet: string;
  appOrigin: string;
  communityName?: string;
  logoUrl?: string;
  now: Date;
  message: SesMessage;
}) {
  if (!/^[A-Za-z0-9+=,.@_-]{1,100}$/.test(input.configurationSet)) throw new Error("invalid SES configuration set");
  if (!isSesEmailAddress(input.sender) || !isSesEmailAddress(input.message.recipient) || input.message.subject.length < 1 || input.message.subject.length > 100 || input.message.body.length < 1 || input.message.body.length > 400 || !/^[0-9a-f-]{36}$/i.test(input.message.deliveryTag)) throw new Error("invalid bounded SES message");
  const origin = new URL(input.appOrigin);
  if (origin.origin !== input.appOrigin || origin.protocol !== "https:") throw new Error("invalid app origin");
  if (!/^\/[A-Za-z0-9/_?=&.-]{1,300}$/.test(input.message.appRoute) || input.message.appRoute.startsWith("//")) throw new Error("invalid app route");
  const appUrl = `${input.appOrigin}${input.message.appRoute}`;
  const textBody = `${input.message.body}\n\nOpen in the private Gear Share: ${appUrl}`;
  const communityName = input.communityName?.trim() || "Community";
  const invalidCommunityCharacter = [...communityName].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === "<" || character === ">" || codePoint <= 31 || codePoint === 127;
  });
  if (communityName.length > 80 || invalidCommunityCharacter) throw new Error("invalid community name");
  const logoUrl = input.logoUrl?.trim() || `${input.appOrigin}/favicon.png`;
  const parsedLogoUrl = new URL(logoUrl, input.appOrigin);
  if (parsedLogoUrl.origin !== input.appOrigin || !/^\/[A-Za-z0-9/_?=&.%-]{1,300}$/.test(parsedLogoUrl.pathname)) throw new Error("invalid community logo URL");
  const htmlBody = brandedHtml(input.message.subject, input.message.body, appUrl, parsedLogoUrl.href, communityName);
  const payload = JSON.stringify({
    FromEmailAddress: input.sender,
    Destination: { ToAddresses: [input.message.recipient] },
    Content: { Simple: {
      Subject: { Data: input.message.subject, Charset: "UTF-8" },
      Body: {
        Text: { Data: textBody, Charset: "UTF-8" },
        Html: { Data: htmlBody, Charset: "UTF-8" },
      },
    } },
    ConfigurationSetName: input.configurationSet,
    EmailTags: [{ Name: "delivery_tag", Value: input.message.deliveryTag }],
  });
  return signSesPayload(input, payload);
}
