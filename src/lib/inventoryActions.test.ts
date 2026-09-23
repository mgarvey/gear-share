import { describe, expect, it } from "vitest";
import { inventoryActionLabel, inventoryActions } from "./inventoryActions";
import type { Membership, GearItem } from "@/types/gear";

const member: Membership = {
  id: "member",
  communityId: "community",
  displayName: "Member",
  status: "active",
  accessLevel: "regular",
};

function supply(overrides: Partial<GearItem> = {}): GearItem {
  return {
    id: "item",
    communityId: "community",
    title: "Tent",
    description: "A tent",
    category: "tents-shelters",
    condition: "good",
    ownershipKind: "individual",
    ownerId: "owner",
    ownerIsActive: true,
    custodianId: "contact",
    custodianName: "Contact",
    custodianPostalCode: null,
    quantityTotal: 1,
    listingStatus: "listed",
    imagePaths: [],
    ...overrides,
  };
}

describe("inventory action policy", () => {
  it("gives an individual owner full listing management regardless of contact", () => {
    const actions = inventoryActions({ ...member, id: "owner" }, supply());
    expect(actions).toMatchObject({ canEdit: true, canManageAvailability: true, canCopy: true, canRemove: true, canReassign: true, canManageMedia: true, isHistorical: false });
    expect(inventoryActionLabel(actions)).toBe("Edit");
  });

  it("gives Custodians global group inventory authority", () => {
    const actions = inventoryActions({ ...member, accessLevel: "custodian" }, supply({ ownershipKind: "group", ownerId: null }));
    expect(actions).toMatchObject({ canEdit: true, canManageAvailability: true, canRemove: true, canReassign: true, canManageMedia: true });
  });

  it("lets elevated inventory roles edit active personal details without controlling availability", () => {
    for (const accessLevel of ["custodian", "administrator"] as const) {
      const actions = inventoryActions({ ...member, accessLevel }, supply());
      expect(actions).toMatchObject({ canEdit: true, canManageAvailability: false, canRemove: false, canManageMedia: true });
    }
  });

  it("gives a Regular user no authority merely because gear is Stored with them", () => {
    const actions = inventoryActions(member, supply({ ownershipKind: "group", ownerId: null, custodianId: member.id }));
    expect(actions).toMatchObject({ canEdit: false, canManageAvailability: false, canRemove: false, canReassign: false });
    expect(inventoryActionLabel(actions)).toBeNull();
  });

  it("gives removed inventory no action, including copy", () => {
    const actions = inventoryActions({ ...member, id: "owner" }, supply({ listingStatus: "retired" }));
    expect(actions).toMatchObject({ isHistorical: true, canEdit: false, canManageAvailability: false, canCopy: false, canRemove: false });
    expect(inventoryActionLabel(actions)).toBeNull();
  });

  it("allows any Administrator to remove inactive-owner individual gear", () => {
    const inactive = supply({ ownerIsActive: false, custodianId: "someone-else" });
    expect(inventoryActions({ ...member, accessLevel: "administrator" }, inactive).canRemove).toBe(true);
    expect(inventoryActions({ ...member, accessLevel: "custodian" }, inactive).canRemove).toBe(false);
  });
});
