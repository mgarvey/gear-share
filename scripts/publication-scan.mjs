import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const normalize = (path) => path.split(sep).join("/").replace(/^\.\//, "");
const isUnder = (path, prefix) => prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix;

export function scanPublicationText(path, text, policy) {
  const findings = [];
  const add = (id, detail) => findings.push({ id, path, detail });
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) add("PUBSCAN-SECRET", "private-key material");
  if (/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(text) || /\bsb_secret_[A-Za-z0-9_-]{16,}\b/.test(text) || /\bsk-[A-Za-z0-9_-]{20,}\b/.test(text)) add("PUBSCAN-SECRET", "provider credential shape");
  if (/(?:^|["'\s])\/Users\/[A-Za-z0-9._-]+\//m.test(text) || /[A-Za-z]:\\Users\\[^\\\s]+\\/i.test(text)) add("PUBSCAN-PERSONAL-PATH", "personal filesystem path");
  const emailAddresses = [...text.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi)].map((match) => match[0].toLowerCase());
  const isExampleEmail = (value) => value.includes("@example.") || value.includes(".example.") || value.endsWith("@users.noreply.github.com");
  if (path !== "package-lock.json" && emailAddresses.some((value) => !isExampleEmail(value))) add("PUBSCAN-CONTACT", "non-example email address");
  const knownHostedRef = new RegExp(`\\b${"mbmmfgivh" + "qzhjyneyelu"}\\b`, "i");
  if (knownHostedRef.test(text) || /https:\/\/(?![a-z0-9-]*example[a-z0-9-]*\.supabase\.co\b)[a-z]{20}\.supabase\.co\b/i.test(text)) add("PUBSCAN-HOSTED-ID", "hosted Supabase project reference");
  const providerIdentifiers = [
    ...text.matchAll(new RegExp(`\\b${"arn"}:aws:[^\\s"']+`, "g")),
    ...text.matchAll(/\b\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\b/g),
  ].map((match) => match[0]);
  const isSyntheticProviderIdentifier = (value) => {
    const account = value.match(/(?:^|:|\b)(\d{12})(?:\.|:|\b)/)?.[1];
    return account === "123456789012" || Boolean(account && /^(\d)\1{11}$/.test(account));
  };
  if (providerIdentifiers.some((value) => !isSyntheticProviderIdentifier(value))) add("PUBSCAN-PROVIDER-ID", "provider account or resource identifier");
  if (emailAddresses.some((value) => /^(?:member|applicant)@/i.test(value) && !isExampleEmail(value))) add("PUBSCAN-MEMBER-DATA", "member or applicant contact-like value");
  return findings;
}

export function scanPublicationBytes(path, bytes, policy) {
  if (!bytes.includes(0)) return scanPublicationText(path, bytes.toString("utf8"), policy);
  const expected = policy.allowedBinarySha256?.[path];
  const actual = createHash("sha256").update(bytes).digest("hex");
  return expected === actual ? [] : [{ id: "PUBSCAN-BINARY", path, detail: expected ? "approved binary asset hash changed" : "unapproved binary file" }];
}

export function scanPublicationEntry(path, bytes, policy, { symbolicLink = false } = {}) {
  if (symbolicLink) return [{ id: "PUBSCAN-SYMLINK", path, detail: "tracked symbolic links are not allowed in the publication tree" }];
  return scanPublicationBytes(path, bytes, policy);
}

export async function scanPublicationTree({ root = moduleRoot, strictTree = false } = {}) {
  const policy = JSON.parse(await readFile(resolve(root, "config/publication-policy.json"), "utf8"));
  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" });
  if (listed.status !== 0) throw new Error(`unable to enumerate publication tree: ${listed.stderr}`);
  const paths = listed.stdout.split("\0").filter(Boolean).map(normalize).sort();
  const findings = [];
  const excluded = [];
  for (const path of paths) {
    if (policy.privateOverlayPaths.some((prefix) => isUnder(path, prefix))) {
      excluded.push(path);
      if (strictTree) findings.push({ id: "PUBSCAN-PRIVATE-PATH", path, detail: "private-overlay path present" });
      continue;
    }
    let bytes;
    try {
      const metadata = await lstat(resolve(root, path));
      if (metadata.isSymbolicLink()) {
        findings.push(...scanPublicationEntry(path, Buffer.alloc(0), policy, { symbolicLink: true }));
        continue;
      }
      bytes = await readFile(resolve(root, path));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    findings.push(...scanPublicationEntry(path, bytes, policy));
  }
  return { findings, excluded, scanned: paths.length - excluded.length };
}

export async function publicationProjectionPaths(root = moduleRoot) {
  const policy = JSON.parse(await readFile(resolve(root, "config/publication-policy.json"), "utf8"));
  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" });
  if (listed.status !== 0) throw new Error(`unable to enumerate publication tree: ${listed.stderr}`);
  const paths = listed.stdout.split("\0").filter(Boolean).map(normalize).sort()
    .filter((path) => !policy.privateOverlayPaths.some((prefix) => isUnder(path, prefix)));
  for (const path of paths) {
    try {
      if ((await lstat(resolve(root, path))).isSymbolicLink()) throw new Error(`publication projection refuses tracked symbolic link: ${path}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return paths;
}

async function main() {
  const strictTree = process.argv.includes("--strict-tree");
  const result = await scanPublicationTree({ strictTree });
  if (result.findings.length) {
    for (const finding of result.findings) process.stderr.write(`${finding.id} ${finding.path}: ${finding.detail}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`Publication scan OK (${result.scanned} files scanned; ${result.excluded.length} private-overlay files excluded by policy${strictTree ? "; strict tree" : ""}).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
