import { useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { CategoryInput } from "@/components/gear/CategoryInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { canonicalCategory, categoryLabel, GEAR_CATEGORIES } from "@/lib/categories";
import {
  changeWantedRequestState,
  createWantedRequest,
  fetchManageableWantedListings,
  fetchWantedOffers,
  fetchWantedRequests,
  moderateWantedRequest,
  offerWantedListing,
  offerWantedOnce,
  selectWantedOffer,
  selectWantedOneOffOffer,
  updateWantedRequest,
  type WantedRequestInput,
} from "@/lib/gearShareApi";
import type { Membership, WantedOffer, WantedRequest, WantedRequestView } from "@/types/gear";

const VIEWS: Array<{ id: WantedRequestView; label: string }> = [
  { id: "open", label: "Open" },
  { id: "fulfilled", label: "Matched" },
  { id: "closed", label: "Closed" },
  { id: "mine", label: "Mine" },
];

export default function WantedPage({ membership }: { membership: Membership }) {
  const [view, setView] = useState<WantedRequestView>("open");
  const [editing, setEditing] = useState<WantedRequest | "new" | null>(null);
  const requests = useInfiniteQuery({
    queryKey: ["wanted-requests", view],
    initialPageParam: undefined as { createdAt: string; id: string } | undefined,
    queryFn: ({ pageParam }) => fetchWantedRequests(view, pageParam),
    getNextPageParam: (lastPage) => lastPage.length === 24
      ? { createdAt: lastPage[23].createdAt, id: lastPage[23].id }
      : undefined,
  });
  const items = requests.data?.pages.flat() ?? [];
  const choices = membership.accessLevel === "administrator"
    ? [...VIEWS.slice(0, 3), { id: "moderated" as const, label: "Hidden" }, VIEWS[3]]
    : VIEWS;
  return (
    <main className="container mx-auto space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="font-serif text-3xl font-bold">Wanted gear</h1><p className="text-muted-foreground">Ask the private community for gear that is not currently listed.</p></div>
        <Button onClick={() => setEditing("new")}><Plus /> New request</Button>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Wanted request views">
        {choices.map((choice) => <Button key={choice.id} size="sm" className="min-h-11 sm:min-h-9" variant={view === choice.id ? "default" : "outline"} onClick={() => setView(choice.id)}>{choice.label}</Button>)}
      </div>
      {requests.isLoading ? <p>Loading wanted requests…</p> : null}
      {requests.error ? <p className="text-destructive">{(requests.error as Error).message}</p> : null}
      {!requests.isLoading && !requests.error && items.length === 0 ? <p className="rounded-md border p-8 text-center text-muted-foreground">No requests in this view.</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {items.map((request) => <WantedCard key={request.id} request={request} membership={membership} onEdit={() => setEditing(request)} />)}
      </div>
      {requests.hasNextPage ? <div className="text-center"><Button variant="outline" disabled={requests.isFetchingNextPage} onClick={() => requests.fetchNextPage()}>{requests.isFetchingNextPage ? "Loading…" : "Load 24 more"}</Button></div> : null}
      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}><DialogContent className="flex h-auto flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-xl"><DialogHeader className="shrink-0 px-4 pb-4 pt-5 pr-14 sm:px-6 sm:pt-6"><DialogTitle>{editing === "new" ? "New wanted request" : "Edit wanted request"}</DialogTitle><DialogDescription>Requests are visible only to active members of this community.</DialogDescription></DialogHeader>{editing ? <WantedForm request={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} /> : null}</DialogContent></Dialog>
    </main>
  );
}

function WantedForm({ request, onDone }: { request?: WantedRequest; onDone: () => void }) {
  const client = useQueryClient();
  const [title, setTitle] = useState(request?.title ?? "");
  const [category, setCategory] = useState(request?.category ?? "");
  const [quantity, setQuantity] = useState(request?.desiredQuantity ?? 1);
  const [startDate, setStartDate] = useState(request?.desiredStart ?? "");
  const [endDate, setEndDate] = useState(request?.desiredEnd ?? "");
  const [dateError, setDateError] = useState("");
  const [note, setNote] = useState(request?.note ?? "");
  const mutation = useMutation({
    mutationFn: () => {
      const input: WantedRequestInput = {
        title,
        category: category ? canonicalCategory(category, GEAR_CATEGORIES.map((item) => item.id)) : null,
        quantity,
        startDate: startDate || null,
        endDate: endDate || null,
        note,
      };
      return request
        ? updateWantedRequest(request.id, request.transitionVersion, input)
        : createWantedRequest(input);
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["wanted-requests"] }); onDone(); },
  });
  const datesValid = (!startDate && !endDate) || Boolean(startDate && endDate && endDate >= startDate);
  const changeStartDate = (nextStart: string) => {
    setStartDate(nextStart);
    if (nextStart && endDate && endDate < nextStart) {
      setEndDate("");
      setDateError("Choose an end date on or after the start date.");
    } else {
      setDateError("");
    }
  };
  const changeEndDate = (nextEnd: string) => {
    if (startDate && nextEnd && nextEnd < startDate) {
      setDateError("Choose an end date on or after the start date.");
      return;
    }
    setEndDate(nextEnd);
    setDateError("");
  };
  return <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-5 sm:px-6">
      <div><Label htmlFor="wanted-title">What are you looking for?</Label><Input id="wanted-title" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} required /></div>
      <div><Label htmlFor="wanted-category">Category (optional)</Label><div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2"><div className="min-w-0"><CategoryInput id="wanted-category" value={category} categories={GEAR_CATEGORIES.map((item) => item.id)} onChange={setCategory} /></div>{category ? <Button type="button" variant="outline" className="h-10 px-3" aria-label="Clear category" onClick={() => setCategory("")}><X aria-hidden="true" className="h-4 w-4" /> Clear</Button> : null}</div></div>
      <div><Label htmlFor="wanted-quantity">Desired quantity</Label><Input id="wanted-quantity" type="number" min={1} max={99} step={1} value={quantity} onChange={(event) => setQuantity(event.target.valueAsNumber)} required /></div>
      <fieldset><legend className="mb-1 text-sm font-medium">Dates (optional)</legend><div className="grid grid-cols-2 gap-3"><div className="min-w-0"><Label htmlFor="wanted-start">Start date</Label><Input className="min-w-0" id="wanted-start" type="date" value={startDate} onChange={(event) => changeStartDate(event.target.value)} /></div><div className="min-w-0"><Label htmlFor="wanted-end">End date</Label><Input className="min-w-0" id="wanted-end" type="date" min={startDate || undefined} value={endDate} onChange={(event) => changeEndDate(event.target.value)} aria-describedby={dateError ? "wanted-date-error" : undefined} aria-invalid={Boolean(dateError)} /></div></div>{dateError ? <p id="wanted-date-error" className="mt-2 text-sm text-destructive" role="alert">{dateError}</p> : null}{startDate || endDate ? <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => { setStartDate(""); setEndDate(""); setDateError(""); }}>Clear dates</Button> : null}</fieldset>
      <div><Label htmlFor="wanted-note">Additional context (optional)</Label><Textarea id="wanted-note" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></div>
      {mutation.error ? <p className="text-sm text-destructive">{(mutation.error as Error).message}</p> : null}
    </div>
    <div className="flex shrink-0 justify-end gap-2 border-t bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-6"><Button type="button" variant="outline" onClick={onDone}>Cancel</Button><Button disabled={mutation.isPending || !title.trim() || !Number.isInteger(quantity) || quantity < 1 || quantity > 99 || !datesValid}>{mutation.isPending ? "Saving…" : request ? "Save request" : "Post request"}</Button></div>
  </form>;
}

