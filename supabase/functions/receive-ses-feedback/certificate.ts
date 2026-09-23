import { isPrivateNetworkAddress, validatedCertificateUrl } from "./sns.ts";

const CERT_TIMEOUT_MS = 2_000;
const DNS_TIMEOUT_MS = 2_000;
const CERT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CERT_CACHE = 8;
const MAX_CERT_BYTES = 64 * 1024;

export interface CertificateDependencies {
  nowMs(): number;
  resolveDns(host: string, recordType: "A" | "AAAA"): Promise<string[]>;
  fetcher: typeof fetch;
  importPem(pem: string, signatureVersion: "1" | "2", nowMs: number): Promise<{ key: CryptoKey; notAfterMs: number }>;
}

async function deadline<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("network timeout")), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function boundedText(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_CERT_BYTES) throw new Error("signing certificate too large");
  const reader = response.body?.getReader(); if (!reader) throw new Error("signing certificate unavailable");
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > MAX_CERT_BYTES) { await reader.cancel(); throw new Error("signing certificate too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export function createCertificateLoader(dependencies: CertificateDependencies) {
  const cache = new Map<string, { key: CryptoKey; expiresAt: number }>();
  return async (rawUrl: string, region: string, signatureVersion: "1" | "2") => {
    const url = validatedCertificateUrl(rawUrl, region); const cacheKey = `${signatureVersion}:${url.href}`; const now = dependencies.nowMs();
    const cached = cache.get(cacheKey); if (cached && cached.expiresAt > now) return cached.key;
    const addresses = await deadline(dependencies.resolveDns(url.hostname, "A"), DNS_TIMEOUT_MS);
    const ipv6 = await deadline(dependencies.resolveDns(url.hostname, "AAAA"), DNS_TIMEOUT_MS).catch(() => [] as string[]);
    if (addresses.length === 0 || [...addresses, ...ipv6].some(isPrivateNetworkAddress)) throw new Error("invalid certificate host address");
    const response = await dependencies.fetcher(url, { redirect: "error", signal: AbortSignal.timeout(CERT_TIMEOUT_MS) });
    if (!response.ok || response.url !== url.href) throw new Error("signing certificate unavailable");
    const pem = await boundedText(response); if (!pem.startsWith("-----BEGIN CERTIFICATE-----")) throw new Error("invalid signing certificate");
    const imported = await dependencies.importPem(pem, signatureVersion, now);
    if (imported.notAfterMs <= now) throw new Error("expired signing certificate");
    if (cache.size >= MAX_CERT_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { key: imported.key, expiresAt: Math.min(now + CERT_CACHE_TTL_MS, imported.notAfterMs) });
    return imported.key;
  };
}
