import { describe, expect, it } from "vitest";
import { decodeBase64Jpeg, jpegDimensions, MAX_AI_IMAGE_BYTES } from "./image-header";
const jpeg = (width: number, height: number) => Uint8Array.from([0xff,0xd8,0xff,0xc0,0,11,8,height >> 8,height & 255,width >> 8,width & 255,1,1,0,0,0xff,0xd9]);
describe("AI JPEG bounds", () => {
  it("accepts bounded JPEG dimensions", () => expect(jpegDimensions(jpeg(1024,1024))).toEqual({ width: 1024, height: 1024 }));
  it("rejects oversized dimensions and bytes before decode", () => { expect(() => jpegDimensions(jpeg(1025,1))).toThrow("invalid_image"); expect(() => jpegDimensions(new Uint8Array(MAX_AI_IMAGE_BYTES + 1))).toThrow("invalid_image"); });
  it("rejects malformed base64", () => expect(() => decodeBase64Jpeg("https://example.test/image.jpg")).toThrow("invalid_image"));
  it("rejects short or internally inconsistent SOF segments before decode", () => {
    expect(() => jpegDimensions(Uint8Array.from([0xff,0xd8,0xff,0xc0,0,7,8,0,1,0,1,0xff,0xd9]))).toThrow("invalid_image");
    expect(() => jpegDimensions(Uint8Array.from([0xff,0xd8,0xff,0xc0,0,11,8,0,1,0,1,2,1,0,0,0xff,0xd9]))).toThrow("invalid_image");
  });
});
