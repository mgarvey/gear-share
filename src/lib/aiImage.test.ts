import { describe, expect, it, vi } from "vitest";
import { createAiImageDerivative } from "@/lib/aiImage";
import { SOURCE_IMAGE_MAX_BYTES } from "@/lib/safeImage";

describe("AI image derivative", () => {
  it("retains the 10 MiB pre-decode rejection", async () => {
    const decode = vi.fn(); vi.stubGlobal("createImageBitmap", decode);
    const file = new File([new Uint8Array(SOURCE_IMAGE_MAX_BYTES + 1)], "large.jpg", { type: "image/jpeg" });
    await expect(createAiImageDerivative(file)).rejects.toThrow("larger than 10 MiB");
    expect(decode).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });

  it("decodes the already prepared picker file only once", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 100, 0, 100, 3, 1, 1, 0, 2, 1, 0, 3, 1, 0]);
    const file = new File([bytes], "prepared.jpg", { type: "image/jpeg" });
    const close = vi.fn();
    const decode = vi.fn().mockResolvedValue({ width: 100, height: 100, close });
    vi.stubGlobal("createImageBitmap", decode);

    await expect(createAiImageDerivative(file)).rejects.toThrow("conversion is unavailable");
    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
    expect(close).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("accepts a valid derivative larger than the header inspection window", async () => {
    const sourceBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 100, 0, 100, 3, 1, 1, 0, 2, 1, 0, 3, 1, 0, 0xff, 0xd9]);
    const source = new File([sourceBytes], "prepared.jpg", { type: "image/jpeg" });
    const derivativeHeader = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe2, 0, 4, 1, 2,
      0xff, 0xc0, 0, 17, 8, 0, 100, 0, 100, 3, 1, 1, 0, 2, 1, 0, 3, 1, 0,
      0xff, 0xd9,
    ]);
    const derivative = new Uint8Array(300 * 1024);
    derivative.set(derivativeHeader);
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 100, height: 100, close }));
    const toBlob = vi.fn((callback: BlobCallback) => callback(new Blob([derivative], { type: "image/jpeg" })));
    vi.spyOn(document, "createElement").mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() }),
      toBlob,
    } as unknown as HTMLCanvasElement);

    await expect(createAiImageDerivative(source)).resolves.toHaveLength(300 * 1024);
    expect(close).toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
