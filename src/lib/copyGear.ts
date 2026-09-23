import { canonicalCategory } from "@/lib/categories";
import type { GearItem } from "@/types/gear";

export interface IndividualGearDraft {
  title: string;
  description: string;
  category: string;
  quantity: number;
}

export function isCopySource(item: GearItem | undefined): item is GearItem {
  return Boolean(item && item.listingStatus === "listed");
}

export function copyDraftFromSupply(item: GearItem, categories: string[]): IndividualGearDraft {
  return {
    title: item.title,
    description: item.description,
    category: canonicalCategory(item.category ?? "", categories),
    quantity: 1,
  };
}
