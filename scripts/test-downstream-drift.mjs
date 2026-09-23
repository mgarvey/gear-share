import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkDownstreamDrift } from "./check-downstream-drift.mjs";

const root = await mkdtemp(join(tmpdir(), "gear-share-drift-fixture-"));
const run = (args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const commit = (message) => { run(["add", "--all"]); run(["commit", "--quiet", "-m", message]); return run(["rev-parse", "HEAD"]); };
const contractFor = (tag, publicCommit, hotfixes = []) => ({
  schemaVersion: 1,
  publicRelease: { tag, commit: publicCommit },
  privateOverlay: {
    paths: ["config/private/**", "public/brand/private/**", "docs/operations/**", "docs/evidence/**"],
    valueClasses: ["community-presentation", "authorized-artwork", "public-origin-and-routing", "runtime-provider-reference", "private-operations-and-evidence", "consumed-public-release"],
  },
  temporaryHotfixes: hotfixes,
});

try {
  run(["init", "--quiet", "--initial-branch=main"]);
  run(["config", "user.name", "Drift Fixture"]);
  run(["config", "user.email", "drift@example.test"]);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/app.ts"), "export const version = 1;\n");
  const baseOne = commit("public v1");
  run(["tag", "gear-share-v1.0.0", baseOne]);

  await mkdir(join(root, "config/private"), { recursive: true });
  await writeFile(join(root, "config/private/community.json"), "{}\n");
  commit("private overlay");
  await writeFile(join(root, "config/private/downstream-contract.json"), JSON.stringify(contractFor("gear-share-v1.0.0", baseOne)));
  let result = await checkDownstreamDrift({ root });
  assert.deepEqual(result.errors, []);
  await writeFile(join(root, "contract.json"), JSON.stringify(contractFor("gear-share-v1.0.0", baseOne)));
  result = await checkDownstreamDrift({ root, contractPath: "contract.json" });
  assert.deepEqual(result.errors, []);

  await writeFile(join(root, "src/app.ts"), "export const version = 2;\n");
  commit("unrecorded reusable drift");
  result = await checkDownstreamDrift({ root, contractPath: "contract.json" });
  assert(result.errors.some((error) => error.includes("reusable-source drift")));

  run(["checkout", "--quiet", "-b", "public-v2", baseOne]);
  await writeFile(join(root, "src/app.ts"), "export const version = 2;\n");
  const baseTwo = commit("public v2 reconciles hotfix");
  run(["tag", "gear-share-v1.1.0", baseTwo]);
  run(["checkout", "--quiet", "-b", "private-v2", baseTwo]);
  await mkdir(join(root, "config/private"), { recursive: true });
  await writeFile(join(root, "config/private/community.json"), "{}\n");
  commit("private overlay on v2");
  const reconciled = {
    id: "HOTFIX-0001", status: "reconciled", paths: ["src/app.ts"], rationale: "Urgent defect",
    privateCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", tests: ["npm test"], ownerRole: "downstream maintainer",
    reviewBy: "2026-10-01", publicPort: "https://github.com/example/gear-share/pull/123",
    reconciledPublicTag: "gear-share-v1.1.0", reconciledPublicCommit: baseTwo,
  };
  await writeFile(join(root, "contract.json"), JSON.stringify(contractFor("gear-share-v1.1.0", baseTwo, [reconciled])));
  result = await checkDownstreamDrift({ root, contractPath: "contract.json" });
  assert.deepEqual(result.errors, []);

  console.log("Gear Share downstream-drift fixtures OK.");
} finally {
  await rm(root, { recursive: true, force: true });
}
