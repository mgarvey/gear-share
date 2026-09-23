import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ListPlus } from "lucide-react";
import { BorrowingGuidelinesEditor } from "@/components/gear/BorrowingGuidelinesEditor";
import { CategoryInput } from "@/components/gear/CategoryInput";
import { PrivatePhotoPicker } from "@/components/gear/PrivatePhotoPicker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { GEAR_CATEGORIES, GEAR_CONDITIONS, isGearCategory, isGearCondition } from "@/lib/categories";
import { processStagedBulkRows } from "@/lib/bulkIntakeProcessing";
import { digestGearImageFile, draftGearListingsWithAi, fetchActiveMembers, fetchAiDraftingAvailability, fetchBulkDraftStatuses, publishSupplyDraft, retireSupply, stageBulkGearDrafts, uploadGearImagesSequential, type BulkDraftStageResult } from "@/lib/gearShareApi";
import type { GearCategory, GearCondition, Membership } from "@/types/gear";

type Candidate = {
  attemptId: string; include: boolean; photos: File[]; title: string; description: string;
  category: GearCategory | ""; condition: GearCondition | ""; quantity: number; ownershipKind: "individual" | "group";
  custodianId: string; guidelines: string[]; suggestionNote?: string; result?: BulkDraftStageResult; mediaReady?: boolean;
  published?: boolean; discarded?: boolean; rowError?: string;
};

const fresh = (photos: File[] = []): Candidate => ({
  attemptId: crypto.randomUUID(), include: true, photos, title: "", description: "", category: "", condition: "", quantity: 1,
  ownershipKind: "individual", custodianId: "", guidelines: [],
});

