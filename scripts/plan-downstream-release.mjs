import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDownstreamContract, validateDownstreamContract } from "./downstream-contract.mjs";

const moduleRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result;
}

export async function planDownstreamRelease({ root = moduleRoot, contractPath = "config/private/downstream-contract.json", newTag } = {}) {
  const contract = await readDownstreamContract(resolve(root, contractPath));
  const errors = validateDownstreamContract(contract);
  if (!newTag || !/^gear-share-v\d+\.\d+\.\d+$/.test(newTag)) errors.push("new public tag must use gear-share-vMAJOR.MINOR.PATCH");
  const oldTag = contract.publicRelease.tag;
  const oldCommit = contract.publicRelease.commit;
  const oldResolved = git(root, ["rev-parse", "--verify", `refs/tags/${oldTag}^{commit}`], { allowFailure: true });
  if (oldResolved.status !== 0 || oldResolved.stdout.trim() !== oldCommit) errors.push("recorded old public tag and commit do not match local authenticated refs");
  const newResolved = newTag ? git(root, ["rev-parse", "--verify", `refs/tags/${newTag}^{commit}`], { allowFailure: true }) : { status: 1, stdout: "" };
  const newCommit = newResolved.status === 0 ? newResolved.stdout.trim() : "";
  if (!newCommit) errors.push("new public tag is unavailable locally; fetch and authenticate it before planning adoption");
  if (newCommit && git(root, ["merge-base", "--is-ancestor", oldCommit, newCommit], { allowFailure: true }).status !== 0) errors.push("new public release does not descend from the consumed public commit");
  const publicChangedPaths = newCommit ? git(root, ["diff", "--name-only", `${oldCommit}..${newCommit}`]).stdout.split("\n").filter(Boolean).sort() : [];
  return {
    oldTag, oldCommit, newTag, newCommit, publicChangedPaths, errors,
    verificationPlan: [
      "Authenticate the new public tag and confirm its commit.",
      "Create a private update branch and integrate the public release without deploying.",
      "Review the public release diff and the resulting private integration diff.",
      "Run npm ci, npm run verify, npm run check:downstream-drift, and private configuration checks.",
      "Update the downstream contract only after all checks pass.",
      "Open and approve the private update pull request; merge approval does not authorize deployment.",
    ],
  };
}

async function main() {
  const argument = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? fallback : process.argv[index + 1];
  };
  const result = await planDownstreamRelease({ root: resolve(argument("--root", moduleRoot)), contractPath: argument("--contract", "config/private/downstream-contract.json"), newTag: argument("--new-tag") });
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
