import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, SlidersHorizontal } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { GearImage } from "@/components/gear/GearImage";
import { GearListingForm } from "@/components/gear/GearListingForm";
import { InventoryActionLink } from "@/components/gear/InventoryActionLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { categoryLabel, conditionLabel, existingCategories } from "@/lib/categories";
import { criteriaFromSearchParams, inventoryResults } from "@/lib/inventoryWorkspace";
import type { Membership, GearItem } from "@/types/gear";

type ActiveMember = { id: string; display_name: string };

export function CoordinatorInventory({ membership, supplies, members, isLoading, error }: {
  membership: Membership;
  supplies: GearItem[];
  members: ActiveMember[];
  isLoading: boolean;
  error: Error | null;
}) {
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const criteria = criteriaFromSearchParams(params);
  const result = inventoryResults(supplies, criteria);
  const groupSupplies = useMemo(() => supplies.filter((item) => item.ownershipKind === "group"), [supplies]);
  const categories = useMemo(() => existingCategories(groupSupplies), [groupSupplies]);
  const managers = useMemo(() => {
    const options = new Map<string, string>();
    for (const item of groupSupplies) options.set(item.custodianId, item.custodianName);
    return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1]) || left[0].localeCompare(right[0]));
  }, [groupSupplies]);
  const hasCriteria = Boolean(criteria.search || criteria.category || criteria.status !== "active" || criteria.managerId);
  useEffect(() => { if (params.get("add") === "1") setAdding(true); }, [params]);

  const changeAdding = (open: boolean) => {
    setAdding(open);
    if (!open && params.has("add")) {
      const next = new URLSearchParams(params);
      next.delete("add");
      setParams(next, { replace: true });
    }
  };

  const updateCriterion = (key: string, value: string, push = false) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: !push });
  };
  const clearCriteria = () => {
    setParams(new URLSearchParams());
  };

  return <section aria-labelledby="inventory-heading" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 id="inventory-heading" className="font-serif text-3xl font-bold">Group inventory</h1><p className="text-muted-foreground">Search and manage gear owned by the group.</p></div>
      <Button ref={addButtonRef} onClick={() => setAdding(true)}><Plus aria-hidden="true" /> Add group gear</Button>
    </div>

    <Card><CardContent className="space-y-4 pt-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(240px,2fr)_repeat(3,minmax(140px,1fr))]">
        <div><Label htmlFor="inventory-search">Search inventory</Label><div className="relative"><Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="inventory-search" className="pl-9" value={criteria.search} onChange={(event) => updateCriterion("q", event.target.value)} placeholder="Search group gear" /></div></div>
        <div className={`${filtersOpen || hasCriteria ? "grid" : "hidden"} gap-4 lg:contents`}>
          <FilterSelect label="Category" value={criteria.category || "all"} onChange={(value) => updateCriterion("category", value === "all" ? "" : value)} options={categories.map((category) => [category, categoryLabel(category)])} />
          <FilterSelect label="Catalog status" value={criteria.status} onChange={(value) => updateCriterion("status", value === "active" ? "" : value)} options={[["active", "Current gear"], ["listed", "Published"], ["unlisted", "Drafts"], ["retired", "Removed"], ["all", "All"]]} includeAll={false} />
          <FilterSelect label="Pickup contact" value={criteria.managerId || "all"} onChange={(value) => updateCriterion("manager", value === "all" ? "" : value)} options={managers} />
        </div>
      </div>
      <Button type="button" variant="outline" className="w-full lg:hidden" aria-expanded={filtersOpen || hasCriteria} onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal aria-hidden="true" />{filtersOpen || hasCriteria ? "Hide filters" : "Show filters"}</Button>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="flex items-center gap-2"><SlidersHorizontal aria-hidden="true" className="h-4 w-4" /><strong>{result.total}</strong> {result.total === 1 ? "result" : "results"}{hasCriteria ? " with active filters" : " in active inventory"}</p>
        {hasCriteria ? <Button size="sm" variant="ghost" onClick={clearCriteria}>Clear filters</Button> : null}
      </div>
    </CardContent></Card>

    {error ? <p className="text-destructive">{error.message}</p> : null}
    {isLoading ? <p className="rounded-lg border p-8 text-center text-muted-foreground">Loading inventory…</p> : null}
    {!isLoading && !error && result.items.length === 0 ? <p className="rounded-lg border p-8 text-center text-muted-foreground">No inventory matches the current search and filters.</p> : null}
    <div className="grid gap-3">{result.items.map((item) => <InventoryResultCard key={item.id} item={item} membership={membership} />)}</div>

    {result.totalPages > 1 ? <nav aria-label="Inventory pages" className="flex flex-wrap items-center justify-center gap-3">
      <Button variant="outline" disabled={result.page <= 1} onClick={() => updateCriterion("page", String(result.page - 1), true)}>Previous</Button>
      <p aria-live="polite" className="min-w-28 text-center text-sm">Page {result.page} of {result.totalPages}</p>
      <Button variant="outline" disabled={result.page >= result.totalPages} onClick={() => updateCriterion("page", String(result.page + 1), true)}>Next</Button>
    </nav> : null}

    <AddGroupGearDialog open={adding} onOpenChange={changeAdding} membership={membership} supplies={supplies} members={members} returnFocusRef={addButtonRef} />
  </section>;
}

function FilterSelect({ label, value, onChange, options, includeAll = true }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][]; includeAll?: boolean }) {
  const id = `inventory-${label.toLocaleLowerCase().replace(/ /g, "-")}`;
  return <div><Label htmlFor={id}>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{includeAll ? <SelectItem value="all">All</SelectItem> : null}{options.map(([optionValue, optionLabel]) => <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>)}</SelectGroup></SelectContent></Select></div>;
}

function InventoryResultCard({ item, membership }: { item: GearItem; membership: Membership }) {
  const removed = item.listingStatus === "retired";
  return <Card><CardContent className="grid gap-4 pt-6 sm:grid-cols-[128px_minmax(0,1fr)_auto] sm:items-center">
    <GearImage imagePath={item.imagePaths[0]} title={item.title} className="w-full sm:w-32" />
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{item.title}</h3><span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{removed ? "removed" : item.listingStatus}</span></div>
      <p className="text-sm text-muted-foreground">{item.ownershipKind === "group" ? "Group-owned" : "Individual-owned"} · {categoryLabel(item.category)} · {conditionLabel(item.condition)} · Quantity {item.quantityTotal}</p>
      <p className="text-sm">Pickup contact: {item.custodianName}</p>
      {item.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p> : null}
    </div>
    <div className="sm:justify-self-end">{removed ? <span className="text-sm text-muted-foreground">History only</span> : <InventoryActionLink item={item} membership={membership} />}</div>
  </CardContent></Card>;
}

function AddGroupGearDialog({ open, onOpenChange, membership, supplies, members, returnFocusRef }: { open: boolean; onOpenChange: (open: boolean) => void; membership: Membership; supplies: GearItem[]; members: ActiveMember[]; returnFocusRef: React.RefObject<HTMLButtonElement> }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="p-0 sm:max-w-2xl" onCloseAutoFocus={(event) => { event.preventDefault(); returnFocusRef.current?.focus(); }}>
    <DialogHeader className="sr-only"><DialogTitle>Add group gear</DialogTitle><DialogDescription>Add gear owned by the group.</DialogDescription></DialogHeader>
    <GearListingForm supplies={supplies} membershipId={membership.id} members={members} initialOwnership="group" title="Add gear" onCancel={() => onOpenChange(false)} onCreated={() => onOpenChange(false)} />
  </DialogContent></Dialog>;
}
