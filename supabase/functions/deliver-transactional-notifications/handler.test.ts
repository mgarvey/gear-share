import { describe, expect, it, vi } from "vitest";
import { handleDeliveryRequest, type DeliveryDependencies } from "./handler";

const token = "t".repeat(40);
const values: Record<string, string> = {
  GEAR_SHARE_TRANSACTIONAL_EMAIL_ENABLED: "true", GEAR_SHARE_SES_FEEDBACK_ENABLED: "true", GEAR_SHARE_NOTIFICATION_WORKER_TOKEN: token,
  AWS_SES_REGION: "us-east-1", AWS_SES_ACCESS_KEY_ID: "AKIDEXAMPLE", AWS_SES_SECRET_ACCESS_KEY: "secret",
  AWS_SES_FROM_ADDRESS: "gear@example.test", AWS_SES_CONFIGURATION_SET: "gear-share", GEAR_SHARE_APP_ORIGIN: "https://gear.example.test",
};
const claimed = { outbox_id: "outbox", claim_token: "claim", recipient_email: "member@example.test", email_subject: "Gear: update", email_body: "A loan changed.", app_route: "/loans", delivery_tag: "00000000-0000-4000-8000-000000000001" };

function dependencies(overrides: Partial<DeliveryDependencies> = {}) {
  const rpc = vi.fn().mockImplementation((name: string) => Promise.resolve(name === "claim_transactional_notifications" ? { data: [claimed], error: null } : { data: "delivered", error: null }));
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ MessageId: "ses-message" }), { status: 200 }));
  return { deps: { env: (name: string) => values[name], rpc, fetcher, now: () => new Date("2026-08-14T12:00:00Z"), uuid: () => "00000000-0000-4000-8000-000000000099", ...overrides } as DeliveryDependencies, rpc, fetcher };
}
const request = (body = "{}", authorization = `Bearer ${token}`) => new Request("https://local.test", { method: "POST", headers: { authorization, "content-type": "application/json" }, body });

describe("transactional delivery handler", () => {
  it("stops before body, database, and provider when either paired flag is off", async () => {
    const setup = dependencies({ env: (name) => name === "GEAR_SHARE_SES_FEEDBACK_ENABLED" ? "false" : values[name] });
    const response = await handleDeliveryRequest(request("x".repeat(1000)), setup.deps);
    expect(response.status).toBe(503); expect(setup.rpc).not.toHaveBeenCalled(); expect(setup.fetcher).not.toHaveBeenCalled();
  });

  it("rejects a wrong worker token and an oversized request without claiming", async () => {
    const wrong = dependencies();
    expect((await handleDeliveryRequest(request("{}", "Bearer wrong"), wrong.deps)).status).toBe(401);
    expect(wrong.rpc).not.toHaveBeenCalled();
    const large = dependencies();
    expect((await handleDeliveryRequest(request(`{"batchLimit":25,"padding":"${"x".repeat(300)}"}`), large.deps)).status).toBe(500);
    expect(large.rpc).not.toHaveBeenCalled();
  });

  it("claims a bounded batch, sends one fixed SES request, and records success", async () => {
    const setup = dependencies();
    const response = await handleDeliveryRequest(request('{"batchLimit":1}'), setup.deps);
    expect(response.status).toBe(200);
    expect(setup.rpc).toHaveBeenNthCalledWith(1, "claim_transactional_notifications", { supplied_worker_id: "00000000-0000-4000-8000-000000000099", batch_limit: 1 });
    expect(setup.fetcher).toHaveBeenCalledWith("https://email.us-east-1.amazonaws.com/v2/email/outbound-emails", expect.objectContaining({ method: "POST", redirect: "error" }));
    expect(setup.rpc).toHaveBeenNthCalledWith(2, "complete_transactional_notification_delivery", expect.objectContaining({ target_outbox_id: "outbox", supplied_outcome: "delivered", supplied_provider_message_id: "ses-message" }));
  });

  it.each([[429, "retryable", "throttled"], [503, "retryable", "provider_5xx"], [400, "permanent", "provider_4xx"]])("classifies provider %s without address suppression", async (status, outcome, errorCode) => {
    const setup = dependencies({ fetcher: vi.fn().mockResolvedValue(new Response("{}", { status })) as typeof fetch });
    await handleDeliveryRequest(request(), setup.deps);
    expect(setup.rpc).toHaveBeenLastCalledWith("complete_transactional_notification_delivery", expect.objectContaining({ supplied_outcome: outcome, supplied_error_code: errorCode }));
  });

  it("suppresses only a deterministically invalid recipient before any provider request", async () => {
    const setup = dependencies();
    setup.rpc.mockImplementation((name: string) => Promise.resolve(name === "claim_transactional_notifications" ? { data: [{ ...claimed, recipient_email: "not-an-address" }], error: null } : { data: "address_suppressed", error: null }));
    await handleDeliveryRequest(request(), setup.deps);
    expect(setup.fetcher).not.toHaveBeenCalled();
    expect(setup.rpc).toHaveBeenLastCalledWith("complete_transactional_notification_delivery", expect.objectContaining({ supplied_outcome: "permanent_address", supplied_error_code: "address_rejected" }));
  });

  it("records a lost response as ambiguous and never performs an automatic resend", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("timeout"));
    const setup = dependencies({ fetcher: fetcher as typeof fetch });
    await handleDeliveryRequest(request(), setup.deps);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(setup.rpc).toHaveBeenLastCalledWith("complete_transactional_notification_delivery", expect.objectContaining({ supplied_outcome: "ambiguous", supplied_error_code: "network_ambiguous" }));
  });
});
