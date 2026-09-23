import { describe, expect, it, vi } from "vitest";
import { sanitizeAiJpegWithCodecs } from "./image-core";

const output = Uint8Array.from([0xff,0xd8,0xff,0xc0,0,11,8,0,1,0,1,1,1,0,0,0xff,0xd9]);
const inputWithMetadata = Uint8Array.from([0xff,0xd8,0xff,0xe1,0,6,1,2,3,4,...output.slice(2)]);

describe("AI image conversion", () => {
  it("validates before decode and returns only a newly encoded bounded JPEG", async () => {
    const decode = vi.fn().mockResolvedValue({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
    const encode = vi.fn().mockResolvedValue(output.buffer);
    const converted = await sanitizeAiJpegWithCodecs(inputWithMetadata, { decode, resize: vi.fn(), encode });
    expect(decode).toHaveBeenCalledTimes(1); expect(encode).toHaveBeenCalledWith(expect.anything(), 82);
    expect(converted).toEqual(output); expect([...converted]).not.toEqual([...inputWithMetadata]);
    expect([...converted]).not.toContain(0xe1);
  });
  it("never calls the decoder for a malformed short SOF", async () => {
    const decode = vi.fn();
    await expect(sanitizeAiJpegWithCodecs(Uint8Array.from([0xff,0xd8,0xff,0xc0,0,4,8,0,1,0,1,0xff,0xd9]), { decode, resize: vi.fn(), encode: vi.fn() })).rejects.toThrow("invalid_image");
    expect(decode).not.toHaveBeenCalled();
  });
});
