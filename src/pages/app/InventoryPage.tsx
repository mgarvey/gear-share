import { useQuery } from "@tanstack/react-query";
import { CoordinatorInventory } from "@/components/gear/CoordinatorInventory";
import { fetchActiveMembers, fetchSupplies } from "@/lib/gearShareApi";
import type { Membership } from "@/types/gear";

export default function InventoryPage({ membership }: { membership: Membership }) {
  const supplies = useQuery({ queryKey: ["gear-share-supplies"], queryFn: fetchSupplies });
  const members = useQuery({ queryKey: ["active-members"], queryFn: () => fetchActiveMembers() });
  return <main className="container mx-auto p-4 md:p-8"><CoordinatorInventory membership={membership} supplies={supplies.data ?? []} members={members.data ?? []} isLoading={supplies.isLoading} error={supplies.error as Error | null} /></main>;
}
