import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const directory = mkdtempSync(join(tmpdir(), "community-bootstrap-command-"));
const evidencePath = join(directory, "existing-evidence.json");
const original = "do not overwrite\n";
writeFileSync(evidencePath, original, { mode: 0o600 });

const result = spawnSync(process.execPath, [
  "scripts/bootstrap-founding-steward.mjs",
  "10000000-0000-4000-8000-000000000001",
  "local-test",
  "preflight evidence path",
  evidencePath,
], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, GEAR_SHARE_DATABASE_URL: "postgresql://must-not-be-contacted.invalid/postgres" },
});

if (result.status === 0 || !result.stderr.includes("Cannot reserve the evidence path before bootstrap")) {
  throw new Error(`Bootstrap command did not fail at evidence preflight: ${result.stderr}`);
}
if (readFileSync(evidencePath, "utf8") !== original) {
  throw new Error("Bootstrap command overwrote an existing evidence artifact");
}

process.stdout.write("Founding-steward evidence preflight OK: an unusable evidence target prevents the database mutation.\n");