function WantedCard({ request, membership, onEdit }: { request: WantedRequest; membership: Membership; onEdit: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [offerOpen, setOfferOpen] = useState(false);
  const [oneOffOpen, setOneOffOpen] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const offers = useQuery({ queryKey: ["wanted-offers", request.id], queryFn: () => fetchWantedOffers(request.id), enabled: request.status !== "closed" && request.status !== "moderated" });
  const state = useMutation({
    mutationFn: (action: "close" | "reopen") => changeWantedRequestState(action, request.id, request.transitionVersion),
    onSuccess: () => client.invalidateQueries({ queryKey: ["wanted-requests"] }),
  });
  const own = request.requesterId === membership.id;
  const selected = offers.data?.find((offer) => offer.id === request.selectedOfferId);
  return <Card><CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2"><span>{request.title}</span><span className="rounded-full bg-muted px-2 py-1 font-sans text-xs font-normal capitalize">{request.status === "fulfilled" ? "matched" : request.status === "moderated" ? "hidden" : request.status}</span></CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
    <p>Requested by {request.requesterName} · Quantity {request.desiredQuantity}</p>
    <p><strong>Category:</strong> {categoryLabel(request.category)}</p>
    {request.desiredStart ? <p><strong>Preferred dates:</strong> {request.desiredStart} through {request.desiredEnd}</p> : null}
    {request.note ? <p className="whitespace-pre-wrap">{request.note}</p> : null}
    {offers.error ? <p className="text-destructive">Offers unavailable: {(offers.error as Error).message}</p> : null}
    {offers.data?.length ? <div className="space-y-2"><h3 className="font-semibold">Offers</h3>{offers.data.map((offer) => <OfferRow key={offer.id} offer={offer} request={request} ownRequest={own} onSelected={(selectedOffer) => selectedOffer.offerKind === "one_off" ? navigate("/loans") : navigate(`/gear/${selectedOffer.supplyId}`, { state: { returnTo: "/wanted", wantedContext: { quantity: request.desiredQuantity, startDate: request.desiredStart ?? undefined, endDate: request.desiredEnd ?? undefined } } })} />)}</div> : null}
    {selected?.offerKind === "listing" && selected.supplyId ? <Button asChild size="sm"><Link to={`/gear/${selected.supplyId}`} state={{ returnTo: "/wanted", wantedContext: { quantity: request.desiredQuantity, startDate: request.desiredStart ?? undefined, endDate: request.desiredEnd ?? undefined } }}>Review matched item</Link></Button> : null}
    {selected?.offerKind === "one_off" ? <Button asChild size="sm"><Link to="/loans">Review borrowing request</Link></Button> : null}
    <div className="flex flex-wrap gap-2">
      {own && request.status === "open" ? <><Button size="sm" variant="outline" onClick={onEdit}>Edit</Button><Button size="sm" variant="outline" disabled={state.isPending} onClick={() => state.mutate("close")}>Close</Button></> : null}
      {own && request.status === "closed" && request.closureKind === "voluntary" ? <Button size="sm" variant="outline" disabled={state.isPending} onClick={() => state.mutate("reopen")}>Reopen</Button> : null}
      {!own && request.status === "open" ? <><Button size="sm" onClick={() => setOneOffOpen(true)}>Offer one-time help</Button><Button size="sm" variant="outline" onClick={() => setOfferOpen(true)}>Offer listed gear</Button><Button size="sm" variant="outline" onClick={() => navigate("/my-gear", { state: { wantedRequestId: request.id, returnTo: "/wanted" } })}>Create a reusable listing</Button></> : null}
      {membership.accessLevel === "administrator" ? <Button size="sm" variant="outline" onClick={() => setModerationOpen(true)}>{request.status === "moderated" ? "Restore request" : "Hide request"}</Button> : null}
    </div>
    {state.error ? <p className="text-destructive">{(state.error as Error).message}</p> : null}
    <OfferDialog open={offerOpen} onOpenChange={setOfferOpen} request={request} />
    <OneOffOfferDialog open={oneOffOpen} onOpenChange={setOneOffOpen} request={request} />
    <ModerationDialog open={moderationOpen} onOpenChange={setModerationOpen} request={request} />
  </CardContent></Card>;
}

function OfferRow({ offer, request, ownRequest, onSelected }: { offer: WantedOffer; request: WantedRequest; ownRequest: boolean; onSelected: (offer: WantedOffer) => void }) {
  const client = useQueryClient();
  const [acceptOpen, setAcceptOpen] = useState(false);
  const select = useMutation({ mutationFn: () => selectWantedOffer(request.id, offer.id, request.transitionVersion), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ["wanted-requests"] }), client.invalidateQueries({ queryKey: ["wanted-offers", request.id] })]); onSelected(offer); } });
  return <div className="rounded-md border p-3"><p><strong>{offer.offerKind === "one_off" ? `One-time help · up to ${offer.offeredQuantity}` : offer.supplyTitle}</strong> · offered by {offer.offererName}</p>{offer.note ? <p className="mt-1 text-muted-foreground">{offer.note}</p> : null}{ownRequest && request.status === "open" && offer.status === "active" ? offer.offerKind === "one_off" ? <Button className="mt-2" size="sm" onClick={() => setAcceptOpen(true)}>Request this offer</Button> : <Button className="mt-2" size="sm" disabled={select.isPending} onClick={() => select.mutate()}>Select and review item</Button> : null}{select.error ? <p className="mt-1 text-destructive">{(select.error as Error).message}</p> : null}<OneOffAcceptDialog open={acceptOpen} onOpenChange={setAcceptOpen} request={request} offer={offer} onSelected={() => onSelected(offer)} /></div>;
}

