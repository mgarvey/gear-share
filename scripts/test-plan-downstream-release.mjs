import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planDownstreamRelease } from "./plan-downstream-release.mjs";

const root = await mkdtemp(join(tmpdir(), "gear-share-release-plan-"));
const run = (args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const commit = (message) => { run(["add", "--all"]); run(["commit", "--quiet", "-m", message]); return run(["rev-parse", "HEAD"]); };

try {
  run(["init", "--quiet", "--initial-branch=main"]);
  run(["config", "user.name", "Release Plan Fixture"]);
  run(["config", "user.email", "release-plan@example.test"]);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/app.ts"), "export const version = 1;\n");
  const oldCommit = commit("public v1");
  run(["tag", "gear-share-v1.0.0", oldCommit]);
  await writeFile(join(root, "src/app.ts"), "export const version = 2;\n");
  await writeFile(join(root, "README.md"), "# Gear Share\n");
  const newCommit = commit("public v2");
  run(["tag", "gear-share-v1.1.0", newCommit]);
  const contract = {
    schemaVersion: 1,
    publicRelease: { tag: "gear-share-v1.0.0", commit: oldCommit },
    privateOverlay: {
      paths: ["config/private/**", "public/brand/private/**", "docs/operations/**", "docs/evidence/**"],
      valueClasses: ["community-presentation", "authorized-artwork", "public-origin-and-routing", "runtime-provider-reference", "private-operations-and-evidence", "consumed-public-release"],
    },
    temporaryHotfixes: [],
  };
  await mkdir(join(root, "config/private"), { recursive: true });
  await writeFile(join(root, "config/private/downstream-contract.json"), JSON.stringify(contract));
  const before = run(["status", "--porcelain=v1"]);
  const result = await planDownstreamRelease({ root, newTag: "gear-share-v1.1.0" });
  const after = run(["status", "--porcelain=v1"]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.oldCommit, oldCommit);
  assert.equal(result.newCommit, newCommit);
  assert.deepEqual(result.publicChangedPaths, ["README.md", "src/app.ts"]);
  assert(result.verificationPlan.some((step) => step.includes("does not authorize deployment")));
  assert.equal(after, before, "dry-run planning must not change the repository");
  console.log("Gear Share downstream release-plan dry-run fixture OK.");
} finally {
  await rm(root, { recursive: true, force: true });
}
