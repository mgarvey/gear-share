export const MAX_BODY_BYTES = 4 * 1024;
const AUTH_TIMEOUT_MS = 3_000;
const PROVIDER_TIMEOUT_MS = 8_000;

type RpcResult = { data: any; error: any };
type InviteResult = { userId: string | null; error: unknown };

export type InvitationDependencies = {
  env(name: string): string | undefined;
  authenticate(token: string): Promise<string | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  inviteUser(email: string, displayName: string, redirectTo: string): Promise<InviteResult>;
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
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY_BYTES) throw new Error("input");
  if (!request.body) throw new Error("input");
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
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function invitationDetails(value: any) {
  if (!value || Object.keys(value).sort().join(",") !== "displayName,email") throw new Error("input");
  if (typeof value.email !== "string" || typeof value.displayName !== "string") throw new Error("input");
  const email = value.email.trim().toLowerCase();
  const displayName = value.displayName.trim().replace(/\s+/g, " ");
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("input");
  if (displayName.length > 80 || [...displayName].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  })) throw new Error("input");
  return { email, displayName };
}

function reservationFailure(error: any) {
  const message = String(error?.message ?? "");
  if (message.includes("active administrator required") || message.includes("service role required")) return [403, "authorization"] as const;
  if (message.includes("account already exists")) return [409, "existing_account"] as const;
  if (message.includes("resend limit") || message.includes("resend cooldown")) return [429, "rate_limit"] as const;
  if (message.includes("resend unavailable")) return [409, "existing_account"] as const;
  if (message.includes("invitation already in progress")) return [409, "in_progress"] as const;
  if (message.includes("rate limit")) return [429, "rate_limit"] as const;
  if (message.includes("valid email address")) return [400, "input_email"] as const;
  if (message.includes("valid display name")) return [400, "input_display_name"] as const;
  if (message.includes("valid invitation details")) return [400, "input"] as const;
  return [503, "unavailable"] as const;
}

export async function handleInvitationRequest(request: Request, deps: InvitationDependencies) {
  let cors: Record<string, string> | null;
  try { cors = originHeaders(request, deps.env("GEAR_SHARE_APP_ORIGIN")); } catch { cors = null; }
  if (cors === null) return json(403, "origin");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, apikey, content-type, x-client-info", "access-control-max-age": "600" } });
  }
  if (request.method !== "POST") return json(405, "method", cors);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, "authentication", cors);
  let userId: string | null;
  try { userId = await withTimeout(deps.authenticate(authorization.slice(7)), AUTH_TIMEOUT_MS); }
  catch { return json(503, "authentication", cors); }
  if (!userId) return json(401, "authentication", cors);

  let details: { email: string; displayName: string };
  try { details = invitationDetails(await boundedBody(request)); }
  catch { return json(400, "input", cors); }
  const origin = deps.env("GEAR_SHARE_APP_ORIGIN");
  if (!origin) return json(503, "configuration", cors);

  const reservation = await deps.rpc("reserve_preapproved_member_invitation", {
    target_user_id: userId,
    supplied_email: details.email,
    supplied_display_name: details.displayName,
  });
  let reserved = reservation.data?.[0];
  let isResend = false;
  if (reservation.error && String(reservation.error?.message ?? "").includes("account already exists")) {
    const resend = await deps.rpc("authorize_preapproved_member_invitation_resend", {
      target_user_id: userId,
      supplied_email: details.email,
    });
    reserved = resend.data?.[0];
    isResend = true;
    if (resend.error || !reserved?.invitation_id || reserved.normalized_email !== details.email) {
      const [status, code] = reservationFailure(resend.error);
      return json(status, code, cors);
    }
  } else if (reservation.error || !reserved?.invitation_id || reserved.normalized_email !== details.email) {
    const [status, code] = reservationFailure(reservation.error);
    return json(status, code, cors);
  }

  let invitation: InviteResult;
  try {
    invitation = await withTimeout(deps.inviteUser(details.email, reserved.display_name, `${origin}/`), PROVIDER_TIMEOUT_MS);
  } catch {
    // The provider may still finish after a lost response. Leave the short-lived
    // reservation intact so a late Auth insert can consume it exactly once.
    return json(503, "result_unknown", cors);
  }
  if (invitation.error || !invitation.userId) {
    if (!isResend) await deps.rpc("fail_preapproved_member_invitation", {
      target_invitation_id: reserved.invitation_id, supplied_failure_code: "provider",
    });
    return json(502, "delivery", cors);
  }
  return json(200, "sent", cors);
}
