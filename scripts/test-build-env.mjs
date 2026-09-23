import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function buildWith(overrides) {
  const env = { ...process.env };
  delete env.VITE_SUPABASE_URL;
  delete env.VITE_SUPABASE_ANON_KEY;
  delete env.VITE_PUBLIC_APP_ORIGIN;
  delete env.VITE_PRIVACY_CONTACT_URL;
  delete env.VITE_BACKUP_RETENTION_DAYS;
  delete env.VITE_COMMUNITY_NAME;
  delete env.VITE_COMMUNITY_LOGO_URL;
  Object.assign(env, overrides);
  return spawnSync("npm", ["run", "build"], {
    env,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

const knownUpstreamRef = "mbmmfgivh" + "qzhjyneyelu";

const missing = buildWith({
  VITE_SUPABASE_URL: " ",
  VITE_SUPABASE_ANON_KEY: " ",
  VITE_PUBLIC_APP_ORIGIN: " ",
  VITE_PRIVACY_CONTACT_URL: " ",
  VITE_BACKUP_RETENTION_DAYS: " ",
});
if (missing.status === 0 || !`${missing.stdout}${missing.stderr}`.includes("VITE_SUPABASE_URL")) {
  throw new Error("Build did not fail clearly for missing gear share configuration");
}

const upstream = buildWith({
  VITE_SUPABASE_URL: `https://${knownUpstreamRef}.supabase.co`,
  VITE_SUPABASE_ANON_KEY: "public-anon-key",
  VITE_PUBLIC_APP_ORIGIN: "https://gear.example.test",
  VITE_PRIVACY_CONTACT_URL: "https://gear.example.test/privacy-contact",
  VITE_BACKUP_RETENTION_DAYS: "30",
});
if (upstream.status === 0 || !`${upstream.stdout}${upstream.stderr}`.includes("Refusing to use the upstream")) {
  throw new Error("Build did not reject the known upstream Supabase project");
}

const unsafeOrigin = buildWith({
  VITE_SUPABASE_URL: "https://gear-share-project.supabase.co",
  VITE_SUPABASE_ANON_KEY: "public-anon-key",
  VITE_PUBLIC_APP_ORIGIN: "https://user:secret@gear.example.test/recovery?next=evil",
  VITE_PRIVACY_CONTACT_URL: "https://gear.example.test/privacy-contact",
  VITE_BACKUP_RETENTION_DAYS: "30",
});
if (unsafeOrigin.status === 0 || !`${unsafeOrigin.stdout}${unsafeOrigin.stderr}`.includes("one exact approved HTTPS origin")) {
  throw new Error("Build did not reject an unsafe recovery origin");
}

const upstreamPublicOrigin = buildWith({
  VITE_SUPABASE_URL: "https://gear-share-project.supabase.co",
  VITE_SUPABASE_ANON_KEY: "public-anon-key",
  VITE_PUBLIC_APP_ORIGIN: "https://sunset-block-party-supplies.lovable.app",
  VITE_PRIVACY_CONTACT_URL: "https://gear.example.test/privacy-contact",
  VITE_BACKUP_RETENTION_DAYS: "30",
});
if (upstreamPublicOrigin.status === 0 || !`${upstreamPublicOrigin.stdout}${upstreamPublicOrigin.stderr}`.includes("Lovable preview hosts are denied")) {
  throw new Error("Build did not reject the known upstream preview origin");
}

const unsafePrivacyContact = buildWith({
  VITE_SUPABASE_URL: "https://gear-share-project.supabase.co",
  VITE_SUPABASE_ANON_KEY: "public-anon-key",
  VITE_PUBLIC_APP_ORIGIN: "https://gear.example.test",
  VITE_PRIVACY_CONTACT_URL: "https://user:secret@forms.example.test/help?member=secret",
  VITE_BACKUP_RETENTION_DAYS: "30",
});
if (unsafePrivacyContact.status === 0 || !`${unsafePrivacyContact.stdout}${unsafePrivacyContact.stderr}`.includes("public HTTPS route")) {
  throw new Error("Build did not reject an unsafe public privacy contact route");
}

const unknownBackupMaximum = buildWith({
  VITE_SUPABASE_URL: "https://gear-share-project.supabase.co",
  VITE_SUPABASE_ANON_KEY: "public-anon-key",
  VITE_PUBLIC_APP_ORIGIN: "https://gear.example.test",
  VITE_PRIVACY_CONTACT_URL: "https://gear.example.test/privacy-contact",
  VITE_BACKUP_RETENTION_DAYS: "unknown",
});
if (unknownBackupMaximum.status === 0 || !`${unknownBackupMaximum.stdout}${unknownBackupMaximum.stderr}`.includes("exact maximum")) {
  throw new Error("Build did not reject an unknown backup-retention maximum");
}

const neutral = buildWith({
  VITE_SUPABASE_URL: "https://gear-share-project.supabase.co",
  VITE_SUPABASE_ANON_KEY: "public-anon-key",
  VITE_PUBLIC_APP_ORIGIN: "https://gear.example.test",
  VITE_PRIVACY_CONTACT_URL: "https://gear.example.test/privacy-contact",
  VITE_BACKUP_RETENTION_DAYS: "30",
  VITE_COMMUNITY_NAME: " ",
  VITE_COMMUNITY_LOGO_URL: " ",
});
if (neutral.status !== 0) throw new Error(`Neutral build failed:\n${neutral.stdout}${neutral.stderr}`);
const neutralHtml = readFileSync("dist/index.html", "utf8");
const neutralManifest = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
if (!neutralHtml.includes("<title>Community Gear Share</title>") || neutralManifest.name !== "Community Gear Share" || neutralManifest.icons[0].src !== "/favicon.png") {
  throw new Error("Neutral build did not render the community-neutral presentation");
}

const branded = buildWith({
  VITE_SUPABASE_URL: "https://gear-share-project.supabase.co",
  VITE_SUPABASE_ANON_KEY: "public-anon-key",
  VITE_PUBLIC_APP_ORIGIN: "https://gear.example.test",
  VITE_PRIVACY_CONTACT_URL: "https://gear.example.test/privacy-contact",
  VITE_BACKUP_RETENTION_DAYS: "30",
  VITE_COMMUNITY_NAME: "Trail Group",
  VITE_COMMUNITY_LOGO_URL: "/brand/trail-group.svg",
});
if (branded.status !== 0) throw new Error(`Branded build failed:\n${branded.stdout}${branded.stderr}`);
const brandedHtml = readFileSync("dist/index.html", "utf8");
const brandedManifest = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
if (!brandedHtml.includes("<title>Trail Group Gear Share</title>") || !brandedHtml.includes('content="https://gear.example.test/brand/trail-group.svg"') || brandedManifest.name !== "Trail Group Gear Share" || brandedManifest.icons[0].src !== "/brand/trail-group.svg") {
  throw new Error("Configured build did not render the reviewed presentation override");
}
