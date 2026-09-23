import type {
  GearCategory,
  GearCondition,
  ListingStatus,
  OwnershipKind,
  GearItem,
} from "@/types/gear";
import { db, recoveryRpc } from "./client";
import type { GearImageTarget } from "./contracts";
import {
  enrichSupplyAttention,
  enrichSupplyGuidelines,
  mapCatalogSupply,
  mapPrivateSupply,
} from "./supplyMappers";

export interface CatalogQuery {
  search: string;
  category: GearCategory | "all";
  ownership: OwnershipKind | "all";
  condition: GearCondition | "all";
  postal: string | "all";
  startDate: string;
  endDate: string;
  availableOnly: boolean;
  page: number;
}

export interface CatalogPage {
  items: GearItem[];
  total: number;
  page: number;
  totalPages: number;
}

export async function fetchSupplies(): Promise<GearItem[]> {
  const { data, error } = await recoveryRpc("private_supplies", {});
  if (error) throw error;
  return enrichSupplyGuidelines(
    await enrichSupplyAttention((data ?? []).map(mapPrivateSupply)),
  );
}

export async function fetchSupplyDetail(
  supplyId: string,
): Promise<GearItem | null> {
  const { data, error } = await recoveryRpc("private_supply_detail", {
    target_supply_id: supplyId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return (
    await enrichSupplyGuidelines(
      await enrichSupplyAttention([mapPrivateSupply(row)]),
    )
  )[0] ?? null;
}

export async function fetchCatalog(query: CatalogQuery): Promise<CatalogPage> {
  const { data, error } = await db.rpc("private_gear_catalog", {
    supplied_search: query.search,
    supplied_category: query.category,
    supplied_ownership: query.ownership,
    supplied_condition: query.condition,
    supplied_postal: query.postal,
    supplied_page: query.page,
    supplied_start: query.startDate || null,
    supplied_end: query.endDate || null,
    supplied_available_only: query.availableOnly,
  });
  if (error) throw error;
  const rows = data ?? [];
  const total = Number(rows[0]?.total_count ?? 0);
  const resolvedPage = Number(rows[0]?.resolved_page ?? 1);
  return {
    items: await enrichSupplyAttention(rows.map(mapCatalogSupply)),
    total,
    page: resolvedPage,
    totalPages: Math.max(1, Math.ceil(total / 24)),
  };
}

export async function fetchMyPostalCode(): Promise<string> {
  const { data, error } = await db.rpc("get_my_postal_code");
  if (error) throw error;
  return data ?? "";
}

export async function fetchListingPostalCode(
  supplyId: string,
): Promise<string> {
  const { data, error } = await db.rpc("private_listing_postal_code", {
    target_supply_id: supplyId,
  });
  if (error) throw error;
  return data ?? "";
}

export async function setMyPostalCode(postalCode: string): Promise<string> {
  const { data, error } = await db.rpc("set_my_postal_code", {
    supplied_postal: postalCode || null,
  });
  if (error) throw error;
  return data ?? "";
}

export async function createIndividualSupply(input: {
  title: string;
  description: string;
  category: GearCategory;
  condition: GearCondition;
  quantity: number;
  status: ListingStatus;
}): Promise<GearImageTarget> {
  const { data, error } = await db.rpc("create_individual_supply", {
    supplied_title: input.title,
    supplied_description: input.description,
    supplied_category: input.category || null,
    supplied_condition: input.condition,
    supplied_quantity: input.quantity,
    supplied_status: input.status,
  });
  if (error) throw error;
  if (!data)
    throw new Error("The listing was created without a usable response.");
  return {
    id: data.id,
    communityId: data.community_id,
    imagePaths: data.image_paths ?? [],
  };
}

export async function createGroupSupply(input: {
  title: string;
  description: string;
  category: GearCategory;
  condition: GearCondition;
  quantity: number;
  custodianId: string;
  status: ListingStatus;
}): Promise<GearImageTarget> {
  const { data, error } = await db.rpc("create_group_supply", {
    supplied_title: input.title,
    supplied_description: input.description,
    supplied_category: input.category || null,
    supplied_condition: input.condition,
    supplied_quantity: input.quantity,
    supplied_custodian_id: input.custodianId,
    supplied_status: input.status,
  });
  if (error) throw error;
  if (!data)
    throw new Error("The listing was created without a usable response.");
  return {
    id: data.id,
    communityId: data.community_id,
    imagePaths: data.image_paths ?? [],
  };
}

export async function updateSupply(input: {
  id: string;
  title: string;
  description: string;
  category: GearCategory;
  condition: GearCondition;
  quantity: number;
  status: ListingStatus;
  guidelineVersion?: number;
  borrowingGuidelines?: string[];
}) {
  const args = {
    target_supply_id: input.id,
    supplied_title: input.title,
    supplied_description: input.description,
    supplied_category: input.category,
    supplied_condition: input.condition,
    supplied_quantity: input.quantity,
    supplied_status: input.status,
  };
  const { error } = input.borrowingGuidelines
    ? await recoveryRpc("update_supply_with_guidelines", {
        ...args,
        supplied_expected_guideline_version: input.guidelineVersion ?? 0,
        supplied_guidelines: input.borrowingGuidelines,
      })
    : await recoveryRpc("update_supply", args);
  if (error) throw error;
}

export async function retireSupply(supplyId: string) {
  const { error } = await db.rpc("retire_supply", {
    target_supply_id: supplyId,
  });
  if (error) throw error;
}

export async function convertIndividualDonation(
  supplyId: string,
  custodianId: string,
) {
  const { error } = await db.rpc("convert_individual_donation", {
    target_supply_id: supplyId,
    new_custodian_id: custodianId,
  });
  if (error) throw error;
}

export async function reassignGroupCustodian(
  supplyId: string,
  custodianId: string,
) {
  const { error } = await db.rpc("reassign_group_custodian", {
    target_supply_id: supplyId,
    new_custodian_id: custodianId,
  });
  if (error) throw error;
}

export async function setSupplyContact(supplyId: string, contactId: string) {
  const { error } = await db.rpc("set_supply_contact", {
    target_supply_id: supplyId,
    new_contact_id: contactId,
  });
  if (error) throw error;
}
