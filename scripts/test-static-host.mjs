import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { CLIENT_INVOKABLE_FUNCTIONS, DENIED_ROOT_FUNCTIONS, IMPLEMENTED_FUNCTIONS } from "./function-policy.mjs";

const root = join(process.cwd(), "dist");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const vercel = JSON.parse(await readFile(join(process.cwd(), "vercel.json"), "utf8"));
const apache = await readFile(join(root, ".htaccess"), "utf8");
const initialDocument = await readFile(join(root, "index.html"), "utf8");
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const title = initialDocument.match(/<title>([^<]+)<\/title>/)?.[1];
if (!title || title !== manifest.name) throw new Error("initial document and web manifest must use the same Gear Share name");
for (const requiredBrandText of [
  `<title>${title}</title>`,
  `<h1>${title}</h1>`,
  "an Administrator must approve access before the private catalog is available",
]) {
  if (!initialDocument.includes(requiredBrandText)) throw new Error(`initial document is missing crawler-visible brand content: ${requiredBrandText}`);
}
if (initialDocument.includes("__GEAR_SHARE_") || initialDocument.includes("__COMMUNITY_")) throw new Error("initial document contains unresolved presentation markers");
if (!manifest.name.endsWith(" Gear Share") || manifest.short_name !== "Gear Share" || manifest.description.includes("Outer Sunset")) {
  throw new Error("web manifest does not identify the configured Gear Share");
}
if (!/RewriteRule \^assets\/ - \[R=404,L\]/.test(apache)) {
  throw new Error(".htaccess must return 404 for missing immutable assets before the SPA fallback");
}
if (vercel.rewrites?.length !== 1
    || vercel.rewrites[0].source !== "/((?!assets/).*)"
    || vercel.rewrites[0].destination !== "/index.html") {
  throw new Error("vercel.json must rewrite every non-asset request to /index.html");
}

const assetNames = await readdir(join(root, "assets"));
const bundle = (await Promise.all(assetNames.filter((name) => name.endsWith(".js")).map((name) => readFile(join(root, "assets", name), "utf8")))).join("\n");
for (const denied of DENIED_ROOT_FUNCTIONS) {
  if (bundle.includes(denied)) throw new Error(`production bundle contains denied legacy function name: ${denied}`);
}
for (const legacyCopy of [
  "Auto-join enabled",
  "Total Members",
  "generate a clean catalog-style illustration",
  "agree to indemnify and hold harmless",
]) {
  if (bundle.includes(legacyCopy)) throw new Error(`production bundle contains excluded legacy gear share UI: ${legacyCopy}`);
}
const invoked = new Set([
  ...[...bundle.matchAll(/\.functions\.invoke\(["']([a-z0-9-]+)["']/g)].map((match) => match[1]),
  ...[...bundle.matchAll(/\/functions\/v1\/([a-z0-9-]+)/g)].map((match) => match[1]),
]);
for (const name of invoked) {
  if (!IMPLEMENTED_FUNCTIONS.includes(name)) throw new Error(`production bundle invokes an unreviewed Edge Function: ${name}`);
}
for (const name of CLIENT_INVOKABLE_FUNCTIONS) {
  if (!bundle.includes(name)) throw new Error(`production bundle is missing the implemented Edge Function invocation: ${name}`);
}
for (const name of IMPLEMENTED_FUNCTIONS.filter((candidate) => !CLIENT_INVOKABLE_FUNCTIONS.includes(candidate))) {
  if (bundle.includes(name)) throw new Error(`production bundle exposes a service-only Edge Function name: ${name}`);
}
for (const serverOnlyAiValue of ["OPENAI_API_KEY", "OPENAI_SAFETY_IDENTIFIER_SECRET", "api.openai.com/v1/responses", "gpt-5.6-luna"]) {
  if (bundle.includes(serverOnlyAiValue)) throw new Error(`production bundle exposes server-only AI configuration: ${serverOnlyAiValue}`);
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const candidate = normalize(join(root, pathname));
  let file = join(root, "index.html");
  let missingAsset = false;
  if (candidate.startsWith(root)) {
    try {
      if ((await stat(candidate)).isFile()) file = candidate;
    } catch {
      missingAsset = pathname.startsWith("/assets/");
    }
  }
  if (missingAsset) {
    response.statusCode = 404;
    response.setHeader("content-type", "text/plain");
    response.end("Asset not found");
    return;
  }
  response.setHeader("content-type", mime[extname(file)] ?? "application/octet-stream");
  response.end(await readFile(file));
});

server.listen(0, "127.0.0.1", async () => {
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server port");
    for (const path of ["/", "/about", "/join", "/privacy", "/terms", "/catalog", "/my-gear", "/bulk-intake", "/loans", "/notifications", "/account", "/administration", "/reset-password", "/steward"]) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      const body = await response.text();
      if (!response.ok || !body.includes('<div id="root">') || !body.includes(`<h1>${title}</h1>`)) {
        throw new Error(`SPA fallback failed for ${path}`);
      }
    }
    const missingAsset = await fetch(`http://127.0.0.1:${address.port}/assets/LoansPage-stale.js`);
    if (missingAsset.status !== 404 || (await missingAsset.text()).includes('<div id="root">')) {
      throw new Error("missing immutable assets must not receive the SPA document");
    }
  } finally {
    server.close();
  }
});
