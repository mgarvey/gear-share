import decodeJpeg from "npm:@jsquash/jpeg@1.6.0/decode.js";
import encodeJpeg from "npm:@jsquash/jpeg@1.6.0/encode.js";
import resizeImage from "npm:@jsquash/resize@2.1.1";
import { createClient } from "npm:@supabase/supabase-js@2.50.0";

const MAX_REQUEST_BYTES = 4096;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_HEADER_BYTES = 256 * 1024;
const MAX_SOURCE_PIXELS = 25_000_000;
const MAX_SOURCE_EDGE = 10_000;
const MAX_STAGED_DECODE_PIXELS = 4_000_000;
const MAX_STAGED_DECODE_EDGE = 1_600;
const MAX_OUTPUT_PIXELS = 4_000_000;
const MAX_OUTPUT_EDGE = 1_600;

function corsHeaders(request: Request): Record<string, string> | null {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  const configured = Deno.env.get("GEAR_SHARE_APP_ORIGIN");
  if (!configured) return null;
  try {
    if (new URL(configured).origin !== configured || origin !== configured) return null;
  } catch {
    return null;
  }
  return { "access-control-allow-origin": configured, vary: "Origin" };
}

function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json", "cache-control": "no-store" } });
}

async function boundedJson(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_REQUEST_BYTES) throw new Error("request too large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("request body required");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) { await reader.cancel(); throw new Error("request too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes)) as { attemptId?: string; sourceDigest?: string };
}

function jpegDimensions(bytes: Uint8Array, maxEdge = MAX_SOURCE_EDGE, maxPixels = MAX_SOURCE_PIXELS, rejectMetadata = false) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("staged object is not JPEG");
  let offset = 2;
  let dimensions: { width: number; height: number } | undefined;
  while (offset < Math.min(bytes.length, MAX_HEADER_BYTES)) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda || marker === undefined) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw new Error("truncated JPEG header");
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length || offset + length > MAX_HEADER_BYTES) throw new Error("malformed JPEG header");
    if (rejectMetadata && (marker === 0xfe || (marker >= 0xe1 && marker <= 0xef))) throw new Error("sanitized JPEG contains metadata");
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 7) throw new Error("malformed JPEG dimensions");
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (width <= 0 || height <= 0 || width > maxEdge || height > maxEdge || width * height > maxPixels) {
        throw new Error("JPEG dimensions exceed the bounded source limit");
      }
      dimensions = { width, height };
    }
    offset += length;
  }
  if (dimensions) return dimensions;
  throw new Error("JPEG dimensions unavailable within bounded inspection");
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (cors === null) return json(403, { error: "origin not allowed" });
  if (request.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: { ...cors, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type", "access-control-max-age": "600" },
  });
  const respond = (status: number, body: Record<string, unknown>) => json(status, body, cors);
  if (request.method !== "POST") return respond(405, { error: "method not allowed" });
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return respond(401, { error: "authentication required" });
  try {
    const body = await boundedJson(request);
    if (!body.attemptId || !/^[0-9a-f-]{36}$/i.test(body.attemptId) || !body.sourceDigest || !/^[0-9a-f]{64}$/.test(body.sourceDigest)) {
      return respond(400, { error: "valid attempt and digest required" });
    }
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("server configuration unavailable");
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const service = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: attempt, error: attemptError } = await caller.from("gear_media_upload_attempts")
      .select("id, community_id, supply_id, source_digest, staging_path, final_path, status")
      .eq("id", body.attemptId).maybeSingle();
    if (attemptError || !attempt) return respond(404, { error: "upload attempt unavailable" });
    if (attempt.source_digest !== body.sourceDigest) return respond(409, { error: "upload digest mismatch" });
    if (attempt.status === "complete") return respond(200, { path: attempt.final_path, recovered: true });
    if (attempt.status !== "pending") return respond(409, { error: "upload attempt unavailable" });

    const { data: staged, error: stagedError } = await service.storage.from("gear-image-staging").download(attempt.staging_path);
    if (stagedError || !staged) return respond(422, { error: "staged image unavailable" });
    if (staged.size > MAX_SOURCE_BYTES) return respond(413, { error: "staged image exceeds 10 MiB" });
    const source = new Uint8Array(await staged.arrayBuffer());
    const header = jpegDimensions(source, MAX_STAGED_DECODE_EDGE, MAX_STAGED_DECODE_PIXELS);
    let decoded = await decodeJpeg(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), { preserveOrientation: true });
    if (!((decoded.width === header.width && decoded.height === header.height) || (decoded.width === header.height && decoded.height === header.width))) {
      throw new Error("decoded dimensions do not match the JPEG header");
    }
    const scale = Math.min(1, MAX_OUTPUT_EDGE / decoded.width, Math.sqrt(MAX_OUTPUT_PIXELS / (decoded.width * decoded.height)));
    if (scale < 1) decoded = await resizeImage(decoded, { width: Math.max(1, Math.floor(decoded.width * scale)), height: Math.max(1, Math.floor(decoded.height * scale)) });
    let output: Uint8Array | undefined;
    for (const quality of [85, 76, 68, 60, 52]) {
      output = new Uint8Array(await encodeJpeg(decoded, { quality }));
      if (output.byteLength <= MAX_OUTPUT_BYTES) break;
    }
    if (!output || output.byteLength > MAX_OUTPUT_BYTES) return respond(422, { error: "sanitized image cannot meet output bounds" });
    jpegDimensions(output, MAX_OUTPUT_EDGE, MAX_OUTPUT_PIXELS, true);
    const finalPath = `${attempt.community_id}/${attempt.supply_id}/${attempt.id}.jpg`;
    const upload = await service.storage.from("gear-images").upload(finalPath, output, { contentType: "image/jpeg", upsert: false });
    if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) throw upload.error;
    const commit = await caller.rpc("commit_sanitized_gear_image", {
      supplied_attempt_id: attempt.id,
      supplied_source_digest: body.sourceDigest,
      supplied_final_path: finalPath,
    });
    if (commit.error) throw commit.error;
    await service.storage.from("gear-image-staging").remove([attempt.staging_path]);
    return respond(200, { path: finalPath, recovered: Boolean(upload.error) });
  } catch {
    return respond(422, { error: "image sanitization failed" });
  }
});
