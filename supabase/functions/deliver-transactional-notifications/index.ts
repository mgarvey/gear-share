import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { handleDeliveryRequest } from "./handler.ts";

Deno.serve((request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return new Response('{"error":"transactional delivery configuration unavailable"}', { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  return handleDeliveryRequest(request, {
    env: (name) => Deno.env.get(name) ?? undefined,
    rpc: (name, args) => service.rpc(name, args),
    fetcher: fetch,
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
  });
});
