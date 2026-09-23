import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { CopyToMyGearLink } from "@/components/gear/CopyToMyGearLink";
import { GearGallery } from "@/components/gear/GearGallery";
import { InventoryActionLink } from "@/components/gear/InventoryActionLink";
import { LoanRequestForm } from "@/components/gear/LoanRequestForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { inventoryActions } from "@/lib/inventoryActions";
import { categoryLabel, conditionLabel } from "@/lib/categories";
import { safeReturnPath, type ReturnState } from "@/lib/navigation";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchListingPostalCode,
  fetchSupplyDetail,
  setSupplyNeedsAttention,
} from "@/lib/gearShareApi";
import type { Membership } from "@/types/gear";

export default function GearDetailPage({
  membership,
}: {
  membership: Membership;
}) {
  const { supplyId = "" } = useParams();
  const location = useLocation();
  const routeState = location.state as { wantedContext?: { quantity?: number; startDate?: string; endDate?: string }; catalogDates?: { startDate: string; endDate: string } } | null;
  const wantedContext = routeState?.wantedContext;
  const initialRequestValues = wantedContext ?? routeState?.catalogDates;
  const returnTo = safeReturnPath(
    (location.state as ReturnState)?.returnTo,
    "/catalog",
  );
  const supply = useQuery({
    queryKey: ["gear-share-supply-detail", supplyId],
    queryFn: () => fetchSupplyDetail(supplyId),
    enabled: Boolean(supplyId),
  });
  const postal = useQuery({
    queryKey: ["listing-postal", supplyId],
    queryFn: () => fetchListingPostalCode(supplyId),
    enabled: Boolean(supplyId),
  });
  const item = supply.data;
  const itemId = item?.id;
  const requestPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!itemId || location.hash !== "#request") return;
    requestPanelRef.current?.scrollIntoView({ block: "start" });
  }, [itemId, location.hash]);

  if (supply.isLoading)
    return (
      <main className="container mx-auto p-4 md:p-8">
        <p>Loading gear…</p>
      </main>
    );
  if (supply.error || !item || item.listingStatus === "retired") {
    return (
      <UnavailableDetail
        returnTo={returnTo}
        detail={
          supply.error
            ? (supply.error as Error).message
            : "This listing is unavailable or you no longer have access to it."
        }
      />
    );
  }

  const actions = inventoryActions(membership, item);
  const isIndividualOwner =
    item.ownershipKind === "individual" && item.ownerId === membership.id;
  const canRequest = item.listingStatus === "listed" && !isIndividualOwner;

  return (
    <main className="container mx-auto space-y-6 p-4 md:p-8">
      <Button asChild variant="ghost" className="-ml-3 w-fit">
        <Link to={returnTo}>
          <ArrowLeft aria-hidden="true" /> Back
        </Link>
      </Button>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Card className="overflow-hidden">
          <CardHeader>
            <p className="text-xs font-semibold uppercase tracking-wide text-terracotta">
              {item.ownershipKind === "group"
                ? "Group-owned"
                : "Individual-owned"}
            </p>
            <h1 className="font-serif text-3xl font-bold">{item.title}</h1>
          </CardHeader>
          <GearGallery imagePaths={item.imagePaths} title={item.title} />
          <CardContent className="space-y-4">
            <p className="whitespace-pre-wrap">
              {item.description || "No description."}
            </p>
            {item.needsAttention ? (
              <div
                className="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950"
                role="status"
              >
                <p className="font-semibold">
                  <AlertTriangle
                    className="mr-2 inline h-4 w-4"
                    aria-hidden="true"
                  />
                  Needs Attention
                </p>
                <p className="mt-1 text-sm">
                  New approvals and checkouts are paused until an authorized
                  manager clears this hold.
                </p>
                {item.needsAttentionReason ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    <strong>Current reason:</strong> {item.needsAttentionReason}
                  </p>
                ) : null}
              </div>
            ) : null}
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-semibold">Category</dt>
                <dd>{categoryLabel(item.category)}</dd>
              </div>
              <div>
                <dt className="font-semibold">Condition</dt>
                <dd>{conditionLabel(item.condition)}</dd>
              </div>
              <div>
                <dt className="font-semibold">Total quantity</dt>
                <dd>{item.quantityTotal}</dd>
              </div>
              <div>
                <dt className="font-semibold">Pickup contact</dt>
                <dd>
                  {item.custodianName}
                  {postal.data ? ` · ${postal.data}` : ""}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <InventoryActionLink item={item} membership={membership} />
              <CopyToMyGearLink item={item} membership={membership} />
            </div>
            {item.borrowingGuidelines?.length ? <section className="rounded-md border p-4" aria-labelledby="borrowing-guidelines-heading"><h2 id="borrowing-guidelines-heading" className="font-semibold">Borrowing guidelines</h2><ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{item.borrowingGuidelines.map((rule) => <li key={rule}>{rule}</li>)}</ol></section> : <p className="text-sm text-muted-foreground">No item-specific borrowing guidelines.</p>}
            {actions.canEdit ? (
              <AttentionControl
                supplyId={item.id}
                currentValue={Boolean(item.needsAttention)}
              />
            ) : null}
          </CardContent>
        </Card>
        <Card id="request" ref={requestPanelRef} className="h-fit scroll-mt-28">
          <CardHeader>
            <CardTitle>
              {canRequest ? "Request to borrow" : "Availability"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {canRequest ? (
              <LoanRequestForm key={item.id} item={item} initialValues={initialRequestValues} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {isIndividualOwner
                  ? "You manage this individual-owned item, so borrowing controls are not shown."
                  : "This item is not currently accepting requests."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function AttentionControl({
  supplyId,
  currentValue,
}: {
  supplyId: string;
  currentValue: boolean;
}) {
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => setSupplyNeedsAttention(supplyId, !currentValue, reason),
    onSuccess: async () => {
      setReason("");
      await Promise.all([
        client.invalidateQueries({
          queryKey: ["gear-share-supply-detail", supplyId],
        }),
        client.invalidateQueries({ queryKey: ["gear-share-catalog"] }),
        client.invalidateQueries({ queryKey: ["gear-share-supplies"] }),
        client.invalidateQueries({ queryKey: ["gear-share-loans"] }),
      ]);
    },
  });
  return (
    <section
      className="rounded-md border p-4"
      aria-labelledby="attention-control-heading"
    >
      <h2 id="attention-control-heading" className="font-semibold">
        Operational hold
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {currentValue
          ? "Clearing restores approval and checkout after you confirm the concern was addressed."
          : "Marking keeps the listing visible but pauses new approval and checkout."}
      </p>
      <div className="mt-3">
        <Label htmlFor="attention-reason">Reason</Label>
        <Textarea
          id="attention-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          placeholder={
            currentValue
              ? "What inspection or repair was completed?"
              : "What needs inspection or repair?"
          }
        />
      </div>
      {mutation.error ? (
        <p className="mt-2 text-sm text-destructive">
          {(mutation.error as Error).message}
        </p>
      ) : null}
      <Button
        className="mt-3"
        type="button"
        variant={currentValue ? "default" : "outline"}
        disabled={mutation.isPending || !reason.trim()}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending
          ? "Saving…"
          : currentValue
            ? "Clear Needs Attention"
            : "Mark Needs Attention"}
      </Button>
    </section>
  );
}

function UnavailableDetail({
  returnTo,
  detail,
}: {
  returnTo: string;
  detail: string;
}) {
  return (
    <main className="container mx-auto p-4 md:p-8">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Gear unavailable</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground">{detail}</p>
          <Button asChild className="w-fit" variant="outline">
            <Link to={returnTo}>Back to gear</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
