import {
  Backpack,
  BedSingle,
  BookOpen,
  BriefcaseMedical,
  Compass,
  CookingPot,
  Droplets,
  Package,
  Shirt,
  TentTree,
  Wrench,
} from "lucide-react";
import { GEAR_CATEGORIES } from "@/lib/categories";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GearCategory } from "@/types/gear";

const icons = {
  "tents-shelters": TentTree,
  "sleep-systems": BedSingle,
  "packs-storage": Backpack,
  "camp-kitchen": CookingPot,
  "water-hydration": Droplets,
  "tools-repair": Wrench,
  "safety-first-aid": BriefcaseMedical,
  "program-activity": Compass,
  "uniforms-apparel": Shirt,
  "books-guides": BookOpen,
  "other-gear": Package,
} satisfies Record<GearCategory, typeof Package>;

export function CategorySidebar({ value, onChange, layout = "sidebar" }: { value: GearCategory | "all"; onChange: (value: GearCategory | "all") => void; layout?: "sidebar" | "select" }) {
  const entries = [{ id: "all" as const, label: "All gear", Icon: Package }, ...GEAR_CATEGORIES.map((category) => ({ ...category, Icon: icons[category.id] }))];
  if (layout === "select") return <div className="space-y-1.5">
    <Label htmlFor="catalog-category">Category</Label>
    <Select value={value} onValueChange={(category) => onChange(category as GearCategory | "all")}>
      <SelectTrigger id="catalog-category" aria-label="Category" className="h-11 w-full bg-card"><SelectValue /></SelectTrigger>
      <SelectContent>{entries.map(({ id, label }) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
  return <nav aria-label="Gear categories" className="space-y-1 rounded-lg border bg-card p-3 shadow-sm">
    <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Categories</p>
    {entries.map(({ id, label, Icon }) => {
      const selected = value === id;
      return <button key={id} type="button" aria-current={selected ? "page" : undefined} onClick={() => onChange(id)} className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors ${selected ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}><Icon className="h-4 w-4 shrink-0" />{label}</button>;
    })}
    <p className="mt-5 rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">This is a private community. Only approved members can view and request gear.</p>
  </nav>;
}
