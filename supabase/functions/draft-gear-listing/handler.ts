import { decodeBase64Jpeg } from "./image-header.ts";
import {
  buildOpenAiBody,
  buildOpenAiActivationBody,
  FIXED_MODEL,
  FIXED_SERVICE_TIER,
  OPENAI_ORIGIN,
  OPENAI_PATH,
  parseOpenAiResponse,
  parseOpenAiUsage,
  PROVIDER_TIMEOUT_MS,
  readBoundedResponse,
  type RecognizedOpenAiUsage,
} from "./openai.ts";

export const MAX_BODY_BYTES = 8 * 1024 * 1024;
const AUTH_TIMEOUT_MS = 3_000;
const MIN_API_KEY_LENGTH = 20;
const MIN_SAFETY_SECRET_LENGTH = 32;

export type DraftDependencies = {
  env(name: string): string | undefined;
  authenticate(token: string): Promise<string | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: any }>;
  fetcher: typeof fetch;
  sanitize(bytes: Uint8Array): Promise<Uint8Array>;
  hmac(secret: string, value: string): Promise<string>;
};

function json(status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string,string> = {}) { return new Response(JSON.stringify({ code, ...extra }), { status, headers: { ...headers, "content-type": "application/json", "cache-control": "no-store" } }); }
function originHeaders(request: Request, configured?: string) { const origin = request.headers.get("origin"); if (!origin) return {}; if (!configured || origin !== configured || new URL(configured).origin !== configured) return null; return { "access-control-allow-origin": configured, vary: "Origin" }; }
function abortError() { return new DOMException("timed out", "AbortError"); }
async function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError();
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => { signal.removeEventListener("abort", abort); resolve(value); }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), milliseconds);
  try { return await withSignal(promise, controller.signal); } finally { clearTimeout(timeout); }
}
async function boundedJson(request: Request, signal: AbortSignal) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY_BYTES) throw new Error("input");
  const reader = request.body?.getReader(); if (!reader) throw new Error("input");
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) { const { value, done } = await withSignal(reader.read(), signal); if (done) break; total += value.byteLength; if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("input"); } chunks.push(value); }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function bodyImages(body: any, mode: string, count: number, imageCount: number) {
  if (!body || Object.keys(body).sort().join(",") !== "candidates,detail" || body.detail !== "low" || !Array.isArray(body.candidates) || body.candidates.length !== count) throw new Error("input");
  const decoded = body.candidates.map((candidate: any) => {
    if (!candidate || Object.keys(candidate).join(",") !== "images" || !Array.isArray(candidate.images)) throw new Error("input");
    if (mode === "bulk" && candidate.images.length !== 1) throw new Error("input");
    if (mode === "single" && (candidate.images.length < 1 || candidate.images.length > 4)) throw new Error("input");
    return candidate.images.map(decodeBase64Jpeg);
  });
  if (decoded.reduce((total: number, images: Uint8Array[]) => total + images.length, 0) !== imageCount) throw new Error("input");
  return decoded;
}
export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function equalSecrets(first: string, second: string) {
  const length = Math.max(first.length, second.length); let difference = first.length ^ second.length;
  for (let index = 0; index < length; index += 1) difference |= (first.charCodeAt(index) || 0) ^ (second.charCodeAt(index) || 0);
  return difference === 0;
}
function providerErrorDetails(value: any) {
  const bounded = (candidate: unknown) => typeof candidate === "string" && /^[A-Za-z0-9_.\[\]-]{1,160}$/.test(candidate) ? candidate : undefined;
  return {
    providerCode: bounded(value?.error?.code) ?? bounded(value?.error?.type),
    providerParam: bounded(value?.error?.param),
  };
}
function completionArgs(requestId: string, status: "completed" | "failed" | "unknown_usage", failure: string | null, usage: RecognizedOpenAiUsage | null, providerId: string | null) {
  return {
    supplied_attempt_id: requestId,
    supplied_status: status,
    supplied_input_tokens: usage?.inputTokens ?? null,
    supplied_cached_input_tokens: usage?.cachedInputTokens ?? null,
    supplied_output_tokens: usage?.outputTokens ?? null,
    supplied_reasoning_output_tokens: usage?.reasoningOutputTokens ?? null,
    supplied_failure_kind: failure,
    supplied_provider_response_id: providerId,
  };
}
async function completeAttempt(deps: DraftDependencies, args: ReturnType<typeof completionArgs>) {
  let completion = await deps.rpc("complete_ai_drafting_attempt", args);
  if (completion.error) completion = await deps.rpc("complete_ai_drafting_attempt", args);
  return completion;
}

