import { describe, expect, it, vi } from "vitest";
import { bytesToBase64, handleDraftRequest, type DraftDependencies } from "./handler";
import { PROVIDER_TIMEOUT_MS } from "./openai";

const id = "00000000-0000-4000-8000-000000000008";
const jpeg = Uint8Array.from([0xff,0xd8,0xff,0xc0,0,11,8,0,1,0,1,1,1,0,0,0xff,0xd9]);
const base64 = btoa(String.fromCharCode(...jpeg));
const provider = { id: "resp_fixture", status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ results: [{ kind: "draft", title: "Tent", description: "A tent", category: "tents-shelters" }] }) }] }], usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 10 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 4 }, total_tokens: 120 } };

function setup(overrides: Partial<DraftDependencies> = {}) {
  const rpc = vi.fn().mockImplementation((name: string) => Promise.resolve(["reserve_ai_drafting_attempt", "authorize_ai_activation_check"].includes(name) ? { data: [{ model: "gpt-5.6-luna", service_tier: "standard" }], error: null } : { data: null, error: null }));
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(provider), { status: 200 }));
  const deps: DraftDependencies = { env: (name) => ({ GEAR_SHARE_APP_ORIGIN: "https://gear.example.test", OPENAI_API_KEY: `sk-${"k".repeat(40)}`, OPENAI_SAFETY_IDENTIFIER_SECRET: "s".repeat(48) } as Record<string,string>)[name], authenticate: vi.fn().mockResolvedValue("user"), rpc, fetcher: fetcher as typeof fetch, sanitize: vi.fn().mockResolvedValue(jpeg), hmac: vi.fn().mockResolvedValue("a".repeat(64)), ...overrides };
  return { deps, rpc, fetcher };
}
function request(body: unknown, headers: Record<string,string> = {}) { return new Request("https://local.test", { method: "POST", headers: { authorization: "Bearer token", origin: "https://gear.example.test", "content-type": "application/json", "x-gear-share-request-id": id, "x-gear-share-draft-mode": "single", "x-gear-share-draft-count": "1", "x-gear-share-image-count": "1", ...headers }, body: JSON.stringify(body) }); }

