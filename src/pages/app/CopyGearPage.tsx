import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { GearListingForm } from "@/components/gear/GearListingForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { existingCategories } from "@/lib/categories";
import { copyDraftFromSupply, isCopySource } from "@/lib/copyGear";
import { safeReturnPath, type ReturnState } from "@/lib/navigation";
import { fetchSupplies } from "@/lib/gearShareApi";

export default function CopyGearPage() {
  const { supplyId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [blank, setBlank] = useState(false);
  const supplies = useQuery({ queryKey: ["gear-share-supplies"], queryFn: fetchSupplies });
  const returnTo = safeReturnPath((location.state as ReturnState)?.returnTo, "/catalog");
  const source = (supplies.data ?? []).find((item) => item.id === supplyId);

  if (supplies.isLoading) return <main className="container mx-auto p-4 md:p-8"><p>Loading gear…</p></main>;
  if (!isCopySource(source) && !blank) {
    return <main className="container mx-auto p-4 md:p-8"><Card className="max-w-xl"><CardHeader><CardTitle>Similar-item source unavailable</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-muted-foreground">This listing is no longer visible and active, so none of its descriptive fields were reused. You can start a blank individual listing instead.</p>{supplies.error ? <p className="text-sm text-destructive">The catalog could not be loaded.</p> : null}<div className="flex flex-wrap gap-2"><Button onClick={() => setBlank(true)}>Start blank listing</Button><Button asChild variant="outline"><Link to={returnTo}>Back</Link></Button></div></CardContent></Card></main>;
  }

  const draft = isCopySource(source) ? copyDraftFromSupply(source, existingCategories(supplies.data ?? [])) : undefined;
  return <main className="container mx-auto p-4 md:p-8"><div className="max-w-2xl"><GearListingForm
    key={source?.id ?? "blank"}
    supplies={supplies.data ?? []}
    initialDraft={draft}
    fixedQuantity={source ? 1 : undefined}
    title={source ? `List an item similar to ${source.title}` : "List individual gear"}
    context={source ? <div className="rounded-md bg-muted p-3 text-sm"><strong>Review this new listing before publishing.</strong> The name, description, and category were copied for convenience. Photos, quantity, owner, pickup contact, availability, and loan history were not copied.</div> : undefined}
    onCancel={() => navigate(returnTo)}
    onCreated={() => navigate("/my-gear", { replace: true })}
  /></div></main>;
}
