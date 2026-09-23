const upstreamProjectRefFingerprint = "f8b9a318";

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

type SupabaseEnvironment = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_ALLOW_UPSTREAM_DEVELOPMENT?: string;
  MODE?: string;
};

export function getSupabaseConfig(env: SupabaseEnvironment) {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();

  if (!url) {
    throw new Error("Missing required environment variable: VITE_SUPABASE_URL");
  }
  if (!anonKey) {
    throw new Error("Missing required environment variable: VITE_SUPABASE_ANON_KEY");
  }

  const explicitlyAllowed =
    env.MODE === "upstream-development" &&
    env.VITE_ALLOW_UPSTREAM_DEVELOPMENT === "true";
  if (projectRefFingerprint(projectRefFromUrl(url)) === upstreamProjectRefFingerprint && !explicitlyAllowed) {
    throw new Error(
      "Refusing to use the upstream Community Supplies Supabase project outside explicit upstream-development mode.",
    );
  }

  return { url, anonKey };
}
