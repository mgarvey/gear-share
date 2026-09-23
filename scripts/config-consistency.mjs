import { readFileSync } from "node:fs";

function requiredMatch(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) throw new Error(`Unable to read ${label}`);
  return match[1];
}

export function validateLocalConfiguration({ vite, exampleEnv, supabase, auth, recovery }) {
  const vitePort = requiredMatch(vite, /server:\s*\{[\s\S]*?port:\s*(\d+)/, "Vite port");
  const exampleOrigin = requiredMatch(exampleEnv, /^VITE_PUBLIC_APP_ORIGIN=(\S+)$/m, "example application origin");
  const siteUrl = requiredMatch(supabase, /^site_url\s*=\s*"([^"]+)"$/m, "Supabase Auth site URL");
  const redirects = requiredMatch(supabase, /^additional_redirect_urls\s*=\s*\[([^\]]+)\]$/m, "Supabase Auth redirects");
  const serverMinimum = requiredMatch(supabase, /^minimum_password_length\s*=\s*(\d+)$/m, "Supabase password minimum");
  const signupMinimum = requiredMatch(auth, /id="password"[\s\S]*?minLength=\{(\d+)\}/, "signup password minimum");
  const recoveryMinimum = requiredMatch(recovery, /password\.length\s*<\s*(\d+)/, "recovery password minimum");
  const origin = new URL(exampleOrigin);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.port !== vitePort) throw new Error("Example application origin must match the Vite loopback port");
  if (siteUrl !== exampleOrigin || redirects !== `"${exampleOrigin}"`) throw new Error("Supabase Auth site and redirect origins must match the example application origin");
  if (serverMinimum !== "12" || signupMinimum !== serverMinimum || recoveryMinimum !== serverMinimum) throw new Error("UI and Supabase password minimums must all be 12 characters");
}

export function validateCheckedInLocalConfiguration(root = process.cwd()) {
  validateLocalConfiguration({
    vite: readFileSync(`${root}/vite.config.ts`, "utf8"),
    exampleEnv: readFileSync(`${root}/.env.example`, "utf8"),
    supabase: readFileSync(`${root}/supabase/config.toml`, "utf8"),
    auth: readFileSync(`${root}/src/components/gear/Auth.tsx`, "utf8"),
    recovery: readFileSync(`${root}/src/pages/app/PasswordRecoveryPage.tsx`, "utf8"),
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) validateCheckedInLocalConfiguration();
