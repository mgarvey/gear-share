import type { ListingStatus, GearItem } from "@/types/gear";

export const INVENTORY_PAGE_SIZE = 25;

export type InventoryStatusFilter = "active" | ListingStatus | "all";

export interface InventoryCriteria {
  search: string;
  category: string;
  status: InventoryStatusFilter;
  managerId: string;
  page: number;
}

export interface InventoryResult {
  items: GearItem[];
  total: number;
  totalPages: number;
  page: number;
}

export function criteriaFromSearchParams(params: URLSearchParams): InventoryCriteria {
  const status = params.get("status");
  const parsedPage = Number.parseInt(params.get("page") ?? "1", 10);
  return {
    search: params.get("q") ?? "",
    category: params.get("category") ?? "",
    status: status === "listed" || status === "unlisted" || status === "retired" || status === "all" ? status : "active",
    managerId: params.get("manager") ?? "",
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  };
}

export function inventoryResults(supplies: GearItem[], criteria: InventoryCriteria): InventoryResult {
  const needle = criteria.search.trim().toLocaleLowerCase();
  const matches = supplies
    .filter((item) => {
      const searchable = [item.title, item.description, item.category ?? "", item.custodianName]
        .join("\n")
        .toLocaleLowerCase();
      const statusMatches = criteria.status === "all"
        || (criteria.status === "active" ? item.listingStatus !== "retired" : item.listingStatus === criteria.status);
      return (!needle || searchable.includes(needle))
        && item.ownershipKind === "group"
        && (!criteria.category || item.category === criteria.category)
        && statusMatches
        && (!criteria.managerId || item.custodianId === criteria.managerId);
    })
    .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  const totalPages = Math.max(1, Math.ceil(matches.length / INVENTORY_PAGE_SIZE));
  const page = Math.min(criteria.page, totalPages);
  const start = (page - 1) * INVENTORY_PAGE_SIZE;
  return { items: matches.slice(start, start + INVENTORY_PAGE_SIZE), total: matches.length, totalPages, page };
}