export async function handleDraftRequest(request: Request, deps: DraftDependencies) {
  let cors: Record<string,string> | null; try { cors = originHeaders(request, deps.env("GEAR_SHARE_APP_ORIGIN")); } catch { cors = null; }
  if (cors === null) return json(403, "origin", {}, {});
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-gear-share-request-id, x-gear-share-draft-mode, x-gear-share-draft-count, x-gear-share-image-count", "access-control-max-age": "600" } });
  if (request.method !== "POST") return json(405, "method", {}, cors);
  const authorization = request.headers.get("authorization"); if (!authorization?.startsWith("Bearer ")) return json(401, "authentication", {}, cors);
  let userId: string | null;
  try { userId = await withTimeout(deps.authenticate(authorization.slice(7)), AUTH_TIMEOUT_MS); } catch { return json(503, "authentication", {}, cors); }
  if (!userId) return json(401, "authentication", {}, cors);
  const requestId = request.headers.get("x-gear-share-request-id") ?? "";
  const mode = request.headers.get("x-gear-share-draft-mode") ?? "";
  const count = Number(request.headers.get("x-gear-share-draft-count"));
  const imageCount = Number(request.headers.get("x-gear-share-image-count"));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    || !["single","bulk","activation"].includes(mode) || !Number.isInteger(count) || !Number.isInteger(imageCount)
    || count < 1 || count > (mode === "bulk" ? 10 : 1)
    || imageCount < 1 || imageCount > (mode === "single" ? 4 : mode === "bulk" ? 10 : 1)
    || (mode === "activation" && (count !== 1 || imageCount !== 1))
    || (mode === "bulk" && imageCount !== count)) return json(400, "input", {}, cors);
  const key = deps.env("OPENAI_API_KEY") ?? "";
  const safetySecret = deps.env("OPENAI_SAFETY_IDENTIFIER_SECRET") ?? "";
  const secretsValid = key.length >= MIN_API_KEY_LENGTH && safetySecret.length >= MIN_SAFETY_SECRET_LENGTH && !equalSecrets(key, safetySecret);
  if (mode === "activation" && !secretsValid) {
    return json(200, "configuration", {}, cors);
  }

  if (mode === "activation") {
    const authorized = await deps.rpc("authorize_ai_activation_check", { target_user_id: userId });
    if (authorized.error || authorized.data?.[0]?.model !== FIXED_MODEL || authorized.data?.[0]?.service_tier !== FIXED_SERVICE_TIER) {
      return json(200, "authorization", {}, cors);
    }
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const safetyIdentifier = await withSignal(deps.hmac(safetySecret, userId), controller.signal);
      const response = await deps.fetcher(`${OPENAI_ORIGIN}${OPENAI_PATH}`, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(buildOpenAiActivationBody(safetyIdentifier)),
      });
      const provider = await readBoundedResponse(response, controller.signal);
      if (!response.ok) return json(200, response.status === 429 ? "quota" : "provider", { providerStatus: response.status, ...providerErrorDetails(provider) }, cors);
      const parsed = parseOpenAiResponse(provider, 1);
      const recorded = await deps.rpc("record_ai_activation_check", {
        target_user_id: userId,
        supplied_provider_response_id: parsed.responseId,
      });
      if (recorded.error) return json(200, "activation", {}, cors);
      return json(200, "ready", {}, cors);
    } catch (error) {
      const code = error instanceof DOMException && error.name === "AbortError" ? "timeout"
        : error instanceof Error && ["refusal","truncated","schema"].includes(error.message) ? error.message : "provider";
      return json(200, code, {}, cors);
    } finally { clearTimeout(timeout); }
  }
  const reservation = await deps.rpc("reserve_ai_drafting_attempt", { target_user_id: userId, supplied_attempt_id: requestId, supplied_mode: mode, supplied_candidate_count: count, supplied_image_count: imageCount });
  const reserved = reservation.data?.[0];
  if (reservation.error || !reserved || reserved.model !== FIXED_MODEL || reserved.service_tier !== FIXED_SERVICE_TIER) return json(503, "disabled", {}, cors);
  if (!secretsValid) {
    await completeAttempt(deps, completionArgs(requestId, "failed", "configuration", null, null));
    return json(503, "configuration", {}, cors);
  }

  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let failure = "input"; let providerStarted = false; let usage: RecognizedOpenAiUsage | null = null; let providerId: string | null = null;
  try {
    const body = await boundedJson(request, controller.signal);
    const decoded = bodyImages(body, mode, count, imageCount);
    const sanitized: string[][] = [];
    for (const candidate of decoded) {
      const images: string[] = [];
      for (const bytes of candidate) images.push(bytesToBase64(await withSignal(deps.sanitize(bytes), controller.signal)));
      sanitized.push(images);
    }
    const safetyIdentifier = await withSignal(deps.hmac(safetySecret, userId), controller.signal);
    const started = await deps.rpc("mark_ai_drafting_provider_started", { supplied_attempt_id: requestId });
    if (started.error) return json(503, "used", {}, cors);
    providerStarted = true; failure = "network";
    const response = await deps.fetcher(`${OPENAI_ORIGIN}${OPENAI_PATH}`, { method: "POST", redirect: "error", signal: controller.signal, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(buildOpenAiBody(sanitized, safetyIdentifier)) });
    failure = response.status === 429 ? "quota" : "provider";
    const provider = await readBoundedResponse(response, controller.signal);
    usage = parseOpenAiUsage(provider);
    providerId = typeof provider?.id === "string" && /^resp_[A-Za-z0-9_-]{1,120}$/.test(provider.id) ? provider.id : null;
    if (!response.ok) throw new Error(failure);
    const parsed = parseOpenAiResponse(provider, count); providerId = parsed.responseId;
    const completion = await completeAttempt(deps, completionArgs(requestId, usage ? "completed" : "unknown_usage", usage ? null : "usage", usage, providerId));
    if (completion.error) return json(503, "usage", {}, cors);
    return json(200, "ok", { results: parsed.results }, cors);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") failure = "timeout";
    else if (error instanceof Error && ["configuration","input","timeout","network","provider","quota","refusal","truncated","schema"].includes(error.message)) failure = error.message;
    const terminalStatus = providerStarted ? (usage ? "failed" : "unknown_usage") : "failed";
    const completion = await completeAttempt(deps, completionArgs(requestId, terminalStatus, failure, usage, providerId));
    if (completion.error) return json(503, "usage", {}, cors);
    return json(failure === "input" ? 400 : failure === "configuration" ? 503 : 422, failure, {}, cors);
  } finally { clearTimeout(timeout); }
}
