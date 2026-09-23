import { describe, expect, it, vi } from "vitest";
import { handleInvitationRequest, type InvitationDependencies } from "./handler";

function setup(overrides: Partial<InvitationDependencies> = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: [{ invitation_id: "00000000-0000-4000-8000-000000000001", normalized_email: "new@example.test", display_name: "New Member" }], error: null });
  const inviteUser = vi.fn().mockResolvedValue({ userId: "user", error: null });
  const deps: InvitationDependencies = {
    env: (name) => name === "GEAR_SHARE_APP_ORIGIN" ? "https://gear.example.test" : undefined,
    authenticate: vi.fn().mockResolvedValue("administrator"),
    rpc,
    inviteUser,
    ...overrides,
  };
  return { deps, rpc, inviteUser };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://functions.example.test/invite-preapproved-member", {
    method: "POST",
    headers: { authorization: "Bearer token", origin: "https://gear.example.test", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("preapproved member invitation handler", () => {
  it("authenticates, reserves exact Regular admission, and asks Supabase Auth to deliver one invite", async () => {
    const test = setup();
    const response = await handleInvitationRequest(request({ email: " New@Example.Test ", displayName: " New   Member " }), test.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "sent" });
    expect(test.rpc).toHaveBeenNthCalledWith(1, "reserve_preapproved_member_invitation", {
      target_user_id: "administrator", supplied_email: "new@example.test", supplied_display_name: "New Member",
    });
    expect(test.inviteUser).toHaveBeenCalledWith("new@example.test", "New Member", "https://gear.example.test/");
  });

  it("rejects unauthenticated and wrong-origin requests before body, reservation, or delivery", async () => {
    const unauthenticated = setup({ authenticate: vi.fn().mockResolvedValue(null) });
    expect((await handleInvitationRequest(request({ email: "new@example.test", displayName: "" }), unauthenticated.deps)).status).toBe(401);
    expect(unauthenticated.rpc).not.toHaveBeenCalled();
    const wrongOrigin = setup();
    expect((await handleInvitationRequest(request({ email: "new@example.test", displayName: "" }, { origin: "https://attacker.example" }), wrongOrigin.deps)).status).toBe(403);
    expect(wrongOrigin.rpc).not.toHaveBeenCalled();
  });

  it("rejects extra authority fields and oversized bodies before reservation", async () => {
    const extra = setup();
    const response = await handleInvitationRequest(request({ email: "new@example.test", displayName: "New", role: "administrator" }), extra.deps);
    expect(response.status).toBe(400);
    expect(extra.rpc).not.toHaveBeenCalled();
    const oversized = setup();
    const large = request({ email: "new@example.test", displayName: "New" }, { "content-length": String(4097) });
    expect((await handleInvitationRequest(large, oversized.deps)).status).toBe(400);
    expect(oversized.rpc).not.toHaveBeenCalled();
    const oversizedStream = setup();
    expect((await handleInvitationRequest(request({ email: "new@example.test", displayName: "x".repeat(5_000) }), oversizedStream.deps)).status).toBe(400);
    expect(oversizedStream.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["active administrator required", 403, "authorization"],
    ["account already exists", 409, "existing_account"],
    ["invitation already in progress", 409, "in_progress"],
    ["invitation rate limit reached", 429, "rate_limit"],
    ["valid email address required", 400, "input_email"],
    ["valid display name required", 400, "input_display_name"],
  ])("maps bounded reservation failure %s", async (message, status, code) => {
    const test = setup({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message } }) });
    const response = await handleInvitationRequest(request({ email: "new@example.test", displayName: "New" }), test.deps);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code });
    expect(test.inviteUser).not.toHaveBeenCalled();
  });

  it("marks a definitive provider-owned invitation failure without exposing provider text", async () => {
    const test = setup({ inviteUser: vi.fn().mockResolvedValue({ userId: null, error: new Error("private provider detail") }) });
    const response = await handleInvitationRequest(request({ email: "new@example.test", displayName: "New Member" }), test.deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: "delivery" });
    expect(test.rpc).toHaveBeenLastCalledWith("fail_preapproved_member_invitation", { target_invitation_id: "00000000-0000-4000-8000-000000000001", supplied_failure_code: "provider" });
  });

  it("leaves an ambiguous link result reserved instead of risking a false failure", async () => {
    const test = setup({ inviteUser: vi.fn().mockRejectedValue(new Error("lost response")) });
    const response = await handleInvitationRequest(request({ email: "new@example.test", displayName: "New Member" }), test.deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "result_unknown" });
    expect(test.rpc).toHaveBeenCalledTimes(1);
  });

  it("authorizes a bounded resend for an existing unconfirmed preapproved account", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: "account already exists" } })
      .mockResolvedValueOnce({ data: [{ invitation_id: "00000000-0000-4000-8000-000000000001", normalized_email: "new@example.test", display_name: "New Member", accepted_user_id: "user" }], error: null });
    const test = setup({ rpc });
    const response = await handleInvitationRequest(request({ email: "new@example.test", displayName: "New Member" }), test.deps);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(2, "authorize_preapproved_member_invitation_resend", {
      target_user_id: "administrator", supplied_email: "new@example.test",
    });
    expect(test.inviteUser).toHaveBeenCalledTimes(1);
  });
});