function OneOffOfferDialog({ open, onOpenChange, request }: { open: boolean; onOpenChange: (open: boolean) => void; request: WantedRequest }) {
  const client = useQueryClient();
  const [quantity, setQuantity] = useState(request.desiredQuantity);
  const [note, setNote] = useState("");
  const offer = useMutation({ mutationFn: () => offerWantedOnce(request.id, quantity, note), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["wanted-offers", request.id] }); setQuantity(request.desiredQuantity); setNote(""); onOpenChange(false); } });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="bottom-auto top-1/2 flex h-auto max-h-[calc(100dvh-2rem)] translate-y-[-50%] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"><DialogHeader className="px-5 pb-4 pt-5 sm:px-6 sm:pt-6"><DialogTitle>Offer one-time help</DialogTitle><DialogDescription>Let the requester know you can help without adding the item to the catalog. If they choose your offer, Gear Share will create the normal borrowing request.</DialogDescription></DialogHeader><div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5 sm:px-6"><div><Label htmlFor={`one-off-quantity-${request.id}`}>How many can you provide?</Label><Input id={`one-off-quantity-${request.id}`} type="number" min={1} max={request.desiredQuantity} step={1} value={quantity} onChange={(event) => setQuantity(event.target.valueAsNumber)} /></div><div><Label htmlFor={`one-off-note-${request.id}`}>Note to the requester (optional)</Label><Textarea id={`one-off-note-${request.id}`} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></div>{offer.error ? <p className="text-sm text-destructive">{(offer.error as Error).message}</p> : null}</div><DialogFooter className="flex-row justify-end border-t px-5 py-4 sm:px-6"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={offer.isPending || !Number.isInteger(quantity) || quantity < 1 || quantity > request.desiredQuantity} onClick={() => offer.mutate()}>{offer.isPending ? "Sending…" : "Send offer"}</Button></DialogFooter></DialogContent></Dialog>;
}

