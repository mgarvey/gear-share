import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CategoryInput } from "@/components/gear/CategoryInput";
import { BorrowingGuidelinesEditor } from "@/components/gear/BorrowingGuidelinesEditor";
import { PrivatePhotoPicker } from "@/components/gear/PrivatePhotoPicker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { canonicalCategory, existingCategories, GEAR_CONDITIONS } from "@/lib/categories";
import type { IndividualGearDraft } from "@/lib/copyGear";
import { createOrResumeGroupDraft, createOrResumeIndividualDraft, draftGearListingsWithAi, fetchAiDraftingAvailability, publishSupplyDraft, uploadGearImagesSequential } from "@/lib/gearShareApi";
import type { GearItem } from "@/types/gear";

const EMPTY_DRAFT: IndividualGearDraft = { title: "", description: "", category: "", quantity: 1 };

type ListingOwnership = "individual" | "group";
type ActiveMember = { id: string; display_name: string };

export function GearListingForm({ supplies, initialDraft = EMPTY_DRAFT, fixedQuantity, title = "Add gear", context, membershipId, members = [], allowGroup = false, initialOwnership = "individual", onCancel, onCreated }: {
  supplies: GearItem[];
  initialDraft?: IndividualGearDraft;
  fixedQuantity?: number;
  title?: string;
  context?: React.ReactNode;
  membershipId?: string;
  members?: ActiveMember[];
  allowGroup?: boolean;
  initialOwnership?: ListingOwnership;
  onCancel?: () => void;
  onCreated?: (ownership: ListingOwnership) => void;
}) {
  const client = useQueryClient();
  const categories = existingCategories(supplies);
  const [name, setName] = useState(initialDraft.title);
  const [description, setDescription] = useState(initialDraft.description);
  const [category, setCategory] = useState(initialDraft.category);
  const [condition, setCondition] = useState("");
  const [quantity, setQuantity] = useState(initialDraft.quantity);
  const [photos, setPhotos] = useState<File[]>([]);
  const [guidelines, setGuidelines] = useState<string[]>([]);
  const [ownership, setOwnership] = useState<ListingOwnership>(initialOwnership);
  const [custodianId, setCustodianId] = useState(membershipId ?? "");
  const [attemptId, setAttemptId] = useState<string>();
  const [draftCreated, setDraftCreated] = useState(false);
  const [progress, setProgress] = useState(0);
  const pausePublication = useRef(false);
  const aiAvailable = useQuery({ queryKey: ["ai-drafting-availability"], queryFn: fetchAiDraftingAvailability });
  const ai = useMutation({
    mutationFn: () => draftGearListingsWithAi([photos], "single"),
    onSuccess: (results) => {
      const result = results[0];
      if (result?.kind === "draft") { setName(result.title); setDescription(result.description); setCategory(result.category); }
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      pausePublication.current = false;
      const publicationAttempt = attemptId ?? crypto.randomUUID();
      setAttemptId(publicationAttempt);
      const common = {
        attemptId: publicationAttempt,
        title: name,
        description,
        category: canonicalCategory(category, categories),
        condition: condition as typeof GEAR_CONDITIONS[number]["id"],
        quantity: fixedQuantity ?? quantity,
        expectedImages: photos.length,
        borrowingGuidelines: guidelines,
      };
      const item = ownership === "group"
        ? await createOrResumeGroupDraft({ ...common, custodianId })
        : await createOrResumeIndividualDraft(common);
      setDraftCreated(true);
      if (photos.length) await uploadGearImagesSequential(item, photos, 0, (done) => setProgress(done), () => pausePublication.current);
      await publishSupplyDraft(item.id, publicationAttempt);
    },
    onSuccess: async () => {
      const createdOwnership = ownership;
      setName(""); setDescription(""); setCategory(""); setCondition(""); setQuantity(1); setPhotos([]); setGuidelines([]); setOwnership(initialOwnership); setCustodianId(membershipId ?? ""); setAttemptId(undefined); setDraftCreated(false); setProgress(0);
      await client.invalidateQueries({ queryKey: ["gear-share-supplies"] });
      onCreated?.(createdOwnership);
    }, onSettled: () => client.invalidateQueries({ queryKey: ["gear-share-supplies"] }),
  });

  return <Card>
    <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
    <CardContent><form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
      {context}
      {allowGroup ? <div><Label htmlFor="gear-owner">Who owns this gear?</Label><Select value={ownership} onValueChange={(value: ListingOwnership) => setOwnership(value)}><SelectTrigger id="gear-owner"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="individual">My gear</SelectItem><SelectItem value="group">Group gear</SelectItem></SelectGroup></SelectContent></Select>{ownership === "group" ? <p className="mt-1 text-xs text-muted-foreground">Group gear can be managed by authorized Custodians and Administrators.</p> : null}</div> : null}
      <PrivatePhotoPicker id="gear-photo" label="Start with photos (optional)" value={photos} onChange={setPhotos} disabled={create.isPending} />
      {aiAvailable.data ? <div className="flex flex-col gap-2 rounded-md border p-3"><p className="text-sm">Add a photo first, then let AI suggest a name, description, and category. You can change anything before publishing.</p><Button className="self-start" type="button" variant="outline" disabled={photos.length < 1 || ai.isPending || create.isPending} onClick={() => ai.mutate()}>{ai.isPending ? "Preparing suggestions…" : "Suggest listing details"}</Button>{ai.error ? <p role="alert" className="text-sm text-destructive">{(ai.error as Error).message}</p> : null}{ai.data?.[0]?.kind === "needs_manual" ? <p role="status" className="text-sm">We couldn’t suggest details from this photo. Nothing was changed.</p> : null}</div> : null}
      <div><Label htmlFor="gear-title">Name</Label><Input id="gear-title" value={name} onChange={(event) => setName(event.target.value)} required /></div>
      <div><Label htmlFor="gear-description">Description</Label><Textarea id="gear-description" maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
      <div><Label htmlFor="gear-category">Category</Label><CategoryInput id="gear-category" value={category} categories={categories} onChange={setCategory} /></div>
      <div><Label htmlFor="gear-condition">Condition</Label><Select value={condition || undefined} onValueChange={setCondition}><SelectTrigger id="gear-condition"><SelectValue placeholder="Choose condition" /></SelectTrigger><SelectContent>{GEAR_CONDITIONS.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select></div>
      <div><Label htmlFor="gear-quantity">Identical quantity</Label><Input id="gear-quantity" type="number" min={1} step={1} value={fixedQuantity ?? quantity} onChange={(event) => setQuantity(event.target.valueAsNumber)} disabled={fixedQuantity !== undefined} required />{fixedQuantity !== undefined ? <p className="mt-1 text-xs text-muted-foreground">A copied listing starts as one item. You can adjust its total later from Edit.</p> : null}</div>
      {ownership === "group" ? <div><Label htmlFor="gear-manager">Pickup contact</Label><Select value={custodianId} onValueChange={setCustodianId}><SelectTrigger id="gear-manager"><SelectValue placeholder="Choose a pickup contact" /></SelectTrigger><SelectContent><SelectGroup>{members.map((member) => <SelectItem key={member.id} value={member.id}>{member.display_name}</SelectItem>)}</SelectGroup></SelectContent></Select><p className="mt-1 text-xs text-muted-foreground">Members will coordinate pickup and return with this person.</p></div> : null}
      <BorrowingGuidelinesEditor value={guidelines} onChange={setGuidelines} disabled={create.isPending} />
      {create.isPending && photos.length > 0 ? <p className="text-sm" role="status">Adding photo {Math.min(progress + 1, photos.length)} of {photos.length}…</p> : null}
      {create.error ? <div className="rounded-md border border-destructive/40 p-3"><p className="text-sm font-medium text-destructive">The item was not published.</p><p className="text-sm">{draftCreated ? "Your information and saved photos are still in My Gear as a draft. Try again here or finish it from My Gear." : "No listing was created."}</p><p className="text-xs text-muted-foreground">{(create.error as Error).message}</p></div> : null}
      <div className="sticky bottom-0 z-10 -mx-6 flex flex-col gap-2 border-t bg-card/95 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:flex-row sm:flex-wrap sm:border-0 sm:bg-transparent sm:p-0"><Button type="submit" disabled={create.isPending || !name.trim() || !category || !condition || (ownership === "group" && !custodianId) || !Number.isInteger(fixedQuantity ?? quantity) || (fixedQuantity ?? quantity) < 1}>{create.isPending ? "Publishing…" : ownership === "group" ? "Publish group listing" : "Publish individual listing"}</Button>{onCancel ? <Button type="button" variant="outline" onClick={() => { if (create.isPending) pausePublication.current = true; onCancel(); }}>{create.isPending ? "Pause and close" : "Cancel"}</Button> : null}</div>
    </form></CardContent>
  </Card>;
}
