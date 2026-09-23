import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { handleDraftRequest } from "./handler.ts";
import { sanitizeAiJpeg } from "./image.ts";
import { hmacSafetyIdentifier } from "./safety.ts";

Deno.serve((request) => {
  const url = Deno.env.get("SUPABASE_URL"); const anonKey = Deno.env.get("SUPABASE_ANON_KEY"); const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return new Response('{"code":"configuration"}', { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  return handleDraftRequest(request, {
    env: (name) => Deno.env.get(name) ?? undefined,
    authenticate: async (token) => { const caller = createClient(url, anonKey, { auth: { persistSession: false } }); const { data, error } = await caller.auth.getUser(token); return error ? null : data.user?.id ?? null; },
    rpc: (name, args) => service.rpc(name, args), fetcher: fetch, sanitize: sanitizeAiJpeg, hmac: hmacSafetyIdentifier,
  });
});
