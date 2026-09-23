export const SOURCE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const DISPLAY_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_HEADER_MAX_BYTES = 256 * 1024;
export const SOURCE_IMAGE_MAX_PIXELS = 25_000_000;
export const SOURCE_IMAGE_MAX_EDGE = 10_000;
export const OUTPUT_IMAGE_MAX_PIXELS = 4_000_000;
export const OUTPUT_IMAGE_MAX_EDGE = 1_600;

export type SupportedImageFormat = "jpeg" | "png" | "webp";

export interface ImageHeader {
  format: SupportedImageFormat;
  width: number;
  height: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function u16be(bytes: Uint8Array, offset: number) {
  if (offset + 2 > bytes.length) fail("The image header is truncated.");
  return bytes[offset] * 256 + bytes[offset + 1];
}

function u24le(bytes: Uint8Array, offset: number) {
  if (offset + 3 > bytes.length) fail("The image header is truncated.");
  return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65_536;
}

function u32be(bytes: Uint8Array, offset: number) {
  if (offset + 4 > bytes.length) fail("The image header is truncated.");
  return bytes[offset] * 16_777_216 + bytes[offset + 1] * 65_536 + bytes[offset + 2] * 256 + bytes[offset + 3];
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  if (offset + length > bytes.length) fail("The image header is truncated.");
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function validateDimensions(format: SupportedImageFormat, width: number, height: number): ImageHeader {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    fail("The image dimensions are invalid.");
  }
  if (width > SOURCE_IMAGE_MAX_EDGE || height > SOURCE_IMAGE_MAX_EDGE || width * height > SOURCE_IMAGE_MAX_PIXELS) {
    fail("The image dimensions are too large.");
  }
  return { format, width, height };
}

function inspectPng(bytes: Uint8Array): ImageHeader {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((value, index) => bytes[index] !== value)) fail("The file is not a valid PNG image.");
  if (u32be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") fail("The PNG header is malformed.");
  return validateDimensions("png", u32be(bytes, 16), u32be(bytes, 20));
}

function inspectWebp(bytes: Uint8Array): ImageHeader {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") fail("The file is not a valid WebP image.");
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    return validateDimensions("webp", u24le(bytes, 24) + 1, u24le(bytes, 27) + 1);
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f || bytes.length < 25) fail("The WebP lossless header is malformed.");
    const bits = bytes[21] + bytes[22] * 256 + bytes[23] * 65_536 + bytes[24] * 16_777_216;
    return validateDimensions("webp", (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8 ") {
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) fail("The WebP lossy header is malformed.");
    return validateDimensions("webp", (bytes[26] + bytes[27] * 256) & 0x3fff, (bytes[28] + bytes[29] * 256) & 0x3fff);
  }
  fail("This WebP variant is not supported.");
}

function inspectJpeg(bytes: Uint8Array, requireMetadataFree: boolean): ImageHeader {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("The file is not a valid JPEG image.");
  let offset = 2;
  let dimensions: ImageHeader | undefined;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segmentLength = u16be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) fail("The JPEG header is malformed or exceeds bounded inspection.");
    if (requireMetadataFree && ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) {
      fail("The stored JPEG contains disallowed metadata.");
    }
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      if (segmentLength < 7) fail("The JPEG dimensions are malformed.");
      dimensions = validateDimensions("jpeg", u16be(bytes, offset + 5), u16be(bytes, offset + 3));
    }
    offset += segmentLength;
  }
  if (dimensions) return dimensions;
  fail("JPEG dimensions were not found within bounded header inspection.");
}

export function inspectImageHeader(bytes: Uint8Array, options: { requireMetadataFreeJpeg?: boolean } = {}): ImageHeader {
  if (bytes.byteLength > IMAGE_HEADER_MAX_BYTES) fail("Image header inspection exceeded its byte limit.");
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return inspectJpeg(bytes, options.requireMetadataFreeJpeg === true);
  if (bytes[0] === 137 && bytes[1] === 80) return inspectPng(bytes);
  if (ascii(bytes, 0, Math.min(4, bytes.length)) === "RIFF") return inspectWebp(bytes);
  fail("Choose a JPEG, PNG, or WebP image.");
}

async function boundedHeader(blob: Blob) {
  return new Uint8Array(await blob.slice(0, IMAGE_HEADER_MAX_BYTES).arrayBuffer());
}

export async function preflightSelectedImage(file: File): Promise<ImageHeader> {
  if (file.size > SOURCE_IMAGE_MAX_BYTES) fail("This photo is larger than 10 MiB.");
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) fail("Choose a JPEG, PNG, or WebP image.");
  const header = inspectImageHeader(await boundedHeader(file));
  if (header.format !== file.type.replace("image/", "").replace("jpg", "jpeg")) fail("The photo type does not match its contents.");
  return header;
}

export async function convertSelectedImage(file: File): Promise<{ blob: Blob; header: ImageHeader }> {
  const header = await preflightSelectedImage(file);
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(
      1,
      OUTPUT_IMAGE_MAX_EDGE / bitmap.width,
      OUTPUT_IMAGE_MAX_EDGE / bitmap.height,
      Math.sqrt(OUTPUT_IMAGE_MAX_PIXELS / (bitmap.width * bitmap.height)),
    );
    let width = Math.max(1, Math.round(bitmap.width * scale));
    let height = Math.max(1, Math.round(bitmap.height * scale));
    let quality = 0.86;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) fail("Photo conversion is unavailable in this browser.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob) fail("The photo could not be converted.");
      if (blob.size <= DISPLAY_IMAGE_MAX_BYTES) return { blob, header };
      if (quality > 0.58) quality -= 0.08;
      else { width = Math.max(1, Math.floor(width * 0.85)); height = Math.max(1, Math.floor(height * 0.85)); }
    }
    fail("The converted photo could not meet the 2 MiB limit.");
  } finally {
    bitmap.close();
  }
}

export async function readSafePrivateImage(response: Response): Promise<string> {
  if (!response.ok) fail("Photo unavailable.");
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > DISPLAY_IMAGE_MAX_BYTES) fail("Photo unavailable.");
  const reader = response.body?.getReader();
  if (!reader) fail("Photo unavailable.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > DISPLAY_IMAGE_MAX_BYTES) { await reader.cancel(); fail("Photo unavailable."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const headerBytes = bytes.subarray(0, Math.min(bytes.length, IMAGE_HEADER_MAX_BYTES));
  const header = inspectImageHeader(headerBytes, { requireMetadataFreeJpeg: true });
  if (header.format !== "jpeg") fail("Photo unavailable.");
  return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
}
