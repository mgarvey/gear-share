import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { handleInvitationRequest } from "./handler.ts";

Deno.serve((request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return new Response('{"code":"configuration"}', {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return handleInvitationRequest(request, {
    env: (name) => Deno.env.get(name) ?? undefined,
    authenticate: async (token) => {
      const caller = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data, error } = await caller.auth.getUser(token);
      return error ? null : data.user?.id ?? null;
    },
    rpc: (name, args) => service.rpc(name, args),
    inviteUser: async (email, displayName, redirectTo) => {
      const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
        data: { display_name: displayName },
        redirectTo,
      });
      return { userId: data.user?.id ?? null, error };
    },
  });
});
