import { describe, expect, it } from "vitest";
import { catalogQueryFromParams, isCanonicalDate, isPostalCode, isValidCatalogDateRange, normalizePostalCode, paramsFromCatalogQuery } from "./catalog";

describe("catalog URL contract", () => {
  it("round-trips every bounded nondefault filter", () => {
    const query = catalogQueryFromParams(new URLSearchParams("q=field+guide&category=books-guides&ownership=group&condition=good&postal=78664&page=3"));
    expect(query).toEqual({ search: "field guide", category: "books-guides", ownership: "group", condition: "good", postal: "78664", startDate: "", endDate: "", availableOnly: false, page: 3 });
    expect(paramsFromCatalogQuery(query).toString()).toBe("q=field+guide&category=books-guides&ownership=group&condition=good&postal=78664&page=3");
  });

  it("normalizes invalid, unsupported, and overlong URL state to safe defaults", () => {
    const query = catalogQueryFromParams(new URLSearchParams(`q=${"x".repeat(101)}&category=invented&ownership=shared&condition=mint&postal=786*&page=1001`));
    expect(query).toEqual({ search: "", category: "all", ownership: "all", condition: "all", postal: "all", startDate: "", endDate: "", availableOnly: false, page: 1 });
    expect(paramsFromCatalogQuery(query).toString()).toBe("");
  });

  it("normalizes complete postal codes without accepting prefix or wildcard discovery", () => {
    expect(normalizePostalCode("  k1a   0b1 ")).toBe("K1A 0B1");
    expect(isPostalCode("K1A 0B1")).toBe(true);
    expect(isPostalCode("786*")).toBe(false);
    expect(isPostalCode("78")).toBe(false);
    expect(isPostalCode("K1A  0B1")).toBe(false);
  });

  it("round-trips one complete future availability range", () => {
    const query = catalogQueryFromParams(new URLSearchParams("start=2099-08-01&end=2099-08-04&available=1"));
    expect(query).toMatchObject({ startDate: "2099-08-01", endDate: "2099-08-04", availableOnly: true });
    expect(paramsFromCatalogQuery(query).toString()).toBe("start=2099-08-01&end=2099-08-04&available=1");
  });

  it("removes partial, repeated, malformed, reversed, and past date state", () => {
    for (const value of [
      "start=2099-08-01",
      "start=2099-08-01&start=2099-08-02&end=2099-08-04",
      "start=2099-02-30&end=2099-03-01",
      "start=2099-08-04&end=2099-08-01",
      "start=2020-01-01&end=2020-01-02",
      "available=1",
    ]) expect(catalogQueryFromParams(new URLSearchParams(value))).toMatchObject({ startDate: "", endDate: "", availableOnly: false });
  });

  it("validates real canonical dates and inclusive ranges", () => {
    expect(isCanonicalDate("2028-02-29")).toBe(true);
    expect(isCanonicalDate("2027-02-29")).toBe(false);
    expect(isValidCatalogDateRange("2099-08-01", "2099-08-01", "2099-01-01")).toBe(true);
  });

  it("omits defaults so the canonical Catalog URL stays compact", () => {
    expect(paramsFromCatalogQuery({ search: "", category: "all", ownership: "all", condition: "all", postal: "all", startDate: "", endDate: "", availableOnly: false, page: 1 }).toString()).toBe("");
  });
});
