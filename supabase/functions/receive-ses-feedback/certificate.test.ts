import { describe, expect, it, vi } from "vitest";
import { createCertificateLoader } from "./certificate";

const url = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-example.pem";
const pem = "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----";
const pair = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, false, ["sign", "verify"]);
function responseAt(body: string, responseUrl: string) {
  const response = new Response(body, { status: 200 });
  Object.defineProperty(response, "url", { value: responseUrl });
  return response;
}

describe("bounded SNS certificate loader", () => {
  it("rejects private DNS answers before fetch", async () => {
    const fetcher = vi.fn(); const keys = await pair();
    const loader = createCertificateLoader({ nowMs: () => 1, resolveDns: async () => ["127.0.0.1"], fetcher: fetcher as typeof fetch, importPem: async () => ({ key: keys.publicKey, notAfterMs: 1000 }) });
    await expect(loader(url, "us-east-1", "2")).rejects.toThrow("invalid certificate host address");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects redirects and oversized certificate responses", async () => {
    const keys = await pair(); const common = { nowMs: () => 1, resolveDns: async (_host: string, type: "A" | "AAAA") => type === "A" ? ["54.239.28.85"] : [], importPem: async () => ({ key: keys.publicKey, notAfterMs: 1000 }) };
    const redirected = createCertificateLoader({ ...common, fetcher: vi.fn().mockResolvedValue(responseAt(pem, "https://example.test/cert.pem")) as typeof fetch });
    await expect(redirected(url, "us-east-1", "2")).rejects.toThrow("signing certificate unavailable");
    const oversized = createCertificateLoader({ ...common, fetcher: vi.fn().mockResolvedValue(responseAt("x".repeat(64 * 1024 + 1), url)) as typeof fetch });
    await expect(oversized(url, "us-east-1", "2")).rejects.toThrow("signing certificate too large");
  });

  it("caches one validated certificate by URL and signature version", async () => {
    const keys = await pair(); const fetcher = vi.fn().mockResolvedValue(responseAt(pem, url)); const importer = vi.fn().mockResolvedValue({ key: keys.publicKey, notAfterMs: 100000 });
    const loader = createCertificateLoader({ nowMs: () => 1, resolveDns: async (_host, type) => type === "A" ? ["54.239.28.85"] : [], fetcher: fetcher as typeof fetch, importPem: importer });
    expect(await loader(url, "us-east-1", "2")).toBe(keys.publicKey);
    expect(await loader(url, "us-east-1", "2")).toBe(keys.publicKey);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(importer).toHaveBeenCalledTimes(1);
  });
});
