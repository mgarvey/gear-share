import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GEAR_CATEGORIES } from "@/lib/categories";

export function CategoryInput({ id, value, onChange }: { id: string; value: string; categories?: string[]; onChange: (value: string) => void }) {
  return (
    <>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={id} aria-label="Category"><SelectValue placeholder="Choose a category" /></SelectTrigger>
        <SelectContent>
          {GEAR_CATEGORIES.map((category) => <SelectItem key={category.id} value={category.id}>{category.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <p className="mt-1 text-xs text-muted-foreground">Choose the closest Scout gear category.</p>
    </>
  );
}
