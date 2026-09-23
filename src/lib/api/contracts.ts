import type { GearItem } from "@/types/gear";

export type GearImageTarget = Pick<
  GearItem,
  "id" | "communityId" | "imagePaths" | "guidelineVersion"
>;
