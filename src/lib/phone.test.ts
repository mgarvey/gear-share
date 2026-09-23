import { describe, expect, it } from "vitest";
import { formatUsPhone, toUsPhoneE164 } from "@/lib/phone";

describe("US phone helpers", () => {
  it("formats saved and typed phone numbers", () => {
    expect(formatUsPhone("+15125550123")).toBe("(512) 555-0123");
    expect(formatUsPhone("5125550")).toBe("(512) 555-0");
  });

  it("stores a complete number in the server format", () => {
    expect(toUsPhoneE164("(512) 555-0123")).toBe("+15125550123");
    expect(toUsPhoneE164("")).toBe("");
    expect(() => toUsPhoneE164("512-555")).toThrow("Enter a 10-digit phone number.");
  });
});
