import decodeJpeg from "npm:@jsquash/jpeg@1.6.0/decode.js";
import encodeJpeg from "npm:@jsquash/jpeg@1.6.0/encode.js";
import resizeImage from "npm:@jsquash/resize@2.1.1";
import { sanitizeAiJpegWithCodecs } from "./image-core.ts";

export async function sanitizeAiJpeg(bytes: Uint8Array) {
  return sanitizeAiJpegWithCodecs(bytes, {
    decode: (input) => decodeJpeg(input, { preserveOrientation: true }),
    resize: (image, dimensions) => resizeImage(image, dimensions),
    encode: (image, quality) => encodeJpeg(image, { quality }),
  });
}
