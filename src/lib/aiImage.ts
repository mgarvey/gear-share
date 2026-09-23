import { IMAGE_HEADER_MAX_BYTES, inspectImageHeader, preflightSelectedImage } from "@/lib/safeImage";

export const AI_IMAGE_MAX_BYTES = 512 * 1024;
export const AI_IMAGE_MAX_EDGE = 1024;
export const AI_IMAGE_MAX_PIXELS = 1_048_576;

export async function createAiImageDerivative(source: File) {
  await preflightSelectedImage(source);
  // Photo pickers already produce a metadata-free JPEG. Decode that prepared
  // file once here instead of running the full ordinary conversion a second
  // time, which is unreliable and unnecessarily expensive on mobile Safari.
  const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, AI_IMAGE_MAX_EDGE / bitmap.width, AI_IMAGE_MAX_EDGE / bitmap.height, Math.sqrt(AI_IMAGE_MAX_PIXELS / (bitmap.width * bitmap.height)));
    let width = Math.max(1, Math.floor(bitmap.width * scale)); let height = Math.max(1, Math.floor(bitmap.height * scale));
    for (const quality of [0.8, 0.7, 0.6, 0.5, 0.42]) {
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false }); if (!context) throw new Error("AI photo conversion is unavailable.");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height); context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob) throw new Error("AI photo conversion failed.");
      if (blob.size <= AI_IMAGE_MAX_BYTES) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        // The picker has already rendered the source into a new JPEG, removing
        // the phone photo's metadata. Some browsers add their own color-profile
        // marker when this smaller derivative is rendered; accepting that
        // browser-created marker avoids rejecting valid mobile JPEGs. The Edge
        // Function still performs an independent decode and clean re-encode.
        const header = inspectImageHeader(bytes.subarray(0, IMAGE_HEADER_MAX_BYTES));
        if (header.width > AI_IMAGE_MAX_EDGE || header.height > AI_IMAGE_MAX_EDGE || header.width * header.height > AI_IMAGE_MAX_PIXELS) throw new Error("AI photo dimensions are too large.");
        return bytes;
      }
      width = Math.max(1, Math.floor(width * 0.86)); height = Math.max(1, Math.floor(height * 0.86));
    }
    throw new Error("The AI photo could not meet the 512 KiB limit.");
  } finally { bitmap.close(); }
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
