import { describe, expect, it } from "vitest";
import { buildOpenAiActivationBody, buildOpenAiBody, parseOpenAiResponse, parseOpenAiUsage, readBoundedResponse } from "./openai";
describe("OpenAI draft adapter", () => {
  it("maps internal Standard processing to the API default tier and pins no-storage no-tools low-detail structured output", () => { const body = buildOpenAiBody([["abc"]], "a".repeat(64)); expect(body).toMatchObject({ model: "gpt-5.6-luna", service_tier: "default", store: false, tools: [] }); expect(body.input[0].content[0].text).toContain("useful household or group equipment"); expect(body.input[0].content[0].text).toContain("Choose other-gear"); expect(body.input[0].content[0].text).not.toContain("only the pictured scouting or outdoor item"); expect(body.input[0].content[1]).toMatchObject({ type: "input_image", detail: "low" }); expect(body.text.format.strict).toBe(true); });
  it("uses a fixed synthetic image and a provider-supported union for the bounded activation check", () => { const body = buildOpenAiActivationBody("a".repeat(64)); expect(body.input[0].content[1].image_url).toMatch(/^data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABA/); expect(body.input[0].content[1].detail).toBe("low"); expect(body.text.format.strict).toBe(true); expect(body.text.format.schema.properties.results.items.anyOf).toHaveLength(2); expect(body.text.format.schema.properties.results.items.oneOf).toBeUndefined(); });
  it("rejects extra authority fields and count mismatch", () => { const response = (result: any) => ({ id: "resp_fixture", status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ results: [result] }) }] }], usage: { input_tokens: 1, output_tokens: 1 } }); expect(() => parseOpenAiResponse(response({ kind: "draft", title: "Tent", description: "", category: "tents-shelters", condition: "good" }), 1)).toThrow("schema"); expect(() => parseOpenAiResponse(response({ kind: "draft", title: "Tent", description: "", category: "tents-shelters" }), 2)).toThrow("schema"); });
  it("accepts explicit needs-manual while usage is validated independently", () => { const response = { id: "resp_fixture", status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ results: [{ kind: "needs_manual", reason: "unclear_item" }] }) }] }], usage: {} }; const parsed = parseOpenAiResponse(response, 1); expect(parsed.results[0]).toEqual({ kind: "needs_manual", reason: "unclear_item" }); expect(parseOpenAiUsage(response)).toBeNull(); });
  it("recognizes exact cached and reasoning usage and rejects partial or inconsistent tuples", () => {
    expect(parseOpenAiUsage({ usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 10 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 4 }, total_tokens: 120 } })).toEqual({ inputTokens: 100, cachedInputTokens: 10, outputTokens: 20, reasoningOutputTokens: 4 });
    expect(parseOpenAiUsage({ usage: { input_tokens: 100, output_tokens: 20 } })).toBeNull();
    expect(parseOpenAiUsage({ usage: { input_tokens: 5, input_tokens_details: { cached_tokens: 6 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 4 } } })).toBeNull();
    expect(parseOpenAiUsage({ usage: { input_tokens: 100001, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 4 } } })).toBeNull();
    expect(parseOpenAiUsage({ usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 2401, output_tokens_details: { reasoning_tokens: 4 } } })).toBeNull();
    expect(parseOpenAiUsage({ usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0, future_billable_tokens: 1 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 4 }, total_tokens: 120 } })).toBeNull();
  });
  it("rejects refusals, truncation, and malformed provider identifiers", () => {
    expect(() => parseOpenAiResponse({ id: "resp_fixture", status: "completed", output: [{ content: [{ type: "refusal", refusal: "no" }] }] }, 1)).toThrow("refusal");
    expect(() => parseOpenAiResponse({ id: "resp_fixture", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }, 1)).toThrow("truncated");
    expect(() => parseOpenAiResponse({ id: "not-reviewed", status: "completed", output: [] }, 1)).toThrow("schema");
  });
  it("bounds streamed provider responses before parsing", async () => {
    const response = new Response("x", { headers: { "content-length": String(64 * 1024 + 1) } });
    await expect(readBoundedResponse(response)).rejects.toThrow("provider");
  });
});
