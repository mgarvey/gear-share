import type { GearItem } from "@/types/gear";
import { fetchRecoveryRowsInIdBatches } from "./client";

export function mapPrivateSupply(row: any): GearItem {
  return {
    id: row.id,
    communityId: row.community_id,
    title: row.title,
    description: row.description,
    category: row.category,
    condition: row.condition,
    ownershipKind: row.ownership_kind,
    ownerId: row.owner_id,
    ownerIsActive: Boolean(row.owner_is_active),
    custodianId: row.custodian_id,
    custodianName: row.custodian_name,
    custodianPostalCode: null,
    quantityTotal: row.quantity_total,
    listingStatus: row.listing_status,
    imagePaths: row.image_paths ?? [],
    publicationAttemptId: row.publication_attempt_id ?? null,
    publicationExpectedImages: Number(row.publication_expected_images ?? 0),
    needsAttention: false,
    needsAttentionReason: null,
    needsAttentionVersion: 0,
    guidelineVersion: Number(row.guideline_version ?? 0),
    borrowingGuidelines: [],
  };
}

export function mapCatalogSupply(row: any): GearItem {
  return {
    id: row.id,
    communityId: row.community_id,
    title: row.title,
    description: row.description,
    category: row.category,
    condition: row.condition,
    ownershipKind: row.ownership_kind,
    ownerId: row.owner_id,
    ownerIsActive: row.owner_is_active,
    custodianId: row.custodian_id,
    custodianName: row.custodian_name ?? "Community member",
    custodianPostalCode: row.custodian_postal_code,
    quantityTotal: row.quantity_total,
    availableQuantity: row.available_quantity == null ? null : Number(row.available_quantity),
    listingStatus: row.listing_status,
    imagePaths: row.image_paths ?? [],
    publicationAttemptId: null,
    publicationExpectedImages: 0,
    needsAttention: false,
    needsAttentionReason: null,
    needsAttentionVersion: 0,
    guidelineVersion: Number(row.guideline_version ?? 0),
    borrowingGuidelines: [],
  };
}

export async function enrichSupplyAttention(
  items: GearItem[],
): Promise<GearItem[]> {
  if (items.length === 0) return items;
  const rows = await fetchRecoveryRowsInIdBatches(
    "private_supply_attention_flags",
    items.map((item) => item.id),
  );
  const flags = new Map(rows.map((row: any) => [row.supply_id, row]));
  return items.map((item) => {
    const flag: any = flags.get(item.id);
    return {
      ...item,
      needsAttention: Boolean(flag?.needs_attention),
      needsAttentionReason: flag?.reason ?? null,
      needsAttentionVersion: Number(flag?.version ?? 0),
    };
  });
}

export async function enrichSupplyGuidelines(
  items: GearItem[],
): Promise<GearItem[]> {
  if (items.length === 0) return items;
  const rows = await fetchRecoveryRowsInIdBatches(
    "private_supply_guidelines_batch",
    items.map((item) => item.id),
  );
  const guidelines = new Map(rows.map((row: any) => [row.supply_id, row]));
  return items.map((item) => {
    const row: any = guidelines.get(item.id);
    return {
      ...item,
      guidelineVersion: Number(row?.guideline_version ?? 0),
      borrowingGuidelines: row?.rules ?? [],
    };
  });
}