function OneOffAcceptDialog({ open, onOpenChange, request, offer, onSelected }: { open: boolean; onOpenChange: (open: boolean) => void; request: WantedRequest; offer: WantedOffer; onSelected: () => void }) {
  const client = useQueryClient();
  const today = useMemo(() => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); }, []);
  const initialStart = request.desiredStart && request.desiredStart >= today ? request.desiredStart : "";
  const initialEnd = request.desiredEnd && request.desiredEnd >= (initialStart || today) ? request.desiredEnd : "";
  const [quantity, setQuantity] = useState(Math.min(request.desiredQuantity, offer.offeredQuantity ?? request.desiredQuantity));
  const [startDate, setStartDate] = useState(initialStart);
  const [endDate, setEndDate] = useState(initialEnd);
  const select = useMutation({ mutationFn: () => selectWantedOneOffOffer({ requestId: request.id, offerId: offer.id, expectedVersion: request.transitionVersion, quantity, startDate, endDate }), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ["wanted-requests"] }), client.invalidateQueries({ queryKey: ["wanted-offers", request.id] }), client.invalidateQueries({ queryKey: ["gear-share-loans"] })]); onOpenChange(false); onSelected(); } });
  const maximum = Math.min(request.desiredQuantity, offer.offeredQuantity ?? request.desiredQuantity);
  const valid = Number.isInteger(quantity) && quantity >= 1 && quantity <= maximum && startDate >= today && endDate >= startDate;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="bottom-auto top-1/2 flex h-auto max-h-[calc(100dvh-2rem)] translate-y-[-50%] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"><DialogHeader className="px-5 pb-4 pt-5 sm:px-6 sm:pt-6"><DialogTitle>Request this one-time offer</DialogTitle><DialogDescription>Confirm what you need and when. This sends a normal borrowing request to {offer.offererName}.</DialogDescription></DialogHeader><div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5 sm:px-6"><div><Label htmlFor={`accept-quantity-${offer.id}`}>Quantity</Label><Input id={`accept-quantity-${offer.id}`} type="number" min={1} max={maximum} step={1} value={quantity} onChange={(event) => setQuantity(event.target.valueAsNumber)} /></div><fieldset><legend className="mb-1 text-sm font-medium">Borrowing dates</legend><div className="grid grid-cols-2 gap-3"><div className="min-w-0"><Label htmlFor={`accept-start-${offer.id}`}>Start date</Label><Input id={`accept-start-${offer.id}`} type="date" min={today} value={startDate} onChange={(event) => { const value = event.target.value; setStartDate(value); if (endDate && endDate < value) setEndDate(""); }} /></div><div className="min-w-0"><Label htmlFor={`accept-end-${offer.id}`}>End date</Label><Input id={`accept-end-${offer.id}`} type="date" min={startDate || today} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div></div></fieldset>{select.error ? <p className="text-sm text-destructive">{(select.error as Error).message}</p> : null}</div><DialogFooter className="flex-row justify-end border-t px-5 py-4 sm:px-6"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!valid || select.isPending} onClick={() => select.mutate()}>{select.isPending ? "Sending…" : "Send borrowing request"}</Button></DialogFooter></DialogContent></Dialog>;
}

