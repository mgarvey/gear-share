export const MAX_BODY_BYTES = 1024;
const AUTH_TIMEOUT_MS = 3_000;
const PROVIDER_TIMEOUT_MS = 8_000;

type RpcResult = { data: any; error: any };
type DeleteResult = { error: any };

export type DeletionDependencies = {
  env(name: string): string | undefined;
  authenticate(token: string): Promise<string | null>;
  callerRpc(token: string, name: string, args: Record<string, unknown>): Promise<RpcResult>;
  serviceRpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  scrubUserMetadata(userId: string): Promise<DeleteResult>;
  deleteUser(userId: string, shouldSoftDelete: true): Promise<DeleteResult>;
  userIsDeleted(userId: string): Promise<boolean>;
};

function json(status: number, code: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ code }), {
    status,
    headers: { ...headers, "content-type": "application/json", "cache-control": "no-store" },
  });
}

function originHeaders(request: Request, configured?: string) {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  if (!configured || origin !== configured || new URL(configured).origin !== configured) return null;
  return { "access-control-allow-origin": configured, vary: "Origin" };
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new DOMException("timed out", "AbortError")), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function boundedBody(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY_BYTES || !request.body) throw new Error("input");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) throw new Error("input");
      chunks.push(value);
    }
  } finally {
    if (total > MAX_BODY_BYTES) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (total === 0) throw new Error("input");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function targetId(value: any) {
  if (!value || Object.keys(value).join(",") !== "targetUserId" || typeof value.targetUserId !== "string") throw new Error("input");
  const id = value.targetUserId.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error("input");
  return id;
}

function reservationFailure(error: any) {
  const message = String(error?.message ?? "");
  if (message.includes("active administrator required")) return [403, "authorization"] as const;
  if (message.includes("deactivated member required")) return [409, "not_deactivated"] as const;
  if (message.includes("account already deleted")) return [409, "already_deleted"] as const;
  return [503, "unavailable"] as const;
}

export async function handleDeleteMemberRequest(request: Request, deps: DeletionDependencies) {
  let cors: Record<string, string> | null;
  try { cors = originHeaders(request, deps.env("GEAR_SHARE_APP_ORIGIN")); } catch { cors = null; }
  if (cors === null) return json(403, "origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, apikey, content-type, x-client-info", "access-control-max-age": "600" } });
  if (request.method !== "POST") return json(405, "method", cors);

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, "authentication", cors);
  const token = authorization.slice(7);
  try {
    if (!await withTimeout(deps.authenticate(token), AUTH_TIMEOUT_MS)) return json(401, "authentication", cors);
  } catch { return json(503, "authentication", cors); }

  let memberId: string;
  try { memberId = targetId(await boundedBody(request)); }
  catch { return json(400, "input", cors); }

  const reservation = await deps.callerRpc(token, "reserve_deactivated_member_deletion", { target_user_id: memberId });
  const reserved = reservation.data?.[0];
  if (reservation.error || reserved?.target_id !== memberId || typeof reserved?.deletion_token !== "string") {
    const [status, code] = reservationFailure(reservation.error);
    return json(status, code, cors);
  }

  let deleted: boolean;
  try { deleted = await withTimeout(deps.userIsDeleted(memberId), AUTH_TIMEOUT_MS); }
  catch { return json(503, "result_unknown", cors); }
  if (!deleted) {
    try {
      const scrubbed = await withTimeout(deps.scrubUserMetadata(memberId), AUTH_TIMEOUT_MS);
      if (scrubbed.error) return json(503, "result_unknown", cors);
      const result = await withTimeout(deps.deleteUser(memberId, true), PROVIDER_TIMEOUT_MS);
      deleted = !result.error;
      if (!deleted) deleted = await withTimeout(deps.userIsDeleted(memberId), AUTH_TIMEOUT_MS);
    } catch {
      try { deleted = await withTimeout(deps.userIsDeleted(memberId), AUTH_TIMEOUT_MS); } catch { deleted = false; }
    }
  }
  if (!deleted) return json(503, "result_unknown", cors);

  const finalized = await deps.serviceRpc("finalize_deactivated_member_deletion", {
    target_user_id: memberId,
    supplied_deletion_token: reserved.deletion_token,
  });
  if (finalized.error) return json(503, "result_unknown", cors);
  return json(200, "deleted", cors);
}
