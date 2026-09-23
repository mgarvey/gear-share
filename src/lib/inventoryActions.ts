import type { Membership, GearItem } from "@/types/gear";

export interface InventoryActions {
  isHistorical: boolean;
  canEdit: boolean;
  canManageAvailability: boolean;
  canCopy: boolean;
  canRemove: boolean;
  canDonate: boolean;
  canReassign: boolean;
  canManageMedia: boolean;
}

export function inventoryActions(membership: Membership, item: GearItem): InventoryActions {
  const isHistorical = item.listingStatus === "retired";
  const isIndividualOwner = item.ownershipKind === "individual"
    && item.ownerId === membership.id;
  const isAdministrator = membership.accessLevel === "administrator";
  const isInventoryManager = isAdministrator || membership.accessLevel === "custodian";
  const activeIndividual = item.ownershipKind === "individual" && item.ownerIsActive;
  const canEdit = !isHistorical && (
    isIndividualOwner
    || (isInventoryManager && (item.ownershipKind === "group" || activeIndividual))
  );
  const canManageAvailability = !isHistorical && (
    isIndividualOwner
    || (item.ownershipKind === "group" && isInventoryManager)
  );
  const canRemove = !isHistorical && (
    isIndividualOwner
    || (isInventoryManager && item.ownershipKind === "group")
    || (isAdministrator && item.ownershipKind === "individual" && item.ownerIsActive === false)
  );

  return {
    isHistorical,
    canEdit,
    canManageAvailability,
    canCopy: !isHistorical && item.listingStatus === "listed",
    canRemove,
    canDonate: !isHistorical && isAdministrator && item.ownershipKind === "individual",
    canReassign: !isHistorical && (
      (isIndividualOwner && item.ownerIsActive)
      || (isInventoryManager && (item.ownershipKind === "group" || activeIndividual))
    ),
    canManageMedia: canEdit,
  };
}

export function inventoryActionLabel(actions: InventoryActions) {
  if (actions.canEdit) return "Edit";
  if (actions.canManageAvailability) return "Manage availability";
  return null;
}
