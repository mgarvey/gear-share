import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDownstreamContract } from "./downstream-contract.mjs";

const expected = JSON.parse(await readFile(new URL("../config/downstream-contract.example.json", import.meta.url), "utf8"));
assert.deepEqual(validateDownstreamContract(expected, { changedPaths: ["config/private/community.json", "docs/operations/deploy.md"] }), []);

assert(validateDownstreamContract(expected, { changedPaths: ["src/App.tsx"] }).some((error) => error.includes("reusable-source drift")));

const incompleteHotfix = structuredClone(expected);
incompleteHotfix.temporaryHotfixes.push({
  id: "HOTFIX-0001",
  status: "temporary",
  paths: ["src/App.tsx"],
  rationale: "Urgent deployment defect",
  privateCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  tests: ["npm test"],
  ownerRole: "downstream maintainer",
  reviewBy: "2026-10-01"
});
assert(validateDownstreamContract(incompleteHotfix, { changedPaths: ["src/App.tsx"] }).some((error) => error.includes("missing") || error.includes("evidence")));

const recordedHotfix = structuredClone(incompleteHotfix);
recordedHotfix.temporaryHotfixes[0].publicPort = "https://github.com/example/gear-share/issues/123";
assert.deepEqual(validateDownstreamContract(recordedHotfix, { changedPaths: ["src/App.tsx"] }), []);

console.log("Gear Share downstream-contract schema and policy fixtures OK.");
