import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { localDateValue } from "@/lib/catalog";
import { getLoanAvailabilitySummary, requestLoan } from "@/lib/gearShareApi";
import type { GearItem } from "@/types/gear";

export function LoanRequestForm({ item, onSuccess, initialValues }: { item: GearItem; onSuccess?: () => void; initialValues?: { quantity?: number; startDate?: string; endDate?: string } }) {
  const client = useQueryClient();
  const fieldId = useId();
  const [minimumDate] = useState(localDateValue);
  const [quantity, setQuantity] = useState(() => Math.min(item.quantityTotal, Math.max(1, initialValues?.quantity ?? 1)));
  const [startDate, setStartDate] = useState(() => initialValues?.startDate && initialValues.startDate >= minimumDate ? initialValues.startDate : "");
  const [endDate, setEndDate] = useState(() => initialValues?.endDate && initialValues.endDate >= (initialValues?.startDate && initialValues.startDate >= minimumDate ? initialValues.startDate : minimumDate) ? initialValues.endDate : "");
  const [dateError, setDateError] = useState("");
  const [note, setNote] = useState("");
  const [guidelinesAccepted, setGuidelinesAccepted] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const availability = useQuery({
    queryKey: ["availability", item.id, startDate, endDate],
    queryFn: () => getLoanAvailabilitySummary(item.id, startDate, endDate),
    enabled: Boolean(startDate && endDate && endDate >= startDate),
  });
  const request = useMutation({
    mutationFn: requestLoan,
    onSuccess: async () => {
      setSubmitted(true);
      onSuccess?.();
      await client.invalidateQueries({ queryKey: ["gear-share-loans"] });
    },
  });
  const shortfall = availability.data !== undefined && quantity > availability.data.availableQuantity;
  const quantityId = `${fieldId}-quantity`;
  const startId = `${fieldId}-start`;
  const endId = `${fieldId}-end`;
  const noteId = `${fieldId}-note`;
  const dateErrorId = `${fieldId}-date-error`;
  const changeStartDate = (nextStart: string) => {
    if (nextStart && nextStart < minimumDate) {
      setStartDate("");
      setDateError("Choose today or a later date.");
      return;
    }
    setStartDate(nextStart);
    if (nextStart && endDate && endDate < nextStart) {
      setEndDate("");
      setDateError("Choose an end date on or after the start date.");
    } else {
      setDateError("");
    }
  };
  const changeEndDate = (nextEnd: string) => {
    if (nextEnd && nextEnd < minimumDate) {
      setEndDate("");
      setDateError("Choose today or a later date.");
      return;
    }
    if (startDate && nextEnd && nextEnd < startDate) {
      setDateError("Choose an end date on or after the start date.");
      return;
    }
    setEndDate(nextEnd);
    setDateError("");
  };

  if (submitted) {
    return <div className="space-y-3 rounded-md border border-green-300 bg-green-50 p-4 text-green-950" role="status" aria-live="polite">
      <p className="font-semibold">Request sent.</p>
      <p className="text-sm">The gear manager can now review your request.</p>
      <Button asChild variant="outline"><Link to="/loans">View my loans</Link></Button>
    </div>;
  }

  return <form className="space-y-4" onSubmit={(event) => {
    event.preventDefault();
    request.mutate({ supplyId: item.id, quantity, startDate, endDate, note, guidelineVersion: item.borrowingGuidelines?.length ? item.guidelineVersion : undefined, guidelinesAccepted });
  }}>
    {item.needsAttention ? <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status">This gear is marked Needs Attention. You may submit a request, but it cannot be approved or checked out until an authorized manager clears the hold.</p> : null}
    <div><Label htmlFor={quantityId}>Quantity (of {item.quantityTotal})</Label><Input id={quantityId} type="number" min={1} max={item.quantityTotal} step={1} value={quantity} onChange={(event) => setQuantity(event.target.valueAsNumber)} required /></div>
    <fieldset><legend className="mb-1 text-sm font-medium">Borrowing dates</legend><div className="grid grid-cols-2 gap-3"><div className="min-w-0"><Label htmlFor={startId}>Start date</Label><Input className="min-w-0" id={startId} type="date" min={minimumDate} value={startDate} onChange={(event) => changeStartDate(event.target.value)} required /></div><div className="min-w-0"><Label htmlFor={endId}>End date</Label><Input className="min-w-0" id={endId} type="date" min={startDate || minimumDate} value={endDate} onChange={(event) => changeEndDate(event.target.value)} aria-describedby={dateError ? dateErrorId : undefined} aria-invalid={Boolean(dateError)} required /></div></div>{dateError ? <p id={dateErrorId} className="mt-2 text-sm text-destructive" role="alert">{dateError}</p> : null}{startDate || endDate ? <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => { setStartDate(""); setEndDate(""); setDateError(""); }}>Clear dates</Button> : null}</fieldset>
    {availability.data !== undefined ? <div className={`rounded-md p-3 text-sm ${shortfall ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-900"}`} role="status"><CalendarRange className="mr-2 inline h-4 w-4" aria-hidden="true" /><strong>{availability.data.availableQuantity} available</strong> for these dates.{availability.data.pendingRequestCount > 0 ? ` ${availability.data.pendingQuantity} ${availability.data.pendingQuantity === 1 ? "unit is" : "units are"} also awaiting approval across ${availability.data.pendingRequestCount} ${availability.data.pendingRequestCount === 1 ? "request" : "requests"}.` : ""}{shortfall ? " You may submit, but the request cannot be approved unless capacity changes." : ""}<span className="mt-1 block text-xs">Pending requests do not reserve gear until approved.</span></div> : null}
    {availability.isFetching ? <p className="text-sm text-muted-foreground" role="status">Checking availability…</p> : null}
    {availability.error ? <p className="text-sm text-destructive">Availability could not be checked: {(availability.error as Error).message}</p> : null}
    <div><Label htmlFor={noteId}>Note about your request (optional)</Label><Textarea id={noteId} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></div>
    {item.borrowingGuidelines?.length ? <label className="flex items-start gap-2 rounded-md border p-3 text-sm"><input type="checkbox" className="mt-1" checked={guidelinesAccepted} onChange={(event) => setGuidelinesAccepted(event.target.checked)} /><span>I’ve read and agree to these borrowing guidelines. They’ll be saved with my request.</span></label> : null}
    {request.error ? <p className="text-sm text-destructive">{(request.error as Error).message}</p> : null}
    <Button type="submit" className="w-full sm:w-auto" disabled={request.isPending || !startDate || startDate < minimumDate || !endDate || endDate < startDate || Boolean(item.borrowingGuidelines?.length && !guidelinesAccepted)}>{request.isPending ? "Submitting…" : "Submit request"}</Button>
  </form>;
}
