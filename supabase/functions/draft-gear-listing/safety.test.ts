import { describe, expect, it } from "vitest";
import { hmacSafetyIdentifier } from "./safety";

describe("AI safety identifier", () => {
  it("is deterministic, lowercase, bounded, and does not expose the user id", async () => {
    const userId = "00000000-0000-4000-8000-000000000008";
    const first = await hmacSafetyIdentifier("dedicated-secret", userId);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(await hmacSafetyIdentifier("dedicated-secret", userId));
    expect(first).not.toContain(userId);
    expect(first).not.toBe(await hmacSafetyIdentifier("another-secret", userId));
  });
});
