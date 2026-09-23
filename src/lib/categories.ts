import type { GearCategory, GearCondition, GearItem } from "@/types/gear";

export const GEAR_CATEGORIES = [
  { id: "tents-shelters", label: "Tents & Shelters" },
  { id: "sleep-systems", label: "Sleeping Gear" },
  { id: "packs-storage", label: "Packs & Storage" },
  { id: "camp-kitchen", label: "Camp Kitchen & Dining" },
  { id: "water-hydration", label: "Water & Hydration" },
  { id: "tools-repair", label: "Tools & Repair" },
  { id: "safety-first-aid", label: "Safety & First Aid" },
  { id: "program-activity", label: "Program & Activity Gear" },
  { id: "uniforms-apparel", label: "Uniforms & Apparel" },
  { id: "books-guides", label: "Books & Field Guides" },
  { id: "other-gear", label: "Other Gear" },
] as const satisfies readonly { id: GearCategory; label: string }[];

const CATEGORY_LABELS = new Map<string, string>(GEAR_CATEGORIES.map((category) => [category.id, category.label]));

export const GEAR_CONDITIONS = [
  { id: "excellent", label: "Excellent" },
  { id: "good", label: "Good" },
  { id: "fair", label: "Fair" },
  { id: "needs_repair", label: "Needs repair" },
] as const satisfies readonly { id: GearCondition; label: string }[];

const CONDITION_LABELS = new Map<string, string>(GEAR_CONDITIONS.map((condition) => [condition.id, condition.label]));

export function isGearCategory(value: string | null | undefined): value is GearCategory {
  return Boolean(value && CATEGORY_LABELS.has(value));
}

export function categoryLabel(value: string | null | undefined) {
  return value ? CATEGORY_LABELS.get(value) ?? "Category not recognized" : "Category not recorded";
}

export function isGearCondition(value: string | null | undefined): value is GearCondition {
  return Boolean(value && CONDITION_LABELS.has(value));
}

export function conditionLabel(value: string | null | undefined) {
  return value ? CONDITION_LABELS.get(value) ?? "Condition not recognized" : "Condition not recorded";
}

/** Legacy helper retained for workspaces that only need the represented canonical subset. */
export function existingCategories(supplies: GearItem[]) {
  const represented = new Set(supplies.map((item) => item.category).filter(isGearCategory));
  return GEAR_CATEGORIES.filter((category) => represented.has(category.id)).map((category) => category.id);
}

export function canonicalCategory(value: string, _categories: string[] = []): GearCategory {
  if (!isGearCategory(value)) throw new Error("Choose a Scout gear category.");
  return value;
}
