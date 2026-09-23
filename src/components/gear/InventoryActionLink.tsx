import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { inventoryActionLabel, inventoryActions } from "@/lib/inventoryActions";
import type { Membership, GearItem } from "@/types/gear";

export function InventoryActionLink({ item, membership }: { item: GearItem; membership: Membership }) {
  const location = useLocation();
  const label = inventoryActionLabel(inventoryActions(membership, item));
  if (!label) return null;

  return (
    <Button asChild size="sm" variant="outline">
      <Link
        to={`/gear/${encodeURIComponent(item.id)}/manage`}
        state={{ returnTo: `${location.pathname}${location.search}` }}
      >
        {label}
      </Link>
    </Button>
  );
}
