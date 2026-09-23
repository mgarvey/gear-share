import assert from "node:assert/strict";
import { validateCheckedInLocalConfiguration, validateLocalConfiguration } from "./config-consistency.mjs";

validateCheckedInLocalConfiguration();

const valid = {
  vite: "server: { host: '::', port: 8080 }",
  exampleEnv: "VITE_PUBLIC_APP_ORIGIN=http://127.0.0.1:8080\n",
  supabase: 'site_url = "http://127.0.0.1:8080"\nadditional_redirect_urls = ["http://127.0.0.1:8080"]\nminimum_password_length = 12\n',
  auth: '<Input id="password" type="password" minLength={12} />',
  recovery: "if (password.length < 12) return;",
};

assert.doesNotThrow(() => validateLocalConfiguration(valid));
assert.throws(() => validateLocalConfiguration({ ...valid, supabase: valid.supabase.replaceAll("8080", "5173") }), /origins must match/);
assert.throws(() => validateLocalConfiguration({ ...valid, supabase: valid.supabase.replace("minimum_password_length = 12", "minimum_password_length = 8") }), /password minimums/);
assert.throws(() => validateLocalConfiguration({ ...valid, exampleEnv: "VITE_PUBLIC_APP_ORIGIN=http://127.0.0.1:5173\n" }), /Vite loopback port/);

console.log("Gear Share local origin and password-policy consistency OK.");
