import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeAuthenticatedFunction = vi.hoisted(() => vi.fn());

vi.mock("./client", () => ({
  db: { rpc: vi.fn() },
  recoveryRpc: vi.fn(),
  invokeAuthenticatedFunction,
}));

import { deleteDeactivatedMember, sendPreapprovedMemberInvitation } from "./administrationSettings";

describe("personal invitation adapter", () => {
  beforeEach(() => invokeAuthenticatedFunction.mockReset());

  it("invokes only the reviewed invitation function with email and display name", async () => {
    invokeAuthenticatedFunction.mockResolvedValue({ data: { code: "sent" }, error: null });

    await sendPreapprovedMemberInvitation("new.member@example.com", "New Member");

    expect(invokeAuthenticatedFunction).toHaveBeenCalledWith("invite-preapproved-member", {
      body: { email: "new.member@example.com", displayName: "New Member" },
    });
  });

  it("turns bounded server outcomes into useful Administrator guidance", async () => {
    invokeAuthenticatedFunction.mockResolvedValue({
      data: null,
      error: { context: new Response(JSON.stringify({ code: "existing_account" }), { status: 409, headers: { "content-type": "application/json" } }) },
    });

    await expect(sendPreapprovedMemberInvitation("existing@example.com", ""))
      .rejects.toThrow("That email already has an account");
  });

  it.each([
    ["input_email", "Enter a valid email address."],
    ["input_display_name", "Use a display name of 80 characters or fewer without links or special formatting."],
  ])("explains the specific invalid field for %s", async (code, message) => {
    invokeAuthenticatedFunction.mockResolvedValue({
      data: null,
      error: { context: new Response(JSON.stringify({ code }), { status: 400, headers: { "content-type": "application/json" } }) },
    });

    await expect(sendPreapprovedMemberInvitation("new@example.com", "Name"))
      .rejects.toThrow(message);
  });
});

describe("deactivated account deletion adapter", () => {
  beforeEach(() => invokeAuthenticatedFunction.mockReset());

  it("invokes only the reviewed deletion function with the target member", async () => {
    invokeAuthenticatedFunction.mockResolvedValue({ data: { code: "deleted" }, error: null });
    await deleteDeactivatedMember("member-id");
    expect(invokeAuthenticatedFunction).toHaveBeenCalledWith("delete-deactivated-member", {
      body: { targetUserId: "member-id" },
    });
  });

  it("explains when the account must be deactivated first", async () => {
    invokeAuthenticatedFunction.mockResolvedValue({ data: { code: "not_deactivated" }, error: {} });
    await expect(deleteDeactivatedMember("member-id")).rejects.toThrow("must be deactivated");
  });
});