describe("draft gear handler", () => {
  it("runs one Administrator-authorized synthetic provider check without reserving a member draft", async () => {
    const test = setup();
    const response = await handleDraftRequest(request({}, { "x-gear-share-draft-mode": "activation" }), test.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "ready" });
    expect(test.rpc).toHaveBeenNthCalledWith(1, "authorize_ai_activation_check", { target_user_id: "user" });
    expect(test.rpc).toHaveBeenLastCalledWith("record_ai_activation_check", { target_user_id: "user", supplied_provider_response_id: "resp_fixture" });
    expect(test.rpc).not.toHaveBeenCalledWith("reserve_ai_drafting_attempt", expect.anything());
    const outbound = JSON.parse(String(test.fetcher.mock.calls[0][1].body));
    expect(outbound.input[0].content[1]).toMatchObject({ type: "input_image", detail: "low" });
    expect(outbound.input[0].content[1].image_url).toMatch(/^data:image\/png;base64,/);
  });

  it("denies an activation check before provider work when the caller is not an active Administrator", async () => {
    const test = setup({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "denied" } }) });
    const response = await handleDraftRequest(request({}, { "x-gear-share-draft-mode": "activation" }), test.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "authorization" });
    expect(test.fetcher).not.toHaveBeenCalled();
  });
  it("returns only bounded provider diagnostics for a rejected activation request", async () => {
    const rejected = new Response(JSON.stringify({ error: { code: "invalid_request_error", type: "invalid_request_error", param: "text.format.schema", message: "do not expose this" } }), { status: 400 });
    const test = setup({ fetcher: vi.fn().mockResolvedValue(rejected) as typeof fetch });
    const response = await handleDraftRequest(request({}, { "x-gear-share-draft-mode": "activation" }), test.deps);
    expect(await response.json()).toEqual({ code: "provider", providerStatus: 400, providerCode: "invalid_request_error", providerParam: "text.format.schema" });
  });
  it("reserves before accepting body and stops disabled requests before provider work", async () => {
    const test = setup({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "disabled" } }) });
    expect((await handleDraftRequest(request({ anything: true }), test.deps)).status).toBe(503);
    expect(test.fetcher).not.toHaveBeenCalled();
  });
  it("sends fixed low-detail Responses input and returns only strict draft fields", async () => {
    const test = setup(); const response = await handleDraftRequest(request({ detail: "low", candidates: [{ images: [base64] }] }), test.deps);
    expect(response.status).toBe(200); expect(test.fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = test.fetcher.mock.calls[0]; const outbound = JSON.parse(String(init.body));
    expect(url).toBe("https://api.openai.com/v1/responses"); expect(outbound).toMatchObject({ model: "gpt-5.6-luna", service_tier: "default", store: false, tools: [] });
    expect(outbound.input[0].content[1].detail).toBe("low");
    expect(test.rpc).toHaveBeenNthCalledWith(1, "reserve_ai_drafting_attempt", expect.objectContaining({ target_user_id: "user", supplied_mode: "single", supplied_image_count: 1 }));
    expect(test.rpc).toHaveBeenLastCalledWith("complete_ai_drafting_attempt", expect.objectContaining({ supplied_status: "completed", supplied_input_tokens: 100, supplied_cached_input_tokens: 10, supplied_output_tokens: 20, supplied_reasoning_output_tokens: 4, supplied_provider_response_id: "resp_fixture" }));
  });
  it("rejects unsafe detail/count and never calls the provider", async () => {
    const test = setup(); const response = await handleDraftRequest(request({ detail: "auto", candidates: [{ images: [base64] }] }), test.deps);
    expect(response.status).toBe(400); expect(test.fetcher).not.toHaveBeenCalled();
  });
  it("rejects the eleventh bulk candidate in headers before reserving", async () => {
    const test = setup(); const response = await handleDraftRequest(request({}, { "x-gear-share-draft-mode": "bulk", "x-gear-share-draft-count": "11" }), test.deps);
    expect(response.status).toBe(400); expect(test.rpc).not.toHaveBeenCalled();
  });
  it("rejects missing, excessive, and body-mismatched image counts before provider work", async () => {
    for (const imageCount of ["0", "5"]) {
      const test = setup(); const response = await handleDraftRequest(request({}, { "x-gear-share-image-count": imageCount }), test.deps);
      expect(response.status).toBe(400); expect(test.rpc).not.toHaveBeenCalled();
    }
    const mismatch = setup();
    const response = await handleDraftRequest(request({ detail: "low", candidates: [{ images: [base64] }] }, { "x-gear-share-image-count": "2" }), mismatch.deps);
    expect(response.status).toBe(400); expect(mismatch.fetcher).not.toHaveBeenCalled();
  });
  it("authenticates before reservation and provider work", async () => {
    const authenticate = vi.fn().mockResolvedValue(null); const test = setup({ authenticate });
    const response = await handleDraftRequest(request({ detail: "low", candidates: [{ images: [base64] }] }), test.deps);
    expect(response.status).toBe(401); expect(authenticate).toHaveBeenCalledTimes(1);
    expect(test.rpc).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
  });
  it("rejects a declared oversized body after reservation and before decode or provider work", async () => {
    const sanitize = vi.fn(); const test = setup({ sanitize });
    const response = await handleDraftRequest(request({ detail: "low", candidates: [{ images: [base64] }] }, { "content-length": String(8 * 1024 * 1024 + 1) }), test.deps);
    expect(response.status).toBe(400); expect(test.rpc).toHaveBeenNthCalledWith(1, "reserve_ai_drafting_attempt", expect.anything());
    expect(sanitize).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
  });
  it("records a timeout without retrying the provider", async () => {
    const fetcher = vi.fn().mockRejectedValue(new DOMException("timed out", "AbortError")); const test = setup({ fetcher: fetcher as typeof fetch });
    const response = await handleDraftRequest(request({ detail: "low", candidates: [{ images: [base64] }] }), test.deps);
    expect(response.status).toBe(422); expect((await response.json()).code).toBe("timeout");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(test.rpc).toHaveBeenLastCalledWith("complete_ai_drafting_attempt", expect.objectContaining({ supplied_status: "unknown_usage", supplied_failure_kind: "timeout" }));
  });
  it("keeps the deadline active while the provider response body stalls", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({ pull() {} }), { status: 200 })); const test = setup({ fetcher: fetcher as typeof fetch });
      const pending = handleDraftRequest(request({ detail: "low", candidates: [{ images: [base64] }] }), test.deps);
      await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS + 1); const response = await pending;
      expect((await response.json()).code).toBe("timeout"); expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("retains recognized usage when strict output validation fails", async () => {
    const invalid = { ...provider, output: [{ content: [{ type: "output_text", text: JSON.stringify({ results: [{ kind: "draft", title: "Tent", description: "", category: "wrong" }] }) }] }] };
    const test = setup({ fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify(invalid), { status: 200 })) as typeof fetch });
    const response = await handleDraftRequest(request({ detail: "low", candidates: [{ images: [base64] }] }), test.deps);
    expect((await response.json()).code).toBe("schema");
    expect(test.rpc).toHaveBeenLastCalledWith("complete_ai_drafting_attempt", expect.objectContaining({ supplied_status: "failed", supplied_input_tokens: 100, supplied_cached_input_tokens: 10, supplied_provider_response_id: "resp_fixture" }));
  });
  it("returns a valid manual-review result while conservatively retaining reservation when usage is missing", async () => {
    const withoutUsage = { ...provider, usage: {} }; const test = setup({ fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify(withoutUsage), { status: 200 })) as typeof fetch });
    const response = await handleDraftRequest(request({ detail: "low", candidates: [{ images: [base64] }] }), test.deps);
    expect(response.status).toBe(200); expect(test.rpc).toHaveBeenLastCalledWith("complete_ai_drafting_attempt", expect.objectContaining({ supplied_status: "unknown_usage", supplied_failure_kind: "usage" }));
  });
  it("retries only the idempotent completion record once after a transient database failure", async () => {
    let completionCalls = 0;
    const rpc = vi.fn().mockImplementation((name: string) => {
      if (name === "reserve_ai_drafting_attempt") return Promise.resolve({ data: [{ model: "gpt-5.6-luna", service_tier: "standard" }], error: null });
      if (name === "complete_ai_drafting_attempt" && completionCalls++ === 0) return Promise.resolve({ data: null, error: { message: "temporary" } });
      return Promise.resolve({ data: null, error: null });
    });
    const test = setup({ rpc }); const response = await handleDraftRequest(request({ detail: "low", candidates: [{ images: [base64] }] }), test.deps);
    expect(response.status).toBe(200); expect(rpc.mock.calls.filter(([name]) => name === "complete_ai_drafting_attempt")).toHaveLength(2); expect(test.fetcher).toHaveBeenCalledTimes(1);
  });
  it("records generic fetch failure as network rather than member input", async () => {
    const test = setup({ fetcher: vi.fn().mockRejectedValue(new TypeError("fetch failed")) as typeof fetch });
    const response = await handleDraftRequest(request({ detail: "low", candidates: [{ images: [base64] }] }), test.deps);
    expect((await response.json()).code).toBe("network"); expect(test.rpc).toHaveBeenLastCalledWith("complete_ai_drafting_attempt", expect.objectContaining({ supplied_status: "unknown_usage", supplied_failure_kind: "network" }));
  });
  it("fails closed when server secrets disappear and never starts provider work", async () => {
    const test = setup({ env: (name) => name === "GEAR_SHARE_APP_ORIGIN" ? "https://gear.example.test" : undefined });
    const response = await handleDraftRequest(request({ detail: "low", candidates: [{ images: [base64] }] }), test.deps);
    expect(response.status).toBe(503); expect(test.fetcher).not.toHaveBeenCalled();
    expect(test.rpc).not.toHaveBeenCalledWith("mark_ai_drafting_provider_started", expect.anything());
  });
  it("requires a dedicated adequately bounded safety secret", async () => {
    const shared = `sk-${"x".repeat(40)}`;
    for (const secret of ["short", shared]) {
      const test = setup({ env: (name) => ({ GEAR_SHARE_APP_ORIGIN: "https://gear.example.test", OPENAI_API_KEY: shared, OPENAI_SAFETY_IDENTIFIER_SECRET: secret } as Record<string,string>)[name] });
      const response = await handleDraftRequest(request({ detail: "low", candidates: [{ images: [base64] }] }), test.deps);
      expect(response.status).toBe(503); expect(test.fetcher).not.toHaveBeenCalled();
      expect(test.rpc).not.toHaveBeenCalledWith("mark_ai_drafting_provider_started", expect.anything());
    }
  });
  it("chunk-encodes the maximum bounded derivative without argument overflow", () => {
    const bytes = new Uint8Array(512 * 1024); bytes[0] = 1; bytes[bytes.length - 1] = 2;
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (character) => character.charCodeAt(0));
    expect(decoded.length).toBe(bytes.length); expect(decoded[0]).toBe(1); expect(decoded.at(-1)).toBe(2);
  });
});
