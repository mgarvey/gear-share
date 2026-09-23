import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const roots = ["src", "scripts", "supabase"];
const files = [
  "README.md",
  "package.json",
  "vite.config.ts",
  ".env.example",
  "docs/gear-share-operations.md",
  "docs/hosting.md",
  "docs/transactional-email-rollout.md",
  "vercel.json",
];
const readableExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".sql", ".toml", ".json", ".md", ".env"]);

async function collect(directory, relative = directory) {
  const entries = await readdir(resolve(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await collect(directory, path);
    else if (readableExtensions.has(extname(entry.name)) || entry.name === ".env.example") files.push(path);
  }
}

for (const directory of roots) await collect(directory);

const obsolete = [
  { pattern: /\bpilot\b/i, label: "obsolete pilot terminology" },
  { pattern: /PILOT_/, label: "obsolete PILOT_ environment name" },
  { pattern: /x-pilot-/i, label: "obsolete x-pilot header" },
  { pattern: /(?:components|pages|types)\/pilot|lib\/pilot/i, label: "obsolete source path" },
  { pattern: /pilot\/(?:supabase|ai-evaluation)/i, label: "obsolete root path" },
];

const failures = [];
for (const file of [...new Set(files)].sort()) {
  if (file === "scripts/check-internal-naming.mjs") continue;
  let contents;
  try {
    contents = await readFile(resolve(root, file), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" && file === "docs/gear-share-operations.md") continue;
    throw error;
  }
  for (const { pattern, label } of obsolete) {
    if (pattern.test(contents) || pattern.test(file)) failures.push(`${file}: ${label}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Active-tree naming check failed:\n${failures.join("\n")}`);
}

console.log(`Active-tree naming OK (${new Set(files).size} files checked).`);
