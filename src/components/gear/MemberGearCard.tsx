import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { GearImage } from "@/components/gear/GearImage";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { categoryLabel, conditionLabel } from "@/lib/categories";
import type { GearItem } from "@/types/gear";

type RequestDates = { startDate: string; endDate: string };

export function MemberGearCard({ item, actions, variant = "workspace", requestDates }: { item: GearItem; actions?: ReactNode; variant?: "catalog" | "catalog-list" | "workspace"; requestDates?: RequestDates }) {
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  const detailState = { returnTo, ...(requestDates ? { catalogDates: requestDates } : {}) };
  const quantitySummary = item.availableQuantity == null ? `${item.quantityTotal} total` : `${item.availableQuantity} of ${item.quantityTotal} available`;
  const availabilityClass = item.availableQuantity === 0 ? "font-semibold text-amber-800" : item.availableQuantity != null ? "font-semibold text-green-800" : "";
  if (variant === "catalog-list") return <Card className="overflow-hidden shadow-sm"><div className="lg:grid lg:grid-cols-[minmax(0,1fr)_11rem]">
    <Link to={`/gear/${encodeURIComponent(item.id)}`} state={detailState} className="group grid min-h-28 grid-cols-[7rem_minmax(0,1fr)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:grid-cols-[8rem_minmax(0,1fr)]" aria-label={`View ${item.title}`}>
      <GearImage imagePath={item.imagePaths[0]} title={item.title} variant="compact" className="aspect-auto h-full w-full min-w-0 rounded-none border-r" />
      <div className="min-w-0 p-3"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">{categoryLabel(item.category)}</p><h2 className="line-clamp-2 font-sans text-base font-bold group-hover:underline sm:text-lg">{item.title}</h2><p className="mt-1.5 text-sm text-muted-foreground"><span>{item.ownershipKind === "group" ? "Group gear" : "Member gear"}</span> · with {item.custodianName}</p><p className="mt-0.5 text-sm text-muted-foreground">{item.custodianPostalCode ? `${item.custodianPostalCode} · ` : ""}{conditionLabel(item.condition)} · <span className={availabilityClass}>{quantitySummary}</span></p>{item.needsAttention ? <p className="mt-1 text-xs font-semibold text-amber-800">Needs attention</p> : <p className="mt-1 text-sm font-semibold text-primary">View details</p>}</div>
    </Link>
    {actions ? <CardFooter className="flex flex-wrap gap-3 border-t p-3 lg:flex-col lg:items-stretch lg:justify-center lg:border-l lg:border-t-0 lg:[&>div]:w-full lg:[&>div_a]:w-full [&>a]:h-auto [&>a]:border-0 [&>a]:bg-transparent [&>a]:px-0 [&>a]:text-primary [&>a]:shadow-none [&>a]:hover:bg-transparent [&>a]:hover:underline">{actions}</CardFooter> : null}
  </div></Card>;
  return <Card className="flex h-full flex-col overflow-hidden">
    <Link to={`/gear/${encodeURIComponent(item.id)}`} state={detailState} className="group flex flex-1 flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label={`View ${item.title}`}>
      <GearImage imagePath={item.imagePaths[0]} title={item.title} variant={variant === "catalog" ? "compact" : "card"} className="rounded-none border-b" />
      <CardHeader className={variant === "catalog" ? "space-y-2 p-3 sm:p-4" : undefined}><p className="w-fit rounded-full bg-primary px-2 py-0.5 text-[0.65rem] font-semibold text-primary-foreground sm:text-xs">{categoryLabel(item.category)}</p><CardTitle className={variant === "catalog" ? "line-clamp-2 font-sans text-base group-hover:underline sm:text-lg" : "group-hover:underline"}>{item.title}</CardTitle>{item.needsAttention ? <p className="rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-950">Needs attention</p> : null}</CardHeader>
      {variant === "catalog" ? <CardContent className="flex-1 space-y-1 px-3 pb-3 text-xs text-muted-foreground sm:px-4 sm:pb-4 sm:text-sm"><p><span>{item.ownershipKind === "group" ? "Group gear" : "Member gear"}</span> · with {item.custodianName}</p><p>{conditionLabel(item.condition)} · <span className={availabilityClass}>{quantitySummary}</span></p>{item.custodianPostalCode ? <p>Near {item.custodianPostalCode}</p> : null}<p className="pt-1 font-semibold text-primary">View details</p></CardContent> : <CardContent className="flex-1 space-y-2 text-sm"><p>{item.description || "No description."}</p><p><strong>Category:</strong> {categoryLabel(item.category)}</p><p><strong>Condition:</strong> {conditionLabel(item.condition)}</p><p><strong>Total quantity:</strong> {item.quantityTotal}</p><p><strong>Pickup contact:</strong> {item.custodianName}{item.custodianPostalCode ? ` · ${item.custodianPostalCode}` : ""}</p></CardContent>}
    </Link>
    {actions ? <CardFooter className={`flex flex-wrap gap-2 border-t ${variant === "catalog" ? "gap-2 p-3 text-xs [&>a]:h-auto [&>a]:whitespace-nowrap [&>a]:border-0 [&>a]:bg-transparent [&>a]:px-0 [&>a]:text-xs [&>a]:text-primary [&>a]:shadow-none [&>a]:hover:bg-transparent [&>a]:hover:underline sm:text-sm sm:[&>a]:text-sm" : "pt-4"}`}>{actions}</CardFooter> : null}
  </Card>;
}
