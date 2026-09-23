import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Grid2X2, List, Search, SlidersHorizontal } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { CopyToMyGearLink } from "@/components/gear/CopyToMyGearLink";
import { InventoryActionLink } from "@/components/gear/InventoryActionLink";
import { MemberGearCard } from "@/components/gear/MemberGearCard";
import { CategorySidebar } from "@/components/gear/CategorySidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { catalogQueryFromParams, isPostalCode, isValidCatalogDateRange, localDateValue, normalizePostalCode, paramsFromCatalogQuery } from "@/lib/catalog";
import { GEAR_CONDITIONS } from "@/lib/categories";
import { fetchCatalog, type CatalogQuery } from "@/lib/gearShareApi";
import type { Membership, GearItem } from "@/types/gear";

export default function CatalogPage({ membership }: { membership: Membership }) {
  const [params, setParams] = useSearchParams();
  const query = catalogQueryFromParams(params);
  const canonicalParams = paramsFromCatalogQuery(query);
  const [search, setSearch] = useState(query.search);
  const [postal, setPostal] = useState(query.postal === "all" ? "" : query.postal);
  const [postalError, setPostalError] = useState("");
  const [minimumDate] = useState(localDateValue);
  const [startDate, setStartDate] = useState(query.startDate);
  const [endDate, setEndDate] = useState(query.endDate);
  const [dateError, setDateError] = useState("");
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < 768);
  const [view, setView] = useState<"grid" | "list">(() => {
    try { return window.localStorage.getItem("gear-catalog-view-v1") === "list" ? "list" : "grid"; } catch { return "grid"; }
  });
  const catalog = useQuery({
    queryKey: ["gear-share-catalog", query],
    queryFn: () => fetchCatalog(query),
  });

  useEffect(() => {
    if (params.toString() !== canonicalParams.toString()) setParams(canonicalParams, { replace: true });
  }, [canonicalParams, params, setParams]);

  useEffect(() => {
    setSearch(query.search);
    setPostal(query.postal === "all" ? "" : query.postal);
    setStartDate(query.startDate);
    setEndDate(query.endDate);
  }, [query.search, query.postal, query.startDate, query.endDate]);

  useEffect(() => {
    try { window.localStorage.setItem("gear-catalog-view-v1", view); } catch { /* Browsing still works when storage is unavailable. */ }
  }, [view]);

  useEffect(() => {
    const updateWidth = () => setIsNarrow(window.innerWidth < 768);
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  useEffect(() => {
    if (catalog.data && query.page !== catalog.data.page) {
      setParams(paramsFromCatalogQuery({ ...query, page: catalog.data.page }), { replace: true });
    }
  }, [catalog.data, query, setParams]);

  const update = (changes: Partial<CatalogQuery>, replace = false) => {
    setParams(paramsFromCatalogQuery({ ...query, ...changes, page: changes.page ?? 1 }), { replace });
  };
  const applyPostal = () => {
    const normalized = normalizePostalCode(postal);
    if (!normalized) {
      setPostalError("");
      update({ postal: "all" });
    } else if (!isPostalCode(normalized)) {
      setPostalError("Enter one complete 3–10 character ZIP or postal code.");
    } else {
      setPostal(normalized);
      setPostalError("");
      update({ postal: normalized });
    }
  };
  const applyDates = () => {
    if (!startDate || !endDate) {
      setDateError("Choose both a start date and an end date.");
      return;
    }
    if (startDate < minimumDate) {
      setDateError("Choose today or a later start date.");
      return;
    }
    if (!isValidCatalogDateRange(startDate, endDate, minimumDate)) {
      setDateError("Choose an end date on or after the start date.");
      return;
    }
    setDateError("");
    update({ startDate, endDate });
  };
  const clearDates = () => {
    setStartDate("");
    setEndDate("");
    setDateError("");
    update({ startDate: "", endDate: "", availableOnly: false });
  };
  const clearAll = () => {
    setSearch("");
    setPostal("");
    setPostalError("");
    setStartDate("");
    setEndDate("");
    setDateError("");
    setParams(new URLSearchParams());
  };
  const hasDateRange = Boolean(query.startDate && query.endDate);
  const datesDirty = startDate !== query.startDate || endDate !== query.endDate;
  const requestDates = hasDateRange ? { startDate: query.startDate, endDate: query.endDate } : undefined;
  const hasFilters = Boolean(query.search || query.category !== "all" || query.ownership !== "all" || query.condition !== "all" || query.postal !== "all" || hasDateRange);
  const secondaryFilterCount = Number(isNarrow && query.category !== "all") + Number(query.ownership !== "all") + Number(query.condition !== "all") + Number(query.postal !== "all");

  const categories = <CategorySidebar value={query.category} onChange={(category) => update({ category })} />;
  const filters = <div className="grid gap-3">
    <CatalogSelect label="Ownership" value={query.ownership} onChange={(value) => update({ ownership: value as CatalogQuery["ownership"] })} options={[["group", "Group-owned"], ["individual", "Member-owned"]]} />
    <CatalogSelect label="Condition" value={query.condition} onChange={(value) => update({ condition: value as CatalogQuery["condition"] })} options={GEAR_CONDITIONS.map((option) => [option.id, option.label])} />
    <div><Label htmlFor="catalog-postal">ZIP or postal code</Label><div className="flex gap-2"><Input id="catalog-postal" value={postal} maxLength={10} onChange={(event) => { setPostal(event.target.value); setPostalError(""); }} onBlur={applyPostal} placeholder="Optional" aria-describedby={postalError ? "catalog-postal-error" : undefined} /><Button type="button" variant="outline" onClick={applyPostal}>Apply</Button></div></div>
  </div>;
  const filterSheet = <Sheet><SheetTrigger asChild><Button type="button" variant="outline" className="h-9 gap-2 bg-card px-3"><SlidersHorizontal className="h-4 w-4" />Filters{secondaryFilterCount ? ` (${secondaryFilterCount})` : ""}</Button></SheetTrigger><SheetContent side="right" className="overflow-y-auto"><SheetHeader className="mb-6"><SheetTitle>Filter gear</SheetTitle><SheetDescription>{isNarrow ? "Narrow results by category, ownership, condition, or ZIP." : "Narrow results by ownership, condition, or ZIP."}</SheetDescription></SheetHeader>{isNarrow ? <div className="mb-4"><CategorySidebar layout="select" value={query.category} onChange={(category) => update({ category })} /></div> : null}{filters}</SheetContent></Sheet>;

  return (
    <main className="container mx-auto px-4 py-5 md:px-8 md:py-8">
      <h1 className="sr-only">Browse gear</h1>
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
        {!isNarrow ? <aside><div className="sticky top-28">{categories}</div></aside> : null}
        <div className="min-w-0 space-y-3">
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); update({ search: search.trim().slice(0, 100) }); }}>
            <div className="relative min-w-0 flex-1"><Search aria-hidden="true" className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search gear" className="h-11 bg-card pl-9" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder={isNarrow ? "Search gear" : "Search gear by name or category"} /></div><Button type="submit" className="h-11 bg-dusk-pink px-5 hover:bg-dusk-pink/90">Search</Button>
          </form>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="space-y-2 p-3">
              <div className="grid gap-2 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-end">
                <div className="flex h-9 items-center gap-2"><CalendarRange className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><h2 className="text-sm font-semibold">Dates</h2></div>
                <div className="grid grid-cols-2 gap-2 md:contents">
                  <div className="min-w-0"><Label className="sr-only" htmlFor="catalog-start-date">Start date</Label><Input className="h-9 min-w-0 px-2 sm:px-3" id="catalog-start-date" type="date" min={minimumDate} value={startDate} onChange={(event) => { setStartDate(event.target.value); setDateError(""); }} aria-describedby={dateError ? "catalog-date-error" : undefined} aria-invalid={Boolean(dateError)} /></div>
                  <div className="min-w-0"><Label className="sr-only" htmlFor="catalog-end-date">End date</Label><Input className="h-9 min-w-0 px-2 sm:px-3" id="catalog-end-date" type="date" min={startDate || minimumDate} value={endDate} onChange={(event) => { setEndDate(event.target.value); setDateError(""); }} aria-describedby={dateError ? "catalog-date-error" : undefined} aria-invalid={Boolean(dateError)} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2 md:contents">
                  <Button type="button" className="h-9 px-3" aria-label={hasDateRange ? "Update availability" : "Check dates"} onClick={applyDates}>{hasDateRange ? "Update" : "Check dates"}</Button>
                  {filterSheet}
                </div>
              </div>
              {dateError ? <p id="catalog-date-error" className="text-sm text-destructive" role="alert">{dateError}</p> : null}
              <div className="flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1">
                <label className={`flex items-center gap-2 text-sm ${hasDateRange && !datesDirty ? "cursor-pointer" : "text-muted-foreground"}`}><input aria-label="Available items only" type="checkbox" checked={query.availableOnly} disabled={!hasDateRange || datesDirty} onChange={(event) => update({ availableOnly: event.target.checked })} /><span aria-hidden="true">Available only</span></label>
                {hasDateRange ? <div className="flex min-w-0 flex-1 items-center justify-between gap-2"><p className={`text-xs font-medium sm:text-sm ${datesDirty ? "text-amber-800" : "text-primary"}`}>{datesDirty ? "Results still use " : "Showing "}{formatCatalogDate(query.startDate)}–{formatCatalogDate(query.endDate)}{datesDirty ? " until updated." : ""}</p><Button type="button" variant="ghost" size="sm" className="h-auto shrink-0 px-1.5 py-0.5" onClick={clearDates}>Clear</Button></div> : null}
              </div>
            </CardContent>
          </Card>
          {postalError ? <p id="catalog-postal-error" className="text-sm text-destructive">{postalError}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1"><p className="text-sm" role="status" aria-live="polite">{catalog.isLoading ? "Loading gear…" : catalog.error ? "Catalog could not be loaded." : <><strong>{catalog.data?.total ?? 0}</strong> {(catalog.data?.total ?? 0) === 1 ? "item" : "items"}{hasDateRange ? ` for ${formatCatalogDate(query.startDate)}–${formatCatalogDate(query.endDate)}` : ""}</>}</p><div className="flex items-center gap-1">{hasFilters ? <Button size="sm" variant="ghost" onClick={clearAll}>Clear filters</Button> : null}<div role="group" aria-label="Catalog view" className="flex rounded-md border bg-background p-0.5"><Button type="button" size="icon" variant={view === "grid" ? "default" : "ghost"} className="h-8 w-8" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}><Grid2X2 className="h-4 w-4" /></Button><Button type="button" size="icon" variant={view === "list" ? "default" : "ghost"} className="h-8 w-8" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}><List className="h-4 w-4" /></Button></div></div></div>

          {catalog.error ? <div className="rounded-lg border border-destructive/40 p-6"><p className="text-destructive">{(catalog.error as Error).message}</p><Button className="mt-3" variant="outline" onClick={() => catalog.refetch()}>Try again</Button></div> : null}
          {!catalog.isLoading && !catalog.error && catalog.data?.items.length === 0 ? <p className="rounded-lg border p-8 text-center text-muted-foreground">No gear matches these filters.</p> : null}
          <div className={view === "grid" ? "grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4" : "grid gap-3"}>
            {(catalog.data?.items ?? []).map((item) => <CatalogCard key={item.id} item={item} membership={membership} view={view} requestDates={requestDates} />)}
          </div>
          {(catalog.data?.totalPages ?? 1) > 1 ? <nav aria-label="Catalog pages" className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="outline" disabled={query.page <= 1} onClick={() => update({ page: query.page - 1 })}>Previous</Button>
        <p aria-live="polite" className="min-w-32 text-center text-sm">Page {query.page} of {catalog.data?.totalPages}</p>
        <Button variant="outline" disabled={query.page >= (catalog.data?.totalPages ?? 1)} onClick={() => update({ page: query.page + 1 })}>Next</Button>
          </nav> : null}
        </div>
      </div>
    </main>
  );
}

function CatalogSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: readonly (readonly [string, string])[] }) {
  const id = `catalog-${label.toLowerCase()}`;
  return <div><Label htmlFor={id}>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem>{options.map(([optionValue, optionLabel]) => <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>)}</SelectContent></Select></div>;
}

function CatalogCard({ item, membership, view, requestDates }: { item: GearItem; membership: Membership; view: "grid" | "list"; requestDates?: { startDate: string; endDate: string } }) {
  return <MemberGearCard variant={view === "grid" ? "catalog" : "catalog-list"} item={item} requestDates={requestDates} actions={<><CatalogRequestAction item={item} membership={membership} requestDates={requestDates} /><InventoryActionLink item={item} membership={membership} /><CopyToMyGearLink item={item} membership={membership} /></>} />;
}

function CatalogRequestAction({ item, membership, requestDates }: { item: GearItem; membership: Membership; requestDates?: { startDate: string; endDate: string } }) {
  const location = useLocation();
  const isIndividualOwner = item.ownershipKind === "individual" && item.ownerId === membership.id;
  if (item.listingStatus !== "listed" || isIndividualOwner) return null;

  return <div className="w-full sm:w-auto"><Button asChild size="sm" className="w-full sm:w-auto"><Link to={`/gear/${encodeURIComponent(item.id)}#request`} state={{ returnTo: `${location.pathname}${location.search}`, ...(requestDates ? { catalogDates: requestDates } : {}) }}>Request to borrow</Link></Button></div>;
}

function formatCatalogDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
}
