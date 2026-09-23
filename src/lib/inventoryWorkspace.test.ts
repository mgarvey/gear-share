import { describe, expect, it } from "vitest";
import { criteriaFromSearchParams, INVENTORY_PAGE_SIZE, inventoryResults } from "./inventoryWorkspace";
import type { GearItem } from "@/types/gear";

function supply(id: string, overrides: Partial<GearItem> = {}): GearItem {
  return {
    id,
    communityId: "community",
    title: `Item ${id}`,
    description: "Shared equipment",
    category: "tents-shelters",
    condition: "good",
    ownershipKind: "group",
    ownerId: null,
    ownerIsActive: false,
    custodianId: "manager",
    custodianName: "Alex Manager",
    custodianPostalCode: null,
    quantityTotal: 1,
    listingStatus: "listed",
    imagePaths: [],
    ...overrides,
  };
}

describe("coordinator inventory results", () => {
  it("parses supported query state and rejects invalid values", () => {
    expect(criteriaFromSearchParams(new URLSearchParams("q=tent&ownership=group&status=retired&manager=m&page=3"))).toEqual({
      search: "tent", category: "", status: "retired", managerId: "m", page: 3,
    });
    expect(criteriaFromSearchParams(new URLSearchParams("ownership=individual&status=forged&page=-2"))).toMatchObject({ status: "active", page: 1 });
    expect(criteriaFromSearchParams(new URLSearchParams("q=Group+item+"))).toMatchObject({ search: "Group item " });
  });

  it("searches group-owned fields case-insensitively, combines filters, and ignores legacy ownership queries", () => {
    const supplies = [
      supply("a", { title: "Family Tent", category: "tents-shelters", ownershipKind: "individual", ownerId: "owner", custodianId: "lisa", custodianName: "Lisa" }),
      supply("b", { description: "WHITE GAS burner", category: "camp-kitchen", custodianId: "ben", custodianName: "Ben" }),
      supply("d", { title: "Patrol shelter", custodianId: "lisa", custodianName: "Lisa" }),
      supply("c", { title: "Retired stove", category: "camp-kitchen", custodianId: "ben", custodianName: "Ben", listingStatus: "retired" }),
    ];
    expect(inventoryResults(supplies, { search: "white gas", category: "camp-kitchen", status: "active", managerId: "ben", page: 1 }).items.map((item) => item.id)).toEqual(["b"]);
    expect(inventoryResults(supplies, { search: "LISA", category: "", status: "all", managerId: "", page: 1 }).items.map((item) => item.id)).toEqual(["d"]);
    expect(criteriaFromSearchParams(new URLSearchParams("ownership=individual"))).not.toHaveProperty("ownership");
  });

  it("defaults to active inventory and exposes removed items only deliberately", () => {
    const supplies = [supply("active"), supply("removed", { listingStatus: "retired" })];
    expect(inventoryResults(supplies, { search: "", category: "", status: "active", managerId: "", page: 1 }).items.map((item) => item.id)).toEqual(["active"]);
    expect(inventoryResults(supplies, { search: "", category: "", status: "retired", managerId: "", page: 1 }).items.map((item) => item.id)).toEqual(["removed"]);
  });

  it("sorts by name with an ID tie-breaker and bounds pages to 25 results", () => {
    const supplies = Array.from({ length: INVENTORY_PAGE_SIZE + 2 }, (_, index) => supply(String(index).padStart(2, "0"), { title: index < 2 ? "Alpha" : `Item ${String(index).padStart(2, "0")}` }));
    const first = inventoryResults(supplies, { search: "", category: "", status: "active", managerId: "", page: 1 });
    const second = inventoryResults(supplies, { search: "", category: "", status: "active", managerId: "", page: 2 });
    expect(first.items).toHaveLength(INVENTORY_PAGE_SIZE);
    expect(first.items.slice(0, 2).map((item) => item.id)).toEqual(["00", "01"]);
    expect(second.items).toHaveLength(2);
    expect(second.totalPages).toBe(2);
    expect(inventoryResults(supplies, { search: "", category: "", status: "active", managerId: "", page: 99 }).page).toBe(2);
  });
});