export default function BulkIntakePage({ membership }: { membership: Membership }) {
  const client = useQueryClient();
  const [mode, setMode] = useState("photos");
  const [quickPhotos, setQuickPhotos] = useState<File[]>([]);
  const [quickReview, setQuickReview] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([fresh()]);
  const [limitError, setLimitError] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const [progress, setProgress] = useState("");
  const pauseRequested = useRef(false);
  const aiAvailable = useQuery({ queryKey: ["ai-drafting-availability"], queryFn: fetchAiDraftingAvailability });
  const contacts = useQuery({ queryKey: ["gear-share-active-members"], queryFn: () => fetchActiveMembers(), enabled: membership.accessLevel !== "regular" });
  const update = (index: number, patch: Partial<Candidate>) => setCandidates((rows) => rows.map((row, candidate) => candidate === index ? { ...row, ...patch } : row));
  const add = () => {
    if (candidates.length >= 10) { setLimitError("You can add up to ten items at a time. Remove one before adding another."); return; }
    setLimitError(""); setCandidates((rows) => [...rows, fresh()]);
  };
  const remove = (index: number) => setCandidates((rows) => rows.length === 1 ? [fresh()] : rows.filter((_, candidate) => candidate !== index));
  const included = candidates.filter((candidate) => candidate.include);
  const candidateErrors = (candidate: Candidate) => [
    candidate.photos.length >= 1 && candidate.photos.length <= 4 ? "" : "Choose 1 to 4 photos.",
    candidate.title.trim() && candidate.title.length <= 120 ? "" : "Enter a name up to 120 characters.",
    candidate.description.length <= 1000 ? "" : "Keep the description to 1,000 characters.",
    candidate.category ? "" : "Choose a category.",
    candidate.condition ? "" : "Choose a condition.",
    Number.isInteger(candidate.quantity) && candidate.quantity >= 1 && candidate.quantity <= 99 ? "" : "Quantity must be from 1 to 99.",
    candidate.ownershipKind === "individual" || (membership.accessLevel !== "regular" && candidate.custodianId) ? "" : "Choose the pickup contact.",
  ].filter(Boolean);
  const valid = included.length > 0 && included.every((candidate) => candidateErrors(candidate).length === 0);

  const stage = useMutation({
    mutationFn: async (indices: number[]) => {
      const rows = indices.map((index) => candidates[index]);
      const payload = [];
      for (const candidate of rows) payload.push({ attemptId: candidate.attemptId, title: candidate.title, description: candidate.description, category: candidate.category as GearCategory, condition: candidate.condition as GearCondition, quantity: candidate.quantity, ownershipKind: candidate.ownershipKind, custodianId: candidate.ownershipKind === "group" ? candidate.custodianId : null, expectedImages: candidate.photos.length, sourceDigest: await digestGearImageFile(candidate.photos[0]), guidelines: candidate.guidelines });
      const results = await stageBulkGearDrafts(payload);
      results.forEach((result, resultIndex) => update(indices[resultIndex], { result }));
      await processStagedBulkRows({ results, rows, indices, paused: () => pauseRequested.current, update, progress: setProgress,
        upload: (result, photos) => uploadGearImagesSequential({ id: result.supplyId!, communityId: result.communityId!, imagePaths: [], guidelineVersion: result.guidelineVersion ?? 0 }, photos) });
      return results;
    },
    onSettled: () => { setProgress(""); void client.invalidateQueries({ queryKey: ["gear-share-supplies"] }); },
  });
  const recover = useMutation({ mutationFn: () => fetchBulkDraftStatuses(candidates.map((row) => row.attemptId)), onSuccess: (statuses) => setCandidates((rows) => rows.map((row, index) => { const status = statuses.find((item) => item.attemptId === row.attemptId); return status ? { ...row, include: false, result: { index, attemptId: row.attemptId, status: "staged", supplyId: status.supplyId, communityId: status.communityId, guidelineVersion: status.guidelineVersion }, mediaReady: status.committedImages >= status.expectedImages, published: status.listingStatus === "listed", rowError: undefined } : row; })) });
  const ai = useMutation({
    mutationFn: () => draftGearListingsWithAi(quickPhotos.map((photo) => [photo]), "bulk"),
    onSuccess: (results) => {
      setCandidates(quickPhotos.map((photo, index) => {
        const result = results[index];
        return result?.kind === "draft"
          ? { ...fresh([photo]), title: result.title, description: result.description, category: result.category }
          : { ...fresh([photo]), suggestionNote: "We couldn’t identify this item. Add its details below." };
      }));
      setQuickReview(true);
    },
    onError: () => {
      setCandidates(quickPhotos.map((photo) => ({ ...fresh([photo]), suggestionNote: "Suggestions weren’t available. Add the details below." })));
      setQuickReview(true);
    },
  });
  const publish = async (index: number) => { const row = candidates[index]; if (!row.result?.supplyId) return; try { await publishSupplyDraft(row.result.supplyId, row.attemptId); update(index, { published: true, mediaReady: false, include: false, rowError: undefined }); await client.invalidateQueries({ queryKey: ["gear-share-supplies"] }); } catch { update(index, { rowError: "This item could not be published. Check its saved draft before trying again." }); } };
  const discard = async (index: number) => { const row = candidates[index]; if (!row.result?.supplyId) return; try { await retireSupply(row.result.supplyId); update(index, { discarded: true, mediaReady: false, include: false, rowError: undefined }); await client.invalidateQueries({ queryKey: ["gear-share-supplies"] }); } catch { update(index, { rowError: "This draft could not be removed. Resume unfinished items before trying again." }); } };
  const showEditor = mode === "details" || quickReview;

  return <main className="container mx-auto max-w-6xl space-y-6 p-4 md:p-8">
    <div><h1 className="font-serif text-3xl font-bold">Add several items</h1><p className="text-muted-foreground">Start with a batch of photos, or enter several items yourself.</p></div>
    <Tabs value={mode} onValueChange={setMode}>
      <TabsList className="grid h-auto w-full grid-cols-1 sm:grid-cols-2" aria-label="Bulk entry method">
        <TabsTrigger value="photos" className="gap-2 whitespace-normal"><Camera className="h-4 w-4" />Start with photos</TabsTrigger>
        <TabsTrigger value="details" className="gap-2 whitespace-normal"><ListPlus className="h-4 w-4" />Enter details yourself</TabsTrigger>
      </TabsList>
      <TabsContent value="photos" className="mt-6">
        {!quickReview ? <Card><CardHeader><CardTitle>Turn a batch of photos into item drafts</CardTitle></CardHeader><CardContent className="space-y-5">
          <div className="max-w-2xl space-y-2"><p>Choose up to ten photos. Each photo should show one item.</p><p className="text-sm text-muted-foreground">AI will suggest a name, description, and category for each photo. You’ll review and correct every item before anything is saved or published.</p></div>
          <PrivatePhotoPicker id="quick-bulk-photos" max={10} label="Choose photos—one item per photo" value={quickPhotos} onChange={(photos) => { setQuickPhotos(photos); setLimitError(""); }} disabled={ai.isPending} />
          {aiAvailable.isLoading ? <p className="text-sm text-muted-foreground">Checking whether photo suggestions are available…</p> : aiAvailable.data ? <Button disabled={quickPhotos.length === 0 || ai.isPending} onClick={() => ai.mutate()}>{ai.isPending ? "Creating suggestions…" : `Create ${quickPhotos.length || "item"} suggestion${quickPhotos.length === 1 ? "" : "s"}`}</Button> : <div className="rounded-md border p-4"><p className="font-medium">Photo suggestions aren’t available yet.</p><p className="mt-1 text-sm text-muted-foreground">Photo suggestions have not been enabled for this community. You can still enter several items yourself.</p><Button className="mt-3" variant="outline" onClick={() => setMode("details")}>Enter details yourself</Button></div>}
        </CardContent></Card> : <div className="rounded-md border bg-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Review the suggested items</h2><p className="text-sm text-muted-foreground">Check the details, choose a condition, and add more photos if helpful.</p></div><Button variant="outline" onClick={() => { setQuickReview(false); setQuickPhotos([]); setCandidates([fresh()]); }}>Start over with different photos</Button></div></div>}
      </TabsContent>
      <TabsContent value="details" className="mt-6"><Card><CardHeader><CardTitle>Enter several items at once</CardTitle></CardHeader><CardContent><p className="text-muted-foreground">Use this when you already know the details or want several photos for each item. Nothing is published until you approve it.</p></CardContent></Card></TabsContent>
    </Tabs>

    {showEditor ? <>
      <div className="flex flex-wrap gap-2">
        {mode === "details" ? <Button variant="outline" onClick={add}>Add another item</Button> : null}
        <Button variant="outline" disabled={recover.isPending} onClick={() => recover.mutate()}>Resume unfinished items</Button>
        <Button disabled={included.length === 0 || stage.isPending} onClick={() => { if (!valid) { setShowValidation(true); return; } setShowValidation(false); pauseRequested.current = false; stage.mutate(candidates.map((row, index) => row.include ? index : -1).filter((index) => index >= 0)); }}>{stage.isPending ? "Saving drafts…" : "Save as drafts"}</Button>
        {stage.isPending ? <Button variant="outline" onClick={() => { pauseRequested.current = true; setProgress("Pausing after the current item…"); }}>Pause after this item</Button> : null}
      </div>
      {limitError ? <p role="alert" className="text-destructive">{limitError}</p> : null}{progress ? <p role="status">{progress}</p> : null}{stage.error ? <p role="alert" className="text-destructive">Saving stopped. Items already saved are still in My Gear. Review the item that failed and try it again. {(stage.error as Error).message}</p> : null}{ai.error ? <p role="status" className="text-sm text-muted-foreground">Suggestions were unavailable, so the photos are ready for you to describe yourself.</p> : null}
      <div className="space-y-4">{candidates.map((candidate, index) => <Card key={candidate.attemptId}><CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2"><span>{candidate.title.trim() || `Item ${index + 1}`}</span><div className="flex items-center gap-3 text-sm font-normal"><label className="flex items-center gap-2"><Checkbox id={`bulk-include-${index}`} checked={candidate.include} onCheckedChange={(checked) => update(index, { include: checked === true })} />Include this item</label><Button type="button" size="sm" variant="ghost" onClick={() => remove(index)}>Remove</Button></div></CardTitle></CardHeader><CardContent className="grid gap-6 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(20rem,1.2fr)]">
        <PrivatePhotoPicker id={`bulk-photo-${index}`} max={4} label="Item photos" value={candidate.photos} onChange={(photos) => update(index, { photos })} disabled={stage.isPending} />
        <div className="space-y-3">{candidate.suggestionNote ? <p className="rounded-md border bg-muted/40 p-3 text-sm">{candidate.suggestionNote}</p> : null}<div><Label htmlFor={`bulk-title-${index}`}>Name</Label><Input id={`bulk-title-${index}`} maxLength={120} value={candidate.title} onChange={(event) => update(index, { title: event.target.value })} /></div><div><Label htmlFor={`bulk-description-${index}`}>Description</Label><Textarea id={`bulk-description-${index}`} maxLength={1000} value={candidate.description} onChange={(event) => update(index, { description: event.target.value })} /></div><div><Label htmlFor={`bulk-category-${index}`}>Category</Label><CategoryInput id={`bulk-category-${index}`} value={candidate.category} categories={GEAR_CATEGORIES.map((item) => item.id)} onChange={(category) => { if (isGearCategory(category)) update(index, { category }); }} /></div><div><Label htmlFor={`bulk-condition-${index}`}>Condition</Label><Select value={candidate.condition || undefined} onValueChange={(condition) => { if (isGearCondition(condition)) update(index, { condition }); }}><SelectTrigger id={`bulk-condition-${index}`}><SelectValue placeholder="Choose condition" /></SelectTrigger><SelectContent>{GEAR_CONDITIONS.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor={`bulk-quantity-${index}`}>Quantity</Label><Input id={`bulk-quantity-${index}`} type="number" min={1} max={99} value={candidate.quantity} onChange={(event) => update(index, { quantity: event.target.valueAsNumber })} /></div>
        {membership.accessLevel !== "regular" ? <><div><Label htmlFor={`bulk-owner-${index}`}>Who owns it?</Label><Select value={candidate.ownershipKind} onValueChange={(ownershipKind: "individual" | "group") => update(index, { ownershipKind, custodianId: ownershipKind === "individual" ? "" : candidate.custodianId })}><SelectTrigger id={`bulk-owner-${index}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="individual">A member</SelectItem><SelectItem value="group">The group</SelectItem></SelectContent></Select></div>{candidate.ownershipKind === "group" ? <div><Label htmlFor={`bulk-contact-${index}`}>Pickup contact</Label><Select value={candidate.custodianId || undefined} onValueChange={(custodianId) => update(index, { custodianId })}><SelectTrigger id={`bulk-contact-${index}`}><SelectValue placeholder="Choose member" /></SelectTrigger><SelectContent>{(contacts.data ?? []).map((member: any) => <SelectItem key={member.id} value={member.id}>{member.display_name}</SelectItem>)}</SelectContent></Select></div> : null}</> : null}
        <BorrowingGuidelinesEditor value={candidate.guidelines} onChange={(guidelines) => update(index, { guidelines })} disabled={stage.isPending} />
        {showValidation && candidate.include && candidateErrors(candidate).length > 0 ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3"><p className="mb-1 text-sm font-medium text-destructive">Finish these details:</p><ul className="list-disc pl-5 text-sm text-destructive">{candidateErrors(candidate).map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
        {candidate.result?.status === "failed" ? <p className="text-destructive">This item was not saved. Review it and try again.</p> : null}{candidate.rowError ? <p role="alert" className="text-destructive">{candidate.rowError}</p> : null}
        {candidate.discarded ? <p role="status">Draft removed.</p> : candidate.published ? <p role="status">Published to the gear catalog.</p> : candidate.mediaReady ? <div className="rounded-md border p-3"><p className="mb-2">Draft saved. Publish it when you’re ready.</p><div className="flex flex-wrap gap-2"><Button type="button" onClick={() => void publish(index)}>Publish item</Button><Button type="button" variant="outline" onClick={() => void discard(index)}>Remove draft</Button></div></div> : candidate.result?.status === "staged" ? <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={stage.isPending || candidateErrors(candidate).length > 0} onClick={() => { pauseRequested.current = false; stage.mutate([index]); }}>Try this item again</Button><Button type="button" variant="outline" onClick={() => void discard(index)}>Remove draft</Button></div> : null}</div>
      </CardContent></Card>)}</div>
    </> : null}
  </main>;
}