function OfferDialog({ open, onOpenChange, request }: { open: boolean; onOpenChange: (open: boolean) => void; request: WantedRequest }) {
  const client = useQueryClient();
  const listings = useQuery({ queryKey: ["wanted-manageable-listings"], queryFn: fetchManageableWantedListings, enabled: open });
  const [supplyId, setSupplyId] = useState("");
  const [note, setNote] = useState("");
  const offer = useMutation({ mutationFn: () => offerWantedListing(request.id, supplyId, note), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["wanted-offers", request.id] }); setSupplyId(""); setNote(""); onOpenChange(false); } });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="bottom-auto top-1/2 flex h-auto max-h-[calc(100dvh-2rem)] translate-y-[-50%] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"><DialogHeader className="px-5 pb-4 pt-5 sm:px-6 sm:pt-6"><DialogTitle>Offer listed gear</DialogTitle><DialogDescription>Choose one of your listed items for the requester to review. This does not create or approve a loan.</DialogDescription></DialogHeader><div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5 sm:px-6"><div><Label htmlFor={`offer-${request.id}`}>Your listed item</Label><Select value={supplyId} onValueChange={setSupplyId}><SelectTrigger id={`offer-${request.id}`}><SelectValue placeholder="Choose an item" /></SelectTrigger><SelectContent><SelectGroup>{(listings.data ?? []).map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectGroup></SelectContent></Select></div><div><Label htmlFor={`offer-note-${request.id}`}>Note to the requester (optional)</Label><Textarea id={`offer-note-${request.id}`} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></div>{listings.error || offer.error ? <p className="text-sm text-destructive">{((listings.error || offer.error) as Error).message}</p> : null}</div><DialogFooter className="flex-row justify-end border-t px-5 py-4 sm:px-6"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!supplyId || offer.isPending} onClick={() => offer.mutate()}>{offer.isPending ? "Offering…" : "Offer item"}</Button></DialogFooter></DialogContent></Dialog>;
}

function ModerationDialog({ open, onOpenChange, request }: { open: boolean; onOpenChange: (open: boolean) => void; request: WantedRequest }) {
  const client = useQueryClient();
  const restoring = request.status === "moderated";
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState<"open" | "closed">("closed");
  const mutation = useMutation({ mutationFn: () => moderateWantedRequest(restoring ? "restore" : "moderate", request.id, request.transitionVersion, reason, restoring ? target : undefined), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["wanted-requests"] }); setReason(""); onOpenChange(false); } });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="bottom-auto top-1/2 flex h-auto max-h-[calc(100dvh-2rem)] translate-y-[-50%] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"><DialogHeader className="px-5 pb-4 pt-5 sm:px-6 sm:pt-6"><DialogTitle>{restoring ? "Restore hidden request" : "Hide wanted request"}</DialogTitle><DialogDescription>{restoring ? "Return this request to the community board. Its history will remain unchanged." : "Remove this request from the community board without deleting it. Use this for inappropriate, obsolete, or problematic requests."}</DialogDescription></DialogHeader><div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5 sm:px-6">{restoring ? <div><Label htmlFor={`restore-target-${request.id}`}>Return request as</Label><Select value={target} onValueChange={(value) => setTarget(value as "open" | "closed")}><SelectTrigger id={`restore-target-${request.id}`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="closed">Closed</SelectItem><SelectItem value="open">Open</SelectItem></SelectGroup></SelectContent></Select></div> : null}<div><Label htmlFor={`moderation-reason-${request.id}`}>{restoring ? "Reason for restoring" : "Reason for hiding"}</Label><Textarea id={`moderation-reason-${request.id}`} minLength={1} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></div>{mutation.error ? <p className="text-sm text-destructive">{(mutation.error as Error).message}</p> : null}</div><DialogFooter className="flex-row justify-end border-t px-5 py-4 sm:px-6"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!reason.trim() || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Saving…" : restoring ? "Restore request" : "Hide request"}</Button></DialogFooter></DialogContent></Dialog>;
}
