import { describe, expect, it } from "vitest";
import { handleDeleteMemberRequest, type DeletionDependencies } from "./handler";

const target = "11111111-1111-4111-8111-111111111111";
const origin = "https://gear.example";

function dependencies(overrides: Partial<DeletionDependencies> = {}) {
  const calls: string[] = [];
  const deps: DeletionDependencies = {
    env: () => origin,
    authenticate: async () => "admin",
    callerRpc: async (nameToken, name) => { calls.push(`${nameToken}:${name}`); return { data: [{ target_id: target, deletion_token: "token" }], error: null }; },
    serviceRpc: async (name) => { calls.push(name); return { data: null, error: null }; },
    scrubUserMetadata: async (id) => { calls.push(`scrub:${id}`); return { error: null }; },
    deleteUser: async (id, soft) => { calls.push(`delete:${id}:${soft}`); return { error: null }; },
    userIsDeleted: async () => false,
    ...overrides,
  };
  return { deps, calls };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://functions.example/delete-deactivated-member", {
    method: "POST",
    headers: { authorization: "Bearer token", origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("delete-deactivated-member", () => {
  it("reserves as the caller, soft deletes Auth, and finalizes once", async () => {
    const { deps, calls } = dependencies();
    const response = await handleDeleteMemberRequest(request({ targetUserId: target }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "deleted" });
    expect(calls).toEqual(["token:reserve_deactivated_member_deletion", `scrub:${target}`, `delete:${target}:true`, "finalize_deactivated_member_deletion"]);
  });

  it("rejects malformed input before reservation or deletion", async () => {
    const { deps, calls } = dependencies();
    const response = await handleDeleteMemberRequest(request({ targetUserId: target, role: "administrator" }), deps);
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("reports an unknown result without finalizing when Auth deletion cannot be confirmed", async () => {
    const { deps, calls } = dependencies({ deleteUser: async () => ({ error: new Error("lost") }) });
    const response = await handleDeleteMemberRequest(request({ targetUserId: target }), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "result_unknown" });
    expect(calls.includes("finalize_deactivated_member_deletion")).toBe(false);
  });

  it("does not delete or finalize when Auth metadata cannot be scrubbed", async () => {
    const { deps, calls } = dependencies({ scrubUserMetadata: async () => ({ error: new Error("unavailable") }) });
    const response = await handleDeleteMemberRequest(request({ targetUserId: target }), deps);
    expect(response.status).toBe(503);
    expect(calls.some((call) => call.startsWith("delete:"))).toBe(false);
    expect(calls.includes("finalize_deactivated_member_deletion")).toBe(false);
  });

  it("finalizes after a lost Auth response when deletion is confirmed", async () => {
    let deletionChecks = 0;
    const { deps, calls } = dependencies({
      deleteUser: async () => { throw new Error("timeout"); },
      userIsDeleted: async () => ++deletionChecks > 1,
    });
    const response = await handleDeleteMemberRequest(request({ targetUserId: target }), deps);
    expect(response.status).toBe(200);
    expect(calls.at(-1)).toBe("finalize_deactivated_member_deletion");
  });

  it("finalizes a prior successful Auth deletion without trying to update it again", async () => {
    const { deps, calls } = dependencies({ userIsDeleted: async () => true });
    const response = await handleDeleteMemberRequest(request({ targetUserId: target }), deps);
    expect(response.status).toBe(200);
    expect(calls.some((call) => call.startsWith("scrub:") || call.startsWith("delete:"))).toBe(false);
    expect(calls.at(-1)).toBe("finalize_deactivated_member_deletion");
  });
});
