import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const projectLabel = "community-gear-lending";
const restoreDatabase = `gear_share_restore_${randomUUID().replaceAll("-", "")}`;
const artifactPath = `/private/tmp/community-gear-share-logical-${Date.now()}.dump`;

const discovery = spawnSync("docker", [
  "ps",
  "--filter", `label=com.supabase.cli.project=${projectLabel}`,
  "--filter", "name=supabase_db_",
  "--format", "{{.Names}}",
], { encoding: "utf8" });
const containers = discovery.stdout.trim().split("\n").filter(Boolean);
if (discovery.status !== 0 || containers.length !== 1) {
  throw new Error(`Expected one running ${projectLabel} database container; found ${containers.length}`);
}
const container = containers[0];

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { maxBuffer: 128 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed:\n${result.stderr?.toString().trim()}`);
  }
  return result.stdout;
}

function query(database) {
  const sql = `
select json_build_object(
  'communities', (select count(*) from public.communities),
  'profiles', (select count(*) from public.profiles),
  'supplies', (select count(*) from public.supplies),
  'loans', (select count(*) from public.gear_loans),
  'public_tables', (select count(*) from pg_tables where schemaname = 'public'),
  'public_routines', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
  'rls_policies', (select count(*) from pg_policies where schemaname in ('public', 'storage')),
  'migrations', (select count(*) from supabase_migrations.schema_migrations)
);`;
  return docker(["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database], {
    input: sql,
    encoding: "utf8",
  }).trim();
}

let restoreCreated = false;
try {
  const dump = docker([
    "exec", container, "pg_dump", "-Fc", "--no-owner", "--no-privileges",
    "--schema=public", "--schema=auth", "--schema=storage",
    "--schema=supabase_migrations", "--schema=extensions",
    "-U", "postgres", "-d", "postgres",
  ]);
  writeFileSync(artifactPath, dump, { mode: 0o600 });
  const checksum = createHash("sha256").update(dump).digest("hex");
  const sourceInventory = query("postgres");

  docker(["exec", "-i", container, "createdb", "-U", "postgres", "-T", "template0", restoreDatabase]);
  restoreCreated = true;
  docker(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", restoreDatabase, "-c", "drop schema public cascade;"]);
  docker([
    "exec", "-i", container, "pg_restore", "--exit-on-error", "--no-owner", "--no-privileges",
    "-U", "postgres", "-d", restoreDatabase,
  ], { input: dump });
  const restoredInventory = query(restoreDatabase);
  if (restoredInventory !== sourceInventory) {
    throw new Error(`Restored inventory differs from source. source=${sourceInventory} restored=${restoredInventory}`);
  }

  process.stdout.write(`${JSON.stringify({
    artifactPath,
    sha256: checksum,
    exportScope: ["public", "auth", "storage", "supabase_migrations", "extensions"],
    sourceInventory: JSON.parse(sourceInventory),
    restoredInventory: JSON.parse(restoredInventory),
  })}\n`);
} finally {
  if (restoreCreated) {
    docker(["exec", "-i", container, "dropdb", "--force", "-U", "postgres", restoreDatabase]);
  }
}
