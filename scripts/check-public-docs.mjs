import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const publicDocs = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "docs/setup.md", "docs/hosting.md", "docs/private-deployments.md", "docs/asset-provenance.md"];
const contents = Object.fromEntries(await Promise.all(publicDocs.map(async (file) => [file, await readFile(resolve(root, file), "utf8")])));

for (const [file, markdown] of Object.entries(contents)) {
  for (const match of markdown.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)]+)\)/g)) {
    const target = resolve(root, file.startsWith("docs/") ? "docs" : ".", match[1]);
    await access(target).catch(() => { throw new Error(`${file} references missing local path: ${match[1]}`); });
  }
}

const combined = Object.values(contents).join("\n");
for (const forbidden of ["legacy private repository", "private development history", "one-time publication gate", "internal readiness checkpoint"]) {
  if (combined.toLowerCase().includes(forbidden)) throw new Error(`public guidance contains internal transition language: ${forbidden}`);
}
if (!/Security → Advisories → Report a\s+vulnerability/.test(contents["SECURITY.md"]) || !contents["SECURITY.md"].includes("https://github.com/mgarvey")) {
  throw new Error("SECURITY.md must provide the selected durable non-secret reporting routes");
}
if (!contents["README.md"].includes("The-Relational-Technology-Project/community-supplies") || !contents["README.md"].includes("MIT License")) {
  throw new Error("README.md must retain Community Supplies attribution and the MIT license");
}
for (const asset of ["public/favicon.ico", "public/favicon.png", "public/lovable-uploads/227f35f7-b905-464b-bba4-82edcb95f777.png", "public/lovable-uploads/hand-drawn-supplies-1.png", "public/lovable-uploads/hand-drawn-supplies-2.png", "public/lovable-uploads/hand-drawn-supplies-3.png", "public/lovable-uploads/hand-drawn-supplies-4.png", "public/og-image.png", "public/placeholder.svg"]) {
  await access(resolve(root, asset)).catch(() => { throw new Error(`provenance ledger references missing public asset: ${asset}`); });
}
for (const excluded of ["config/private", "docs/evidence", "docs/operations", "public/brand/private"]) {
  await access(resolve(root, excluded)).then(() => { throw new Error(`private-overlay path remains in public candidate: ${excluded}`); }).catch((error) => {
    if (error?.message?.startsWith("private-overlay path")) throw error;
  });
}

console.log("Gear Share public documentation and asset references OK.");
