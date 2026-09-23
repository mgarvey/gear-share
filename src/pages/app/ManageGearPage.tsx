import { useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { CategoryInput } from "@/components/gear/CategoryInput";
import { BorrowingGuidelinesEditor } from "@/components/gear/BorrowingGuidelinesEditor";
import { GearImage } from "@/components/gear/GearImage";
import { PrivatePhotoPicker } from "@/components/gear/PrivatePhotoPicker";
import { RemoveFromInventoryButton } from "@/components/gear/RemoveFromInventoryButton";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { canonicalCategory, categoryLabel, conditionLabel, existingCategories, GEAR_CONDITIONS } from "@/lib/categories";
import { inventoryActions } from "@/lib/inventoryActions";
import { safeReturnPath, type ReturnState } from "@/lib/navigation";
import {
  convertIndividualDonation,
  fetchActiveMembers,
  fetchSupplies,
  removeGearImage,
  retireSupply,
  setSupplyContact,
  setSupplyImageOrder,
  updateSupply,
  uploadGearImagesSequential,
  publishSupplyDraft,
} from "@/lib/gearShareApi";
import type { Membership, GearItem } from "@/types/gear";

export default function ManageGearPage({ membership }: { membership: Membership }) {
  const { supplyId = "" } = useParams();
  const location = useLocation();
  const fallback = membership.accessLevel !== "regular" ? "/inventory" : "/my-gear";
  const returnTo = safeReturnPath((location.state as ReturnState)?.returnTo, fallback);
  const supplies = useQuery({ queryKey: ["gear-share-supplies"], queryFn: fetchSupplies });
  const item = (supplies.data ?? []).find((candidate) => candidate.id === supplyId);

  if (supplies.isLoading) return <main className="container mx-auto p-4 md:p-8"><p>Loading gear…</p></main>;
  if (supplies.error) return <Unavailable returnTo={returnTo} detail={(supplies.error as Error).message} />;
  if (!item) return <Unavailable returnTo={returnTo} detail="This listing is unavailable or you no longer have access to it." />;

  const actions = inventoryActions(membership, item);
  if (actions.isHistorical || (!actions.canEdit && !actions.canManageAvailability && !actions.canRemove && !actions.canDonate)) {
    return <Unavailable returnTo={returnTo} detail="This listing is removed or you are no longer authorized to manage it." />;
  }

  return <InventoryEditor key={item.id} item={item} membership={membership} returnTo={returnTo} supplies={supplies.data ?? []} />;
}

function InventoryEditor({ item, membership, returnTo, supplies }: { item: GearItem; membership: Membership; returnTo: string; supplies: GearItem[] }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const actions = inventoryActions(membership, item);
  const categories = useMemo(() => existingCategories(supplies), [supplies]);
  const members = useQuery({ queryKey: ["active-members", item.id], queryFn: () => fetchActiveMembers(item.id), enabled: actions.canReassign || actions.canDonate });
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [category, setCategory] = useState(item.category ?? "");
  const [condition, setCondition] = useState(item.condition ?? "");
  const [quantity, setQuantity] = useState(item.quantityTotal);
  const [guidelines, setGuidelines] = useState(item.borrowingGuidelines ?? []);
  const [custodianId, setCustodianId] = useState(item.custodianId);
  const [donationCustodianId, setDonationCustodianId] = useState(item.custodianId);
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [photoProgress, setPhotoProgress] = useState(0);
  const pauseUpload = useRef(false);

  const refresh = () => client.invalidateQueries({ queryKey: ["gear-share-supplies"] });
  const operation = useMutation({
    mutationFn: async (action: "save" | "list" | "unlist" | "donate" | "retire") => {
      if (action === "donate") return convertIndividualDonation(item.id, donationCustodianId);
      if (action === "retire") return retireSupply(item.id);
      const status = action === "list" ? "listed" : action === "unlist" ? "unlisted" : item.listingStatus;
      const values = actions.canEdit
        ? { title, description, category: canonicalCategory(category, categories), condition: condition as typeof GEAR_CONDITIONS[number]["id"], quantity, guidelineVersion: item.guidelineVersion ?? 0, borrowingGuidelines: guidelines }
        : { title: item.title, description: item.description, category: canonicalCategory(item.category ?? "", categories), condition: item.condition as typeof GEAR_CONDITIONS[number]["id"], quantity: item.quantityTotal };
      await updateSupply({ id: item.id, ...values, status });
      if (action === "save" && actions.canReassign && custodianId !== item.custodianId) {
        await setSupplyContact(item.id, custodianId);
      }
    },
    onSuccess: async (_data, action) => {
      await refresh();
      if (action === "save" || action === "retire" || action === "donate") navigate(returnTo, { replace: true });
    },
  });
  const upload = useMutation({
    mutationFn: async () => {
      pauseUpload.current = false;
      if (newPhotos.length) await uploadGearImagesSequential(item, newPhotos, item.imagePaths.length, (done) => setPhotoProgress(done), () => pauseUpload.current);
      if (item.listingStatus === "unlisted" && item.publicationAttemptId) await publishSupplyDraft(item.id, item.publicationAttemptId);
    },
    onSuccess: async () => { setNewPhotos([]); setPhotoProgress(0); await refresh(); },
  });
  const removeImage = useMutation({ mutationFn: (path: string) => removeGearImage(item, path), onSuccess: refresh });
  const reorderImage = useMutation({ mutationFn: (paths: string[]) => setSupplyImageOrder(item.id, paths), onSuccess: refresh });
  const error = operation.error || upload.error || removeImage.error || reorderImage.error || members.error;
  const moveImage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= item.imagePaths.length) return;
    const paths = [...item.imagePaths];
    [paths[index], paths[target]] = [paths[target], paths[index]];
    reorderImage.mutate(paths);
  };

  return (
    <main className="container mx-auto p-4 md:p-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{item.ownershipKind === "group" ? "Group-owned" : "Individual-owned"} gear</p>
          <h1 className="font-serif text-3xl font-bold">{actions.canEdit ? `Edit ${item.title}` : `Manage availability for ${item.title}`}</h1>
        </div>
        <Button asChild variant="outline"><Link to={returnTo}>Back to inventory</Link></Button>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Listing details</CardTitle></CardHeader>
            <CardContent>
              {actions.canEdit ? <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); operation.mutate("save"); }}>
                <div><Label htmlFor="manage-title">Name</Label><Input id="manage-title" value={title} onChange={(event) => setTitle(event.target.value)} required /></div>
                <div><Label htmlFor="manage-description">Description</Label><Textarea id="manage-description" maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div><Label htmlFor="manage-category">Category</Label><CategoryInput id="manage-category" value={category} categories={categories} onChange={setCategory} /></div>
                  <div><Label htmlFor="manage-condition">Condition</Label><Select value={condition || undefined} onValueChange={setCondition}><SelectTrigger id="manage-condition"><SelectValue placeholder="Choose condition" /></SelectTrigger><SelectContent>{GEAR_CONDITIONS.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select></div>
                  <div><Label htmlFor="manage-quantity">Total quantity</Label><Input id="manage-quantity" type="number" min={1} step={1} value={quantity} onChange={(event) => setQuantity(event.target.valueAsNumber)} required /></div>
                </div>
                {actions.canReassign ? <div><Label htmlFor="manage-custodian">Pickup contact</Label><Select value={custodianId} onValueChange={setCustodianId}><SelectTrigger id="manage-custodian"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{(members.data ?? []).map((member) => <SelectItem key={member.id} value={member.id}>{member.display_name}</SelectItem>)}</SelectGroup></SelectContent></Select><p className="mt-1 text-sm text-muted-foreground">The member who currently has this item and will coordinate pickup and return.</p></div> : null}
                <BorrowingGuidelinesEditor value={guidelines} onChange={setGuidelines} disabled={operation.isPending} />
                <div className="sticky bottom-0 z-10 -mx-6 flex flex-col gap-2 border-t bg-card/95 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:flex-row sm:flex-wrap sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-5"><Button type="submit" disabled={operation.isPending || !title.trim() || !category || !condition || !Number.isInteger(quantity) || quantity < 1}>Save changes</Button><Button type="button" variant="outline" onClick={() => navigate(returnTo)}>Cancel</Button></div>
              </form> : <div className="space-y-2 text-sm"><p>{item.description || "No description."}</p><p><strong>Category:</strong> {categoryLabel(item.category)}</p><p><strong>Condition:</strong> {conditionLabel(item.condition)}</p><p><strong>Total quantity:</strong> {item.quantityTotal}</p></div>}
            </CardContent>
          </Card>

          {actions.canDonate ? <Card><CardHeader><CardTitle>Donate to the group</CardTitle></CardHeader><CardContent className="flex flex-col gap-3"><p className="text-sm text-muted-foreground">Transfer this item to group ownership while keeping its listing and lending history.</p><Label htmlFor="donation-custodian">Pickup contact after donation</Label><Select value={donationCustodianId} onValueChange={setDonationCustodianId}><SelectTrigger id="donation-custodian"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{(members.data ?? []).map((member) => <SelectItem key={member.id} value={member.id}>{member.display_name}</SelectItem>)}</SelectGroup></SelectContent></Select><AlertDialog><AlertDialogTrigger asChild><Button className="w-fit" disabled={operation.isPending || !donationCustodianId}>Review group donation</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Donate {item.title} to the group?</AlertDialogTitle><AlertDialogDescription>This keeps the listing and its lending history, changes the owner to the group, and assigns the selected pickup contact.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep individual ownership</AlertDialogCancel><AlertDialogAction onClick={() => operation.mutate("donate")}>Confirm donation</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></CardContent></Card> : null}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Photos</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {item.imagePaths.length > 0 ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                {item.imagePaths.map((path, index) => <div key={path} className="rounded-md border p-2"><GearImage imagePath={path} title={`${item.title}, photo ${index + 1}`} variant="editor" /><p className="mt-1 text-xs font-medium">{index === 0 ? "Main photo" : `Photo ${index + 1}`}</p>{actions.canManageMedia ? <div className="mt-2 flex flex-wrap gap-1"><Button type="button" size="icon" variant="outline" disabled={reorderImage.isPending || index === 0} onClick={() => moveImage(index, -1)} aria-label={`Move photo ${index + 1} earlier`}><ArrowLeft /></Button><Button type="button" size="icon" variant="outline" disabled={reorderImage.isPending || index === item.imagePaths.length - 1} onClick={() => moveImage(index, 1)} aria-label={`Move photo ${index + 1} later`}><ArrowRight /></Button><Button type="button" size="sm" variant="outline" disabled={removeImage.isPending} onClick={() => removeImage.mutate(path)}>Remove photo</Button></div> : null}</div>)}
              </div> : <GearImage title={item.title} />}
              {actions.canManageMedia && item.imagePaths.length < 4 ? <div className="space-y-3"><PrivatePhotoPicker id="manage-image" label="Add photos" value={newPhotos} onChange={setNewPhotos} max={4 - item.imagePaths.length} disabled={upload.isPending} />{upload.isPending && newPhotos.length > 0 ? <p className="text-sm" role="status">Adding photo {Math.min(photoProgress + 1, newPhotos.length)} of {newPhotos.length}…</p> : null}<div className="flex flex-wrap gap-2"><Button type="button" variant={item.listingStatus === "unlisted" ? "default" : "outline"} disabled={upload.isPending || (newPhotos.length === 0 && item.listingStatus !== "unlisted")} onClick={() => upload.mutate()}>{item.listingStatus === "unlisted" ? "Finish and publish" : "Add photos"}</Button>{upload.isPending ? <Button type="button" variant="outline" onClick={() => { pauseUpload.current = true; }}>Pause after this photo</Button> : null}</div></div> : null}
              {actions.canManageMedia && item.listingStatus === "unlisted" && item.imagePaths.length === 4 ? <Button type="button" disabled={upload.isPending} onClick={() => upload.mutate()}>Finish and publish</Button> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Listing status</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="font-medium">{item.listingStatus === "listed" ? "Published" : "Draft"}</p>
              {actions.canManageAvailability && !item.publicationAttemptId ? <Button size="sm" variant={item.listingStatus === "listed" ? "outline" : "default"} disabled={operation.isPending} onClick={() => operation.mutate(item.listingStatus === "listed" ? "unlist" : "list")}>{item.listingStatus === "listed" ? "Hide from catalog" : "Publish in catalog"}</Button> : item.publicationAttemptId ? <p className="text-sm text-muted-foreground">This draft isn’t visible in the catalog yet. Add any remaining photos, then publish it.</p> : <p className="text-sm text-muted-foreground">The individual owner controls whether this item appears in the catalog.</p>}
            </CardContent>
          </Card>

          {actions.canRemove ? <Card className="border-destructive/30"><CardContent className="pt-6"><RemoveFromInventoryButton title={item.title} label={!item.ownerIsActive && item.ownershipKind === "individual" ? "Remove inactive member listing" : "Remove from inventory"} onConfirm={() => operation.mutate("retire")} /></CardContent></Card> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{(error as Error).message}</p> : null}
          {!actions.canEdit ? <Button className="w-fit" variant="outline" onClick={() => navigate(returnTo)}>Back</Button> : null}
        </aside>
      </div>
    </main>
  );
}

function Unavailable({ returnTo, detail }: { returnTo: string; detail: string }) {
  return <main className="container mx-auto p-4 md:p-8"><Card className="max-w-xl"><CardHeader><CardTitle>Listing unavailable</CardTitle></CardHeader><CardContent className="flex flex-col gap-4"><p className="text-muted-foreground">{detail}</p><Button asChild className="w-fit" variant="outline"><Link to={returnTo}>Back to inventory</Link></Button></CardContent></Card></main>;
}
