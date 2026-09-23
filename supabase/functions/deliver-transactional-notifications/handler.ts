import { isSesEmailAddress, signedSesRequest } from "./ses.ts";

const MAX_REQUEST_BYTES = 256;
const MAX_BATCH = 25;
const PROVIDER_TIMEOUT_MS = 8_000;
const MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024;

export interface DeliveryDependencies {
  env(name: string): string | undefined;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: any }>;
  fetcher: typeof fetch;
  now(): Date;
  uuid(): string;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

function secretMatches(actual: string | null, expected: string) {
  if (!actual?.startsWith("Bearer ")) return false;
  const supplied = new TextEncoder().encode(actual.slice(7));
  const configured = new TextEncoder().encode(expected);
  if (supplied.length !== configured.length) return false;
  let mismatch = 0;
  for (let index = 0; index < supplied.length; index += 1) mismatch |= supplied[index] ^ configured[index];
  return mismatch === 0;
}

async function boundedBody(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_REQUEST_BYTES) throw new Error("request too large");
  const reader = request.body?.getReader();
  if (!reader) return MAX_BATCH;
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) { await reader.cancel(); throw new Error("request too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const parsed = bytes.byteLength ? JSON.parse(new TextDecoder().decode(bytes)) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).some((key) => key !== "batchLimit")) throw new Error("invalid request");
  const batchLimit = (parsed as { batchLimit?: unknown }).batchLimit ?? MAX_BATCH;
  if (!Number.isInteger(batchLimit) || Number(batchLimit) < 1 || Number(batchLimit) > MAX_BATCH) throw new Error("invalid batch limit");
  return Number(batchLimit);
}

async function boundedText(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("provider response too large");
  const reader = response.body?.getReader(); if (!reader) return "";
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > MAX_PROVIDER_RESPONSE_BYTES) { await reader.cancel(); throw new Error("provider response too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function handleDeliveryRequest(request: Request, dependencies: DeliveryDependencies) {
  if (request.method !== "POST") return json(405, { error: "method not allowed" });
  if (dependencies.env("GEAR_SHARE_TRANSACTIONAL_EMAIL_ENABLED") !== "true" || dependencies.env("GEAR_SHARE_SES_FEEDBACK_ENABLED") !== "true") return json(503, { error: "transactional delivery disabled" });
  const workerToken = dependencies.env("GEAR_SHARE_NOTIFICATION_WORKER_TOKEN");
  if (!workerToken || workerToken.length < 32 || !secretMatches(request.headers.get("authorization"), workerToken)) return json(401, { error: "authentication required" });
  try {
    const batchLimit = await boundedBody(request);
    const region = dependencies.env("AWS_SES_REGION"); const accessKeyId = dependencies.env("AWS_SES_ACCESS_KEY_ID");
    const secretAccessKey = dependencies.env("AWS_SES_SECRET_ACCESS_KEY"); const sender = dependencies.env("AWS_SES_FROM_ADDRESS");
    const configurationSet = dependencies.env("AWS_SES_CONFIGURATION_SET"); const appOrigin = dependencies.env("GEAR_SHARE_APP_ORIGIN");
    if (![region, accessKeyId, secretAccessKey, sender, configurationSet, appOrigin].every(Boolean)) return json(503, { error: "transactional delivery configuration unavailable" });
    const { data: claimed, error: claimError } = await dependencies.rpc("claim_transactional_notifications", { supplied_worker_id: dependencies.uuid(), batch_limit: batchLimit });
    if (claimError) throw claimError;
    const results: Array<{ outboxId: string; status: string }> = [];
    for (const item of claimed ?? []) {
      let outcome = "ambiguous"; let errorCode: string | null = "network_ambiguous"; let providerMessageId: string | null = null;
      if (!isSesEmailAddress(item.recipient_email)) {
        outcome = "permanent_address";
        errorCode = "address_rejected";
      } else try {
        const signed = await signedSesRequest({
          region: region!, accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!, sessionToken: dependencies.env("AWS_SESSION_TOKEN"), sender: sender!, configurationSet: configurationSet!, appOrigin: appOrigin!, communityName: dependencies.env("GEAR_SHARE_COMMUNITY_NAME"), logoUrl: dependencies.env("GEAR_SHARE_LOGO_URL"), now: dependencies.now(),
          message: { recipient: item.recipient_email, subject: item.email_subject, body: item.email_body, appRoute: item.app_route, deliveryTag: item.delivery_tag },
        });
        const requestHeaders = { ...signed.headers }; delete requestHeaders.host;
        const response = await dependencies.fetcher(signed.endpoint, { method: "POST", headers: requestHeaders, body: signed.payload, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS), redirect: "error" });
        const responseBody = await boundedText(response);
        if (response.ok) {
          const parsed = JSON.parse(responseBody);
          if (typeof parsed?.MessageId === "string" && /^[A-Za-z0-9._:/=-]{1,200}$/.test(parsed.MessageId)) { outcome = "delivered"; errorCode = null; providerMessageId = parsed.MessageId; }
          else { outcome = "ambiguous"; errorCode = "invalid_provider_response"; }
        } else if (response.status === 429 || response.status >= 500) { outcome = "retryable"; errorCode = response.status === 429 ? "throttled" : "provider_5xx"; }
        else { outcome = "permanent"; errorCode = "provider_4xx"; }
      } catch { outcome = "ambiguous"; errorCode = "network_ambiguous"; }
      const { data: status, error: completionError } = await dependencies.rpc("complete_transactional_notification_delivery", { target_outbox_id: item.outbox_id, supplied_claim_token: item.claim_token, supplied_outcome: outcome, supplied_provider_message_id: providerMessageId, supplied_error_code: errorCode });
      if (completionError) throw completionError;
      results.push({ outboxId: item.outbox_id, status });
    }
    return json(200, { processed: results.length, results });
  } catch { return json(500, { error: "transactional delivery failed" }); }
}
