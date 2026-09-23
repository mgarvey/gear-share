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

export async function checkDownstreamDrift({ root = moduleRoot, contractPath = "config/private/downstream-contract.json", head = "HEAD" } = {}) {
  const contract = await readDownstreamContract(resolve(root, contractPath));
  const base = contract.publicRelease.commit;
  const errors = validateDownstreamContract(contract);
  const baseObject = git(root, ["rev-parse", "--verify", `${base}^{commit}`], { allowFailure: true });
  if (baseObject.status !== 0) errors.push(`recorded public commit is unavailable: ${base}`);
  const tagObject = git(root, ["rev-parse", "--verify", `refs/tags/${contract.publicRelease.tag}^{commit}`], { allowFailure: true });
  if (tagObject.status !== 0 || tagObject.stdout.trim() !== base) errors.push("recorded public tag does not resolve to the recorded public commit");
  if (baseObject.status === 0 && git(root, ["merge-base", "--is-ancestor", base, head], { allowFailure: true }).status !== 0) errors.push("recorded public commit is not an ancestor of the private head");
  let changedPaths = [];
  if (baseObject.status === 0) {
    changedPaths = git(root, ["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${base}..${head}`]).stdout.split("\n").filter(Boolean).sort();
    errors.push(...validateDownstreamContract(contract, { changedPaths }));
  }
  return { base, head, tag: contract.publicRelease.tag, changedPaths, errors };
}

async function main() {
  const argument = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? fallback : process.argv[index + 1];
  };
  const result = await checkDownstreamDrift({
    root: resolve(argument("--root", moduleRoot)),
    contractPath: argument("--contract", "config/private/downstream-contract.json"),
    head: argument("--head", "HEAD"),
  });
  if (result.errors.length) {
    for (const error of result.errors) process.stderr.write(`DOWNSTREAM-DRIFT ${error}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`Downstream drift OK (${result.tag} ${result.base}; ${result.changedPaths.length} reviewed private path${result.changedPaths.length === 1 ? "" : "s"}).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
