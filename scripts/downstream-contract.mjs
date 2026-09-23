import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const ALLOWED_PRIVATE_PATHS = [
  "config/private/**",
  "public/brand/private/**",
  "docs/operations/**",
  "docs/evidence/**",
];

export const ALLOWED_VALUE_CLASSES = [
  "community-presentation",
  "authorized-artwork",
  "public-origin-and-routing",
  "runtime-provider-reference",
  "private-operations-and-evidence",
  "consumed-public-release",
];

const exactKeys = (value, keys) => {
  const actual = Object.keys(value ?? {}).sort();
  return JSON.stringify(actual) === JSON.stringify([...keys].sort());
};
const isSha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const isTag = (value) => typeof value === "string" && /^gear-share-v\d+\.\d+\.\d+$/.test(value);
const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const isPublicPort = (value) => typeof value === "string" && /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+$/.test(value);
const uniqueStrings = (value) => Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0) && new Set(value).size === value.length;

export function pathMatchesPattern(path, pattern) {
  return pattern.endsWith("/**") ? path.startsWith(pattern.slice(0, -2)) : path === pattern;
}

export function validateDownstreamContract(contract, { changedPaths = [] } = {}) {
  const errors = [];
  if (!exactKeys(contract, ["schemaVersion", "publicRelease", "privateOverlay", "temporaryHotfixes"])) errors.push("contract has missing or unknown top-level fields");
  if (contract?.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (!exactKeys(contract?.publicRelease, ["tag", "commit"]) || !isTag(contract?.publicRelease?.tag) || !isSha(contract?.publicRelease?.commit)) errors.push("publicRelease must contain the exact authenticated tag and 40-character commit");
  if (!exactKeys(contract?.privateOverlay, ["paths", "valueClasses"])) errors.push("privateOverlay must contain only paths and valueClasses");
  if (!uniqueStrings(contract?.privateOverlay?.paths) || contract.privateOverlay.paths.some((path) => !ALLOWED_PRIVATE_PATHS.includes(path))) errors.push("privateOverlay paths contain an unapproved path family");
  if (!uniqueStrings(contract?.privateOverlay?.valueClasses) || contract.privateOverlay.valueClasses.some((value) => !ALLOWED_VALUE_CLASSES.includes(value))) errors.push("privateOverlay contains an unapproved value class");
  if (!Array.isArray(contract?.temporaryHotfixes)) errors.push("temporaryHotfixes must be an array");

  const hotfixPaths = new Set();
  const hotfixIds = new Set();
  for (const hotfix of contract?.temporaryHotfixes ?? []) {
    const required = ["id", "status", "paths", "rationale", "privateCommit", "tests", "ownerRole", "reviewBy", "publicPort"];
    const optional = ["reconciledPublicTag", "reconciledPublicCommit"];
    if (!Object.keys(hotfix ?? {}).every((key) => [...required, ...optional].includes(key)) || required.some((key) => !(key in (hotfix ?? {})))) errors.push("hotfix has missing or unknown fields");
    if (!/^HOTFIX-\d{4}$/.test(hotfix?.id ?? "") || hotfixIds.has(hotfix.id)) errors.push("hotfix id must be unique and use HOTFIX-0000 format");
    hotfixIds.add(hotfix?.id);
    if (!uniqueStrings(hotfix?.paths)) errors.push(`${hotfix?.id ?? "hotfix"} must identify at least one unique path`);
    if (hotfix?.status === "temporary") for (const path of hotfix?.paths ?? []) hotfixPaths.add(path);
    if (!isSha(hotfix?.privateCommit) || !uniqueStrings(hotfix?.tests) || !hotfix?.rationale || !hotfix?.ownerRole || !isDate(hotfix?.reviewBy) || !isPublicPort(hotfix?.publicPort)) errors.push(`${hotfix?.id ?? "hotfix"} lacks complete temporary-hotfix evidence`);
    if (!['temporary', 'reconciled'].includes(hotfix?.status)) errors.push(`${hotfix?.id ?? "hotfix"} has an invalid status`);
    if (hotfix?.status === "reconciled" && (!isTag(hotfix.reconciledPublicTag) || !isSha(hotfix.reconciledPublicCommit))) errors.push(`${hotfix?.id ?? "hotfix"} lacks reconciliation release evidence`);
  }

  for (const path of changedPaths) {
    const privatePath = (contract?.privateOverlay?.paths ?? []).some((pattern) => pathMatchesPattern(path, pattern));
    if (!privatePath && !hotfixPaths.has(path)) errors.push(`reusable-source drift is not allowlisted: ${path}`);
  }
  return errors;
}

export async function readDownstreamContract(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}
