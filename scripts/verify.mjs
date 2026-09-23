import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { verificationScripts } from "./verification-plan.mjs";

const env = {
  ...process.env,
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_ANON_KEY: "local-verification-anon-key",
  VITE_PUBLIC_APP_ORIGIN: "https://gear.example.test",
  VITE_PRIVACY_CONTACT_URL: "https://gear.example.test/privacy-contact",
  VITE_BACKUP_RETENTION_DAYS: "30",
};

const downstream = existsSync(resolve("config/private/downstream-contract.json"));
const scripts = verificationScripts({ downstream });

for (const script of scripts) {
  const result = spawnSync("npm", ["run", script], {
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
