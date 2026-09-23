import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
const functions = vi.hoisted(() => ({ invoke: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth, functions, rpc },
}));

import { invokeAuthenticatedFunction } from "./client";

describe("authenticated Edge Function invocation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "current-token", expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null });
    auth.refreshSession.mockResolvedValue({ data: { session: { access_token: "refreshed-token" } }, error: null });
  });

  it("explicitly sends the current user access token", async () => {
    functions.invoke.mockResolvedValue({ data: { code: "ok" }, error: null });

    await invokeAuthenticatedFunction("draft-gear-listing", { headers: { "x-request-id": "request" }, body: {} });

    expect(functions.invoke).toHaveBeenCalledWith("draft-gear-listing", expect.objectContaining({
      headers: { "x-request-id": "request", Authorization: "Bearer current-token" },
    }));
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes once after a definite authentication rejection", async () => {
    functions.invoke
      .mockResolvedValueOnce({ data: null, error: { context: new Response(null, { status: 401 }) } })
      .mockResolvedValueOnce({ data: { code: "ok" }, error: null });

    const result = await invokeAuthenticatedFunction("draft-gear-listing", { body: {} });

    expect(result.error).toBeNull();
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(functions.invoke).toHaveBeenNthCalledWith(2, "draft-gear-listing", expect.objectContaining({ headers: { Authorization: "Bearer refreshed-token" } }));
  });

  it("does not retry a provider or application failure", async () => {
    const failure = { context: new Response(null, { status: 503 }) };
    functions.invoke.mockResolvedValue({ data: null, error: failure });

    const result = await invokeAuthenticatedFunction("draft-gear-listing", { body: {} });

    expect(result.error).toBe(failure);
    expect(functions.invoke).toHaveBeenCalledTimes(1);
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });
});
