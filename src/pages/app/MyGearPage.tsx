import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { GearImage } from "@/components/gear/GearImage";
import { GearListingForm } from "@/components/gear/GearListingForm";
import { InventoryActionLink } from "@/components/gear/InventoryActionLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { categoryLabel } from "@/lib/categories";
import { fetchActiveMembers, fetchSupplies, fetchWantedListingSeed } from "@/lib/gearShareApi";
import type { Membership, GearItem } from "@/types/gear";

export default function MyGearPage({ membership }: { membership: Membership }) {
  const location = useLocation();
  const navigate = useNavigate();
  const wantedRequestId = (location.state as { wantedRequestId?: string } | null)?.wantedRequestId;
  const addRequested = new URLSearchParams(location.search).get("add") === "1";
  const wantedSeed = useQuery({ queryKey: ["wanted-listing-seed", wantedRequestId], queryFn: () => fetchWantedListingSeed(wantedRequestId!), enabled: Boolean(wantedRequestId), retry: false });
  const wantedDraft = wantedSeed.data;
  const supplies = useQuery({ queryKey: ["gear-share-supplies"], queryFn: fetchSupplies });
  const members = useQuery({ queryKey: ["active-members"], queryFn: () => fetchActiveMembers(), enabled: membership.accessLevel !== "regular" });
  const [showRemoved, setShowRemoved] = useState(false);
  const [adding, setAdding] = useState(Boolean(wantedRequestId) || addRequested);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (addRequested) setAdding(true); }, [addRequested]);
  const closeAdd = () => {
    setAdding(false);
    if (wantedRequestId || addRequested) navigate(location.pathname, { replace: true, state: null });
  };
  const owned = (supplies.data ?? []).filter((item) => item.ownerId === membership.id);
  const activeMine = owned.filter((item) => item.listingStatus !== "retired");
  const removedMine = owned.filter((item) => item.listingStatus === "retired");

  return (
    <main className="container mx-auto p-4 md:p-8">
      <div className="space-y-10">
        <section>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h1 className="mb-2 font-serif text-3xl font-bold">My gear</h1><p className="text-muted-foreground">Add gear you’re willing to lend. Drafts stay private until you publish them.</p></div><Button ref={addButton} onClick={() => setAdding(true)}><Plus aria-hidden="true" /> Add gear</Button></div>
          {activeMine.length === 0 ? <p className="rounded-lg border p-8 text-center text-muted-foreground">You haven’t added any gear yet.</p> : null}
          <div className="grid gap-3 lg:grid-cols-2">
            {activeMine.map((item) => <GearSummary key={item.id} item={item} membership={membership} />)}
            {removedMine.length > 0 ? <div className="lg:col-span-2">
              <Button size="sm" variant="ghost" onClick={() => setShowRemoved((value) => !value)}>{showRemoved ? "Hide removed history" : `Show removed history (${removedMine.length})`}</Button>
              {showRemoved ? <div className="mt-3 space-y-3">{removedMine.map((item) => <GearSummary key={item.id} item={item} membership={membership} />)}</div> : null}
            </div> : null}
          </div>
        </section>
      </div>
      <Dialog open={adding} onOpenChange={(open) => { if (open) setAdding(true); else closeAdd(); }}><DialogContent className="p-0 sm:max-w-2xl" onCloseAutoFocus={(event) => { event.preventDefault(); addButton.current?.focus(); }}><DialogHeader className="sr-only"><DialogTitle>Add gear</DialogTitle><DialogDescription>Review the listing and publish when ready.</DialogDescription></DialogHeader>{wantedSeed.isLoading ? <p className="p-6">Loading the wanted request…</p> : wantedSeed.error ? <div className="space-y-3 p-6"><p className="text-destructive">{(wantedSeed.error as Error).message}</p><Button variant="outline" onClick={closeAdd}>Close</Button></div> : <GearListingForm supplies={supplies.data ?? []} membershipId={membership.id} members={members.data ?? []} allowGroup={membership.accessLevel !== "regular" && !wantedDraft} initialDraft={wantedDraft ? { title: wantedDraft.title ?? "", description: wantedDraft.description ?? "", category: wantedDraft.category ?? "", quantity: Math.min(99, Math.max(1, wantedDraft.quantity ?? 1)) } : undefined} context={wantedDraft ? <p className="rounded-md bg-muted p-3 text-sm">Started from a wanted request. Review the listing, publish it, then offer it to the requester.</p> : undefined} onCancel={closeAdd} onCreated={(ownership) => { closeAdd(); if (ownership === "group") navigate("/inventory", { replace: true }); }} />}</DialogContent></Dialog>
    </main>
  );
}

function GearSummary({ item, membership }: { item: GearItem; membership: Membership }) {
  const removed = item.listingStatus === "retired";
  return <Card><CardHeader><CardTitle className="flex justify-between gap-3"><span>{item.title}</span><span className="text-sm font-sans font-normal">{removed ? "Removed" : item.listingStatus === "unlisted" ? "Draft" : "Published"}</span></CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
    <p>{item.ownershipKind === "group" ? "Group gear" : "Member gear"} · with {item.custodianName}</p>
    <GearImage imagePath={item.imagePaths[0]} title={item.title} className="max-w-sm" />
    {removed ? <p className="rounded-md bg-muted p-3 text-muted-foreground">This listing was removed from active inventory permanently. Its lending history is retained.</p> : <>
      {item.listingStatus === "unlisted" ? <p className="rounded-md bg-muted p-3">This draft is private. Edit it when you’re ready to publish or discard it.</p> : null}
      <p>{item.description || "No description."}</p>
      <p><strong>Category:</strong> {categoryLabel(item.category)}</p>
      <p><strong>Total quantity:</strong> {item.quantityTotal}</p>
      <InventoryActionLink item={item} membership={membership} />
    </>}
  </CardContent></Card>;
}
