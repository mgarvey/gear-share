import { describe, expect, it } from "vitest";
import { copyDraftFromSupply, isCopySource } from "./copyGear";
import type { GearItem } from "@/types/gear";

const source: GearItem = {
  id: "source-id",
  communityId: "community",
  title: "Coleman stove",
  description: "Two-burner camp stove",
  category: "camp-kitchen",
  condition: "good",
  ownershipKind: "group",
  ownerId: null,
  ownerIsActive: false,
  custodianId: "manager",
  custodianName: "Manager",
  custodianPostalCode: null,
  quantityTotal: 6,
  listingStatus: "listed",
  imagePaths: ["community/source/photo.jpg"],
};

describe("copy-to-my-gear initialization", () => {
  it("allowlists descriptive fields, canonicalizes category, and forces quantity one", () => {
    const draft = copyDraftFromSupply(source, ["camp-kitchen", "tents-shelters"]);
    expect(draft).toEqual({ title: "Coleman stove", description: "Two-burner camp stove", category: "camp-kitchen", quantity: 1 });
    expect(Object.keys(draft).sort()).toEqual(["category", "description", "quantity", "title"]);
    expect(JSON.stringify(draft)).not.toContain(source.id);
    expect(JSON.stringify(draft)).not.toContain(source.custodianId);
    expect(JSON.stringify(draft)).not.toContain(source.imagePaths[0]);
  });

  it("accepts only currently listed sources", () => {
    expect(isCopySource(source)).toBe(true);
    expect(isCopySource({ ...source, listingStatus: "unlisted" })).toBe(false);
    expect(isCopySource({ ...source, listingStatus: "retired" })).toBe(false);
    expect(isCopySource(undefined)).toBe(false);
  });
});
