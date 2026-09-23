import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { publicationProjectionPaths } from "./publication-scan.mjs";

const sourceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporaryRoot = await mkdtemp(join(tmpdir(), "gear-share-fresh-clone-"));
const candidateRoot = join(temporaryRoot, "candidate");
const cloneRoot = join(temporaryRoot, "clone");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? cloneRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(`${result.stdout}${result.stderr}`);
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
  }
  return result;
}

try {
  await mkdir(candidateRoot, { recursive: true });
  for (const path of await publicationProjectionPaths(sourceRoot)) {
    try {
      await mkdir(dirname(join(candidateRoot, path)), { recursive: true });
      await copyFile(join(sourceRoot, path), join(candidateRoot, path));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  run("git", ["init", "--quiet", "--initial-branch=main"], { cwd: candidateRoot });
  run("git", ["config", "user.name", "Gear Share Verification"], { cwd: candidateRoot });
  run("git", ["config", "user.email", "verification@example.test"], { cwd: candidateRoot });
  run("git", ["add", "--all"], { cwd: candidateRoot });
  run("git", ["commit", "--quiet", "-m", "Candidate tree"], { cwd: candidateRoot });
  run("git", ["clone", "--quiet", candidateRoot, cloneRoot], { cwd: temporaryRoot });

  run("npm", ["ci"]);
  const verificationEnv = {
    ...process.env,
    VITE_SUPABASE_URL: "http://127.0.0.1:54321",
    VITE_SUPABASE_ANON_KEY: "local-verification-anon-key",
    VITE_PUBLIC_APP_ORIGIN: "https://gear.example.test",
    VITE_PRIVACY_CONTACT_URL: "https://gear.example.test/privacy-contact",
    VITE_BACKUP_RETENTION_DAYS: "30",
  };
  for (const script of [
    "scan:publication:strict",
    "test:public-docs",
    "test:config-consistency",
    "test:supabase-boundary",
    "build",
    "typecheck",
    "lint",
    "test:static",
  ]) run("npm", ["run", script], { env: verificationEnv });

  console.log("Fresh-clone verification OK (frozen install; publication, static docs, configuration, database policy, build, type, lint, and route checks)." );
} finally {
  if (!process.argv.includes("--keep")) await rm(temporaryRoot, { recursive: true, force: true });
  else console.log(`Fresh-clone workspace retained at ${temporaryRoot}`);
}
