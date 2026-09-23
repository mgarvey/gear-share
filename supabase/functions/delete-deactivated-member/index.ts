import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { handleDeleteMemberRequest } from "./handler.ts";

Deno.serve((request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return new Response('{"code":"configuration"}', { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } });

  const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return handleDeleteMemberRequest(request, {
    env: (name) => Deno.env.get(name) ?? undefined,
    authenticate: async (token) => {
      const caller = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data, error } = await caller.auth.getUser(token);
      return error ? null : data.user?.id ?? null;
    },
    callerRpc: async (token, name, args) => {
      const caller = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
      return caller.rpc(name, args);
    },
    serviceRpc: (name, args) => service.rpc(name, args),
    scrubUserMetadata: async (userId) => {
      const { data, error } = await service.auth.admin.getUserById(userId);
      if (error || !data.user) return { error: error ?? new Error("Auth user unavailable") };
      const cleared = Object.fromEntries(Object.keys(data.user.user_metadata ?? {}).map((key) => [key, null]));
      const result = await service.auth.admin.updateUserById(userId, { user_metadata: cleared });
      return { error: result.error };
    },
    deleteUser: async (userId, shouldSoftDelete) => {
      const { error } = await service.auth.admin.deleteUser(userId, shouldSoftDelete);
      return { error };
    },
    userIsDeleted: async (userId) => {
      const { data, error } = await service.auth.admin.getUserById(userId);
      if (error) {
        if (String(error.message).toLowerCase().includes("not found")) return true;
        throw error;
      }
      return Boolean((data.user as { deleted_at?: string | null } | null)?.deleted_at);
    },
  });
});
