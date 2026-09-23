import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (mode !== "test") {
    validateGearShareEnvironment(env, mode);
  }
  const presentation = resolveGearSharePresentation(env);

  return {
    server: {
      host: "127.0.0.1",
      port: 8080,
    },
    plugins: [
      react(),
      gearSharePresentationPlugin(presentation),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      css: true,
      maxWorkers: 4,
    },
  };
});

function gearSharePresentationPlugin(presentation: ReturnType<typeof resolveGearSharePresentation>): Plugin {
  return {
    name: "gear-share-presentation",
    transformIndexHtml(html: string) {
      return Object.entries({
        __GEAR_SHARE_NAME__: presentation.gearShareName,
        __COMMUNITY_NAME__: presentation.communityName,
        __GEAR_SHARE_DESCRIPTION__: presentation.description,
        __COMMUNITY_LOGO_URL__: presentation.logoUrl,
        __COMMUNITY_LOGO_ABSOLUTE_URL__: new URL(presentation.logoUrl, presentation.publicOrigin).href,
      }).reduce((result, [marker, value]) => result.replaceAll(marker, escapeHtmlAttribute(value)), html);
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: `${JSON.stringify({
          name: presentation.gearShareName,
          short_name: "Gear Share",
          description: presentation.description,
          start_url: "/",
          display: "standalone",
          background_color: "#EED3BF",
          theme_color: "#C37C67",
          icons: [{ src: presentation.logoUrl, sizes: "any", type: presentation.logoType, purpose: "any" }],
        }, null, 2)}\n`,
      });
    },
  };
}

function escapeHtmlAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function hasUnsafePlainTextCharacter(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === "<" || character === ">" || codePoint <= 31 || codePoint === 127;
  });
}

export function resolveGearSharePresentation(env: Record<string, string | undefined>) {
  const communityName = env.VITE_COMMUNITY_NAME?.trim() || "Community";
  if (communityName.length > 80 || hasUnsafePlainTextCharacter(communityName) || /^https?:\/\//i.test(communityName)) {
    throw new Error("VITE_COMMUNITY_NAME must be 1-80 plain-text characters.");
  }
  const logoUrl = env.VITE_COMMUNITY_LOGO_URL?.trim() || "/favicon.png";
  if (!/^\/[A-Za-z0-9/_-]+\.(?:png|svg|ico)$/.test(logoUrl) || logoUrl.startsWith("//")) {
    throw new Error("VITE_COMMUNITY_LOGO_URL must be a root-relative PNG, SVG, or ICO path.");
  }
  const publicOrigin = env.VITE_PUBLIC_APP_ORIGIN?.trim() || "http://127.0.0.1:8080";
  return {
    communityName,
    gearShareName: `${communityName} Gear Share`,
    description: `A private community app where approved ${communityName} members list, request, borrow, and return outdoor gear.`,
    logoUrl,
    logoType: logoUrl.endsWith(".svg") ? "image/svg+xml" : logoUrl.endsWith(".ico") ? "image/x-icon" : "image/png",
    publicOrigin,
  };
}

const upstreamProjectRefFingerprint = "f8b9a318";
const upstreamPublicHosts = new Set(["communitysupplies.org", "www.communitysupplies.org"]);

function projectRefFingerprint(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function projectRefFromUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname.endsWith(".supabase.co") ? hostname.slice(0, -".supabase.co".length) : "";
  } catch {
    return "";
  }
}

export function validateGearShareEnvironment(
  env: Record<string, string | undefined>,
  mode: string,
) {
  for (const key of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_PUBLIC_APP_ORIGIN", "VITE_PRIVACY_CONTACT_URL", "VITE_BACKUP_RETENTION_DAYS"] as const) {
    if (!env[key]?.trim()) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  resolveGearSharePresentation(env);

  const privacyContact = new URL(env.VITE_PRIVACY_CONTACT_URL!);
  if (privacyContact.protocol !== "https:"
    || upstreamPublicHosts.has(privacyContact.hostname) || privacyContact.hostname.endsWith(".lovable.app")
    || privacyContact.username || privacyContact.password || privacyContact.search || privacyContact.hash) {
    throw new Error("VITE_PRIVACY_CONTACT_URL must be a public HTTPS route without credentials, query, or fragment; known upstream and Lovable preview hosts are denied.");
  }
  if (!/^[1-9][0-9]{0,2}$/.test(env.VITE_BACKUP_RETENTION_DAYS!) || Number(env.VITE_BACKUP_RETENTION_DAYS) > 365) {
    throw new Error("VITE_BACKUP_RETENTION_DAYS must declare an exact maximum from 1 through 365 days.");
  }

  const publicOrigin = new URL(env.VITE_PUBLIC_APP_ORIGIN!);
  const loopbackDevelopment = mode === "development" && publicOrigin.protocol === "http:" && /^(localhost|127(?:\.[0-9]{1,3}){3}|\[::1\])$/.test(publicOrigin.hostname);
  if ((publicOrigin.protocol !== "https:" && !loopbackDevelopment)
    || upstreamPublicHosts.has(publicOrigin.hostname) || publicOrigin.hostname.endsWith(".lovable.app")
    || publicOrigin.username || publicOrigin.password || publicOrigin.pathname !== "/" || publicOrigin.search || publicOrigin.hash) {
    throw new Error("VITE_PUBLIC_APP_ORIGIN must be one exact approved HTTPS origin without credentials, path, query, or fragment; known upstream and Lovable preview hosts are denied.");
  }

  const isUpstream = projectRefFingerprint(projectRefFromUrl(env.VITE_SUPABASE_URL!)) === upstreamProjectRefFingerprint;
  const explicitlyAllowed =
    mode === "upstream-development" &&
    env.VITE_ALLOW_UPSTREAM_DEVELOPMENT === "true";
  if (isUpstream && !explicitlyAllowed) {
    throw new Error(
      "Refusing to use the upstream Community Supplies Supabase project outside explicit upstream-development mode.",
    );
  }
}
