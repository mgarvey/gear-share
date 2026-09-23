export const MAX_AI_IMAGE_BYTES = 512 * 1024;
export const MAX_AI_IMAGE_EDGE = 1024;
export const MAX_AI_IMAGE_PIXELS = 1_048_576;
const MAX_HEADER_BYTES = 256 * 1024;

export function jpegDimensions(bytes: Uint8Array, rejectMetadata = false) {
  if (bytes.byteLength > MAX_AI_IMAGE_BYTES || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("invalid_image");
  let offset = 2; let dimensions: { width: number; height: number } | undefined;
  while (offset < Math.min(bytes.length, MAX_HEADER_BYTES)) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]; if (marker === 0xd9 || marker === 0xda || marker === undefined) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw new Error("invalid_image");
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length || offset + length > MAX_HEADER_BYTES) throw new Error("invalid_image");
    if (rejectMetadata && (marker === 0xfe || (marker >= 0xe1 && marker <= 0xef))) throw new Error("invalid_image");
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 11 || offset + 8 > bytes.length) throw new Error("invalid_image");
      const height = bytes[offset + 3] * 256 + bytes[offset + 4]; const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      const components = bytes[offset + 7];
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
        || components < 1 || components > 4 || length !== 8 + 3 * components
        || width < 1 || height < 1 || width > MAX_AI_IMAGE_EDGE
        || height > MAX_AI_IMAGE_EDGE || width * height > MAX_AI_IMAGE_PIXELS) throw new Error("invalid_image");
      dimensions = { width, height };
    }
    offset += length;
  }
  if (!dimensions) throw new Error("invalid_image"); return dimensions;
}

export function decodeBase64Jpeg(value: unknown) {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_AI_IMAGE_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("invalid_image");
  const raw = atob(value); const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0)); jpegDimensions(bytes); return bytes;
}
