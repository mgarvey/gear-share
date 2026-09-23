import { useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const SUGGESTED_BORROWING_GUIDELINES = [
  "Return the item clean and dry.",
  "Report any damage or missing parts promptly.",
  "Follow the owner's pickup and return instructions.",
];

export function BorrowingGuidelinesEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (rules: string[]) => void;
  disabled?: boolean;
}) {
  const baseId = useId();
  const [draft, setDraft] = useState("");
  const total = useMemo(
    () => value.reduce((sum, rule) => sum + rule.trim().length, 0),
    [value],
  );
  const add = () => {
    const normalized = draft.trim().replace(/\s+/g, " ");
    if (
      !normalized ||
      normalized.length > 200 ||
      value.length >= 8 ||
      total + normalized.length > 1200 ||
      value.some((rule) => rule.toLocaleLowerCase() === normalized.toLocaleLowerCase())
    ) return;
    onChange([...value, normalized]);
    setDraft("");
  };
  const move = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= value.length) return;
    const next = [...value];
    [next[index], next[destination]] = [next[destination], next[index]];
    onChange(next);
  };
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border p-4" disabled={disabled}>
      <legend className="px-1 font-semibold">Borrowing guidelines</legend>
      <p className="text-sm text-muted-foreground">
        Add any pickup, care, or return instructions a borrower should agree to before requesting this item.
      </p>
      {value.length === 0 ? <Button className="self-start" type="button" variant="outline" onClick={() => onChange([...SUGGESTED_BORROWING_GUIDELINES])}>Use suggested guidelines</Button> : null}
      <ol className="flex flex-col gap-2">
        {value.map((rule, index) => (
          <li key={`${rule}-${index}`} className="flex items-start gap-2 rounded-md bg-muted/50 p-2">
            <span className="min-w-0 flex-1 text-sm">{index + 1}. {rule}</span>
            <Button type="button" size="icon" variant="ghost" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move guideline ${index + 1} up`}><ArrowUp /></Button>
            <Button type="button" size="icon" variant="ghost" onClick={() => move(index, 1)} disabled={index === value.length - 1} aria-label={`Move guideline ${index + 1} down`}><ArrowDown /></Button>
            <Button type="button" size="icon" variant="ghost" onClick={() => onChange(value.filter((_, ruleIndex) => ruleIndex !== index))} aria-label={`Remove guideline ${index + 1}`}><Trash2 /></Button>
          </li>
        ))}
      </ol>
      <div>
        <Label htmlFor={`${baseId}-new`}>Add a guideline</Label>
        <div className="mt-1 flex gap-2">
          <Input
            id={`${baseId}-new`}
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); add(); }
              if (event.key === "Escape") setDraft("");
            }}
          />
          <Button type="button" variant="outline" onClick={add} disabled={!draft.trim() || value.length >= 8 || total + draft.trim().length > 1200}><Plus data-icon="inline-start" /> Add</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{value.length} of 8 guidelines added</p>
    </fieldset>
  );
}
