import { X509Certificate } from "npm:@peculiar/x509@1.12.3";
import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { createCertificateLoader } from "./certificate.ts";
import { handleFeedbackRequest } from "./handler.ts";

const MAX_REQUESTS_PER_MINUTE = 120;
const CONFIRMATION_TIMEOUT_MS = 2_000;
let recentRequests: number[] = [];

const certificateKey = createCertificateLoader({
  nowMs: () => Date.now(),
  resolveDns: (host, recordType) => Deno.resolveDns(host, recordType),
  fetcher: fetch,
  importPem: async (pem, signatureVersion, nowMs) => {
    const certificate = new X509Certificate(pem);
    if (certificate.notBefore.getTime() > nowMs || certificate.notAfter.getTime() <= nowMs) throw new Error("expired signing certificate");
    const key = await crypto.subtle.importKey("spki", certificate.publicKey.rawData, { name: "RSASSA-PKCS1-v1_5", hash: signatureVersion === "1" ? "SHA-1" : "SHA-256" }, false, ["verify"]);
    return { key, notAfterMs: certificate.notAfter.getTime() };
  },
});

Deno.serve(async (request) => {
  const url = Deno.env.get("SUPABASE_URL"); const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return new Response('{"error":"feedback receiver configuration unavailable"}', { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  return handleFeedbackRequest(request, {
    env: (name) => Deno.env.get(name) ?? undefined,
    nowMs: () => Date.now(),
    allowRequest: () => {
      const cutoff = Date.now() - 60_000; recentRequests = recentRequests.filter((timestamp) => timestamp >= cutoff);
      if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) return false;
      recentRequests.push(Date.now()); return true;
    },
    certificateKey,
    confirmSubscription: async (confirmationUrl) => {
      const response = await fetch(confirmationUrl, { method: "GET", redirect: "error", signal: AbortSignal.timeout(CONFIRMATION_TIMEOUT_MS) });
      if (!response.ok || response.url !== confirmationUrl.href) throw new Error("subscription confirmation failed");
      await response.body?.cancel();
    },
    rpc: (name, args) => service.rpc(name, args),
  });
});
