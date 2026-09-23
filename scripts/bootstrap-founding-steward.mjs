import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [targetUserId, operatorIdentifier, reason, evidencePath] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!uuid.test(targetUserId ?? "") || !operatorIdentifier?.trim() || !reason?.trim() || !evidencePath?.trim()) {
  console.error("Usage: npm run bootstrap-steward -- <confirmed-user-uuid> <operator-id> <reason> <evidence-json-path>");
  process.exit(2);
}
if (!process.env.GEAR_SHARE_DATABASE_URL) {
  console.error("GEAR_SHARE_DATABASE_URL is required and must identify the explicitly approved gear share database.");
  process.exit(2);
}

const childEnv = { ...process.env, PGDATABASE: process.env.GEAR_SHARE_DATABASE_URL };
delete childEnv.GEAR_SHARE_DATABASE_URL;
const resolvedEvidencePath = resolve(evidencePath);
const preparedEvidence = {
  operation: "bootstrap_founding_steward",
  status: "prepared",
  targetUserId,
  suppliedOperatorIdentifier: operatorIdentifier.trim(),
  suppliedReason: reason.trim(),
  preparedAt: new Date().toISOString(),
  attributionNotice: "Operator identifier is supplied operational attribution, not authenticated identity proof.",
};

try {
  await writeFile(resolvedEvidencePath, `${JSON.stringify(preparedEvidence, null, 2)}\n`, { flag: "wx" });
} catch (error) {
  console.error(`Cannot reserve the evidence path before bootstrap: ${error.message}`);
  process.exit(2);
}

const result = spawnSync("psql", [
  "--no-psqlrc",
  "--set", "ON_ERROR_STOP=1",
  "--set", `target_user_id=${targetUserId}`,
  "--set", `operator_identifier=${operatorIdentifier}`,
  "--set", `reason=${reason}`,
  "--command",
  "select public.bootstrap_founding_steward(:'target_user_id'::uuid, :'operator_identifier', :'reason');",
], { env: childEnv, encoding: "utf8" });

if (result.status !== 0) {
  await writeFile(resolvedEvidencePath, `${JSON.stringify({ ...preparedEvidence, status: "failed", failedAt: new Date().toISOString(), databaseError: result.stderr?.trim() || "Founding-steward bootstrap failed." }, null, 2)}\n`);
  process.stderr.write(result.stderr || "Founding-steward bootstrap failed.\n");
  process.exit(result.status ?? 1);
}

const evidence = {
  ...preparedEvidence,
  status: "completed",
  completedAt: new Date().toISOString(),
};
await writeFile(resolvedEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Founding steward bootstrapped. Evidence written to ${resolvedEvidencePath}.`);
