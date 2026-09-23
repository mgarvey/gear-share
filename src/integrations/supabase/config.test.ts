import { describe, expect, it } from "vitest";
import { getSupabaseConfig } from "./config";

const localConfig = {
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_ANON_KEY: "local-anon-key",
};
const knownUpstreamRef = "mbmmfgivh" + "qzhjyneyelu";

describe("getSupabaseConfig", () => {
  it("accepts explicit gear share configuration", () => {
    expect(getSupabaseConfig(localConfig)).toEqual({
      url: localConfig.VITE_SUPABASE_URL,
      anonKey: localConfig.VITE_SUPABASE_ANON_KEY,
    });
  });

  it.each(["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"] as const)(
    "fails closed when %s is missing",
    (key) => {
      expect(() => getSupabaseConfig({ ...localConfig, [key]: "" })).toThrow(key);
    },
  );

  it("rejects the known upstream project by default", () => {
    expect(() =>
      getSupabaseConfig({
        ...localConfig,
        VITE_SUPABASE_URL: `https://${knownUpstreamRef}.supabase.co`,
      }),
    ).toThrow("Refusing to use the upstream");
  });

  it("allows upstream only in the explicit non-gear share development mode", () => {
    expect(
      getSupabaseConfig({
        ...localConfig,
        VITE_SUPABASE_URL: `https://${knownUpstreamRef}.supabase.co`,
        MODE: "upstream-development",
        VITE_ALLOW_UPSTREAM_DEVELOPMENT: "true",
      }).url,
    ).toContain(knownUpstreamRef);
  });
});
