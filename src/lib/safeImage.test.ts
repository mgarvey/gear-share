import { describe, expect, it, vi } from "vitest";
import { convertSelectedImage, DISPLAY_IMAGE_MAX_BYTES, IMAGE_HEADER_MAX_BYTES, inspectImageHeader, OUTPUT_IMAGE_MAX_EDGE, preflightSelectedImage, readSafePrivateImage, SOURCE_IMAGE_MAX_BYTES } from "@/lib/safeImage";

function png(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function jpeg(width: number, height: number, metadata = false) {
  const prefix = metadata ? [0xff, 0xd8, 0xff, 0xe1, 0, 4, 1, 2] : [0xff, 0xd8];
  return new Uint8Array([...prefix, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 1, 0, 2, 1, 0, 3, 1, 0]);
}

function webp(width: number, height: number) {
  const bytes = new Uint8Array(30);
  bytes.set([82, 73, 70, 70], 0);
  bytes.set([87, 69, 66, 80], 8);
  bytes.set([86, 80, 56, 88], 12);
  const view = new DataView(bytes.buffer);
  view.setUint8(24, (width - 1) & 255);
  view.setUint8(25, ((width - 1) >> 8) & 255);
  view.setUint8(26, ((width - 1) >> 16) & 255);
  view.setUint8(27, (height - 1) & 255);
  view.setUint8(28, ((height - 1) >> 8) & 255);
  view.setUint8(29, ((height - 1) >> 16) & 255);
  return bytes;
}

describe("bounded image header inspection", () => {
  it("reads PNG and JPEG dimensions without a decoder", () => {
    expect(inspectImageHeader(png(1600, 1200))).toMatchObject({ format: "png", width: 1600, height: 1200 });
    expect(inspectImageHeader(jpeg(800, 600))).toMatchObject({ format: "jpeg", width: 800, height: 600 });
  });

  it("supports bounded WebP headers and exact dimension boundaries", () => {
    expect(inspectImageHeader(webp(1600, 1200))).toMatchObject({ format: "webp", width: 1600, height: 1200 });
    expect(inspectImageHeader(png(5000, 5000))).toMatchObject({ width: 5000, height: 5000 });
    expect(inspectImageHeader(png(10_000, 1))).toMatchObject({ width: 10_000, height: 1 });
    expect(() => inspectImageHeader(png(5001, 5000))).toThrow("dimensions are too large");
    expect(() => inspectImageHeader(png(10_001, 1))).toThrow("dimensions are too large");
  });

  it("rejects decompression-bomb dimensions", () => {
    expect(() => inspectImageHeader(png(10_000, 3_000))).toThrow("dimensions are too large");
  });

  it("rejects metadata in a final stored JPEG", () => {
    expect(() => inspectImageHeader(jpeg(800, 600, true), { requireMetadataFreeJpeg: true })).toThrow("disallowed metadata");
    expect(() => inspectImageHeader(new Uint8Array([...jpeg(800, 600), 0xff, 0xe2, 0, 4, 1, 2, 0xff, 0xda]), { requireMetadataFreeJpeg: true })).toThrow("disallowed metadata");
  });

  it("rejects oversized files before reading their header", async () => {
    const file = new File([new Uint8Array(SOURCE_IMAGE_MAX_BYTES + 1)], "large.jpg", { type: "image/jpeg" });
    const slice = vi.spyOn(file, "slice");
    await expect(preflightSelectedImage(file)).rejects.toThrow("larger than 10 MiB");
    expect(slice).not.toHaveBeenCalled();
  });

  it("rejects an oversized selection before invoking the full decoder", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    const file = new File([new Uint8Array(SOURCE_IMAGE_MAX_BYTES + 1)], "large.jpg", { type: "image/jpeg" });
    await expect(convertSelectedImage(file)).rejects.toThrow("larger than 10 MiB");
    expect(decode).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("bounds both edges when preparing a portrait phone photo", async () => {
    const file = new File([png(3000, 4000)], "portrait.png", { type: "image/png" });
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 3000, height: 4000, close }));
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() }),
      toBlob: (callback: BlobCallback) => callback(new Blob([jpeg(1200, 1600)], { type: "image/jpeg" })),
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, "createElement").mockReturnValue(canvas);

    await expect(convertSelectedImage(file)).resolves.toBeDefined();
    expect(canvas.width).toBeLessThanOrEqual(OUTPUT_IMAGE_MAX_EDGE);
    expect(canvas.height).toBeLessThanOrEqual(OUTPUT_IMAGE_MAX_EDGE);
    expect(canvas).toMatchObject({ width: 1200, height: 1600 });
    expect(close).toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects claimed MIME mismatches and truncated headers", async () => {
    await expect(preflightSelectedImage(new File([png(20, 20)], "wrong.jpg", { type: "image/jpeg" }))).rejects.toThrow("does not match");
    expect(() => inspectImageHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 20]))).toThrow("malformed");
  });

  it("rejects unsafe private responses before creating an object URL", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fixture");
    await expect(readSafePrivateImage(new Response(new Uint8Array(), { headers: { "content-length": String(DISPLAY_IMAGE_MAX_BYTES + 1) } }))).rejects.toThrow("Photo unavailable");
    await expect(readSafePrivateImage(new Response(png(5001, 5000)))).rejects.toThrow("dimensions are too large");
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it("creates an object URL only after a private JPEG passes bounded validation", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:safe");
    await expect(readSafePrivateImage(new Response(jpeg(800, 600)))).resolves.toBe("blob:safe");
    expect(create).toHaveBeenCalledOnce();
    create.mockRestore();
  });

  it("rejects inspection buffers over the fixed ceiling", () => {
    expect(() => inspectImageHeader(new Uint8Array(IMAGE_HEADER_MAX_BYTES + 1))).toThrow("exceeded its byte limit");
  });
});
