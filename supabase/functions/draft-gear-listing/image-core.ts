import { jpegDimensions, MAX_AI_IMAGE_BYTES, MAX_AI_IMAGE_EDGE, MAX_AI_IMAGE_PIXELS } from "./image-header.ts";

export type AiImageData = { width: number; height: number; data: Uint8ClampedArray };
export type AiImageCodecs = {
  decode(bytes: ArrayBuffer): Promise<AiImageData>;
  resize(image: AiImageData, dimensions: { width: number; height: number }): Promise<AiImageData>;
  encode(image: AiImageData, quality: number): Promise<ArrayBuffer>;
};

export async function sanitizeAiJpegWithCodecs(bytes: Uint8Array, codecs: AiImageCodecs) {
  const header = jpegDimensions(bytes);
  let decoded = await codecs.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (!((decoded.width === header.width && decoded.height === header.height) || (decoded.width === header.height && decoded.height === header.width))) throw new Error("invalid_image");
  const scale = Math.min(1, MAX_AI_IMAGE_EDGE / decoded.width, MAX_AI_IMAGE_EDGE / decoded.height, Math.sqrt(MAX_AI_IMAGE_PIXELS / (decoded.width * decoded.height)));
  if (scale < 1) decoded = await codecs.resize(decoded, { width: Math.max(1, Math.floor(decoded.width * scale)), height: Math.max(1, Math.floor(decoded.height * scale)) });
  for (const quality of [82, 72, 62, 52, 44]) { const output = new Uint8Array(await codecs.encode(decoded, quality)); if (output.byteLength <= MAX_AI_IMAGE_BYTES) { jpegDimensions(output, true); return output; } }
  throw new Error("invalid_image");
}
