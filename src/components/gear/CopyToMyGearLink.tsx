import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { inventoryActions } from "@/lib/inventoryActions";
import type { Membership, GearItem } from "@/types/gear";

export function CopyToMyGearLink({ item, membership }: { item: GearItem; membership: Membership }) {
  const location = useLocation();
  if (!inventoryActions(membership, item).canCopy) return null;
  return <Button asChild size="sm" variant="outline"><Link to={`/gear/${encodeURIComponent(item.id)}/copy`} state={{ returnTo: `${location.pathname}${location.search}` }}>List a similar item</Link></Button>;
}
