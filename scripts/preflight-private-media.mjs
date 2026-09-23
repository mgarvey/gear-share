import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_HEADER_BYTES = 256 * 1024;
const MAX_PIXELS = 4_000_000;
const MAX_EDGE = 1_600;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

function jpegIssue(bytes) {
  if (bytes.length > MAX_BYTES) return "over_2_mib";
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return "not_jpeg";
  let offset = 2;
  let dimensionsFound = false;
  while (offset < Math.min(bytes.length, MAX_HEADER_BYTES)) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda || marker === undefined) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return "malformed_jpeg";
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length || offset + length > MAX_HEADER_BYTES) return "malformed_jpeg";
    if (marker === 0xfe || (marker >= 0xe1 && marker <= 0xef)) return "metadata_present";
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 7) return "malformed_jpeg";
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (width <= 0 || height <= 0 || width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) return "unsafe_dimensions";
      dimensionsFound = true;
    }
    offset += length;
  }
  return dimensionsFound ? null : "dimensions_unavailable";
}

function localStatus() {
  const status = spawnSync("supabase", ["status", "-o", "env"], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DOCKER_API_VERSION: "1.43" },
  });
  if (status.status !== 0) throw new Error("Unable to inspect the local gear share stack. Run npm run db:start first.");
  const setting = (name) => {
    const match = status.stdout.match(new RegExp(`^${name}="([^"]+)"$`, "m"));
    if (!match) throw new Error(`Local Supabase status did not provide ${name}`);
    return match[1];
  };
  return { apiUrl: setting("API_URL"), serviceKey: setting("SERVICE_ROLE_KEY") };
}

function readInventory() {
  const discovery = spawnSync("docker", ["ps", "--filter", "label=com.supabase.cli.project=community-gear-lending", "--filter", "name=supabase_db_", "--format", "{{.Names}}"], { encoding: "utf8" });
  const containers = discovery.stdout.trim().split("\n").filter(Boolean);
  if (discovery.status !== 0 || containers.length !== 1) throw new Error(`Expected one local gear share database container; found ${containers.length}`);
  const sql = `
select json_build_object(
  'supplies', coalesce((select json_agg(json_build_object('id', id, 'communityId', community_id, 'paths', image_paths)) from public.supplies where cardinality(image_paths) > 0), '[]'::json),
  'objects', coalesce((select json_agg(json_build_object('name', name, 'mimeType', metadata->>'mimetype', 'size', metadata->>'size')) from storage.objects where bucket_id = 'gear-images'), '[]'::json)
)::text;
`;
  const result = spawnSync("docker", ["exec", "-i", containers[0], "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: sql, encoding: "utf8" });
  if (result.status !== 0) throw new Error("Unable to read local private-media inventory.");
  return JSON.parse(result.stdout.trim());
}

const { apiUrl, serviceKey } = localStatus();
const inventory = readInventory();
const service = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const objects = new Map(inventory.objects.map((object) => [object.name, object]));
const counts = new Map();
const affected = new Set();
const add = (issue, supplyId) => {
  counts.set(issue, (counts.get(issue) ?? 0) + 1);
  affected.add(supplyId);
};

for (const supply of inventory.supplies) {
  const paths = Array.isArray(supply.paths) ? supply.paths : [];
  if (paths.length > 4) add("over_four", supply.id);
  if (new Set(paths).size !== paths.length) add("duplicate", supply.id);
  const expectedPrefix = `${supply.communityId}/${supply.id}/`;
  const exactPath = new RegExp(`^${UUID}/${UUID}/${UUID}\\.jpg$`);
  for (const path of paths) {
    if (typeof path !== "string" || path.trim() === "") { add("blank", supply.id); continue; }
    if (path !== path.trim() || path.includes("\\\\") || path.includes("//") || path.includes("/./") || path.includes("/../") || path !== path.toLowerCase()) add("non_normalized", supply.id);
    if (!path.startsWith(expectedPrefix)) add("foreign_prefix", supply.id);
    if (!exactPath.test(path)) add("noncanonical_name", supply.id);
    const object = objects.get(path);
    if (!object) { add("missing", supply.id); continue; }
    if (object.mimeType !== "image/jpeg") add("wrong_type", supply.id);
    if (!Number.isFinite(Number(object.size)) || Number(object.size) > MAX_BYTES) add("over_2_mib", supply.id);
    const downloaded = await service.storage.from("gear-images").download(path);
    if (downloaded.error || !downloaded.data) { add("unreadable", supply.id); continue; }
    const issue = jpegIssue(new Uint8Array(await downloaded.data.arrayBuffer()));
    if (issue) add(issue, supply.id);
  }
}

const report = Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
process.stdout.write(`${JSON.stringify({ checkedListings: inventory.supplies.length, checkedReferences: inventory.supplies.reduce((total, row) => total + row.paths.length, 0), affectedListings: affected.size, issues: report })}\n`);
if (affected.size > 0) process.exitCode = 1;
