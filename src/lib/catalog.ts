import { isGearCategory, isGearCondition } from "@/lib/categories";
import type { CatalogQuery } from "@/lib/gearShareApi";
import type { OwnershipKind } from "@/types/gear";

const POSTAL_PATTERN = /^[A-Z0-9]+(?:[ -][A-Z0-9]+)?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localDateValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function isCanonicalDate(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function isValidCatalogDateRange(startDate: string, endDate: string, minimumDate = localDateValue()) {
  return isCanonicalDate(startDate) && isCanonicalDate(endDate) && startDate >= minimumDate && endDate >= startDate;
}

export function normalizePostalCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

export function isPostalCode(value: string) {
  return value.length >= 3 && value.length <= 10 && POSTAL_PATTERN.test(value);
}

export function catalogQueryFromParams(params: URLSearchParams): CatalogQuery {
  const normalizedSearch = (params.get("q") ?? "").trim();
  const categoryValue = params.get("category");
  const ownershipValue = params.get("ownership");
  const conditionValue = params.get("condition");
  const normalizedPostal = normalizePostalCode(params.get("postal") ?? "");
  const parsedPage = Number(params.get("page") ?? "1");
  const startValues = params.getAll("start");
  const endValues = params.getAll("end");
  const hasValidDates = startValues.length === 1 && endValues.length === 1 && isValidCatalogDateRange(startValues[0], endValues[0]);
  const availableValues = params.getAll("available");

  return {
    search: normalizedSearch.length <= 100 ? normalizedSearch : "",
    category: isGearCategory(categoryValue) ? categoryValue : "all",
    ownership: ownershipValue === "individual" || ownershipValue === "group" ? ownershipValue as OwnershipKind : "all",
    condition: isGearCondition(conditionValue) ? conditionValue : "all",
    postal: isPostalCode(normalizedPostal) ? normalizedPostal : "all",
    startDate: hasValidDates ? startValues[0] : "",
    endDate: hasValidDates ? endValues[0] : "",
    availableOnly: hasValidDates && availableValues.length === 1 && availableValues[0] === "1",
    page: Number.isInteger(parsedPage) && parsedPage >= 1 && parsedPage <= 1000 ? parsedPage : 1,
  };
}

export function paramsFromCatalogQuery(query: CatalogQuery) {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  if (query.category !== "all") params.set("category", query.category);
  if (query.ownership !== "all") params.set("ownership", query.ownership);
  if (query.condition !== "all") params.set("condition", query.condition);
  if (query.postal !== "all") params.set("postal", query.postal);
  if (isValidCatalogDateRange(query.startDate, query.endDate)) {
    params.set("start", query.startDate);
    params.set("end", query.endDate);
    if (query.availableOnly) params.set("available", "1");
  }
  if (query.page !== 1) params.set("page", String(query.page));
  return params;
}
