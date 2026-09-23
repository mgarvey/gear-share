import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { convertSelectedImage } from "@/lib/safeImage";

type Prepared = { file: File; previewUrl: string; originalName: string };

export function PrivatePhotoPicker({ id, value, onChange, max = 4, disabled = false, label = "Photos (optional)" }: {
  id: string; value: File[]; onChange: (files: File[]) => void; max?: number; disabled?: boolean; label?: string;
}) {
  const [prepared, setPrepared] = useState<Prepared[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  useEffect(() => {
    if (value.length > 0 && prepared.length === 0) {
      const restored = value.map((file) => {
        const previewUrl = URL.createObjectURL(file);
        urls.current.push(previewUrl);
        return { file, previewUrl, originalName: file.name };
      });
      setPrepared(restored);
    }
  }, [value, prepared.length]);
  useEffect(() => {
    if (value.length === 0 && prepared.length > 0) {
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current = [];
      setPrepared([]);
    }
  }, [value.length, prepared.length]);

  const choose = async (selected: FileList | null) => {
    if (!selected) return;
    setError("");
    const remaining = Math.max(0, max - prepared.length);
    const selectedFiles = [...selected];
    const incoming = selectedFiles.slice(0, remaining);
    if (selectedFiles.length > remaining) setError(`Choose up to ${max} photo${max === 1 ? "" : "s"}.`);
    setProcessing(true);
    try {
      const next: Prepared[] = [];
      const failures: string[] = [];
      for (const source of incoming) {
        try {
          const converted = await convertSelectedImage(source);
          const file = new File([converted.blob], `${source.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
          const previewUrl = URL.createObjectURL(file);
          urls.current.push(previewUrl);
          next.push({ file, previewUrl, originalName: source.name });
        } catch (caught) {
          failures.push(`${source.name}: ${caught instanceof Error ? caught.message : "could not be prepared"}`);
        }
      }
      const combined = [...prepared, ...next];
      setPrepared(combined);
      onChange(combined.map((entry) => entry.file));
      if (failures.length > 0) setError(`${failures.join(" ")} Reselect a failed photo to retry it.`);
    } finally { setProcessing(false); }
  };
  const replace = (next: Prepared[]) => { setPrepared(next); onChange(next.map((entry) => entry.file)); };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= prepared.length) return;
    const next = [...prepared];
    [next[index], next[target]] = [next[target], next[index]];
    replace(next);
  };
  const remove = (index: number) => {
    URL.revokeObjectURL(prepared[index].previewUrl);
    urls.current = urls.current.filter((url) => url !== prepared[index].previewUrl);
    replace(prepared.filter((_, candidate) => candidate !== index));
  };

  return <div className="space-y-3">
    <div><Label htmlFor={id}>{label}</Label><Input id={id} type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={disabled || processing || prepared.length >= max} onChange={(event) => { void choose(event.target.files); event.target.value = ""; }} /><p className="mt-1 text-xs text-muted-foreground">Choose up to {max} photo{max === 1 ? "" : "s"}. We’ll resize them for you.</p></div>
    {processing ? <p className="text-sm" role="status"><ImagePlus className="mr-2 inline h-4 w-4" />Preparing photos…</p> : null}
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    {prepared.length > 0 ? <div className="grid gap-3 sm:grid-cols-2">
      {prepared.map((entry, index) => <div key={entry.previewUrl} className="rounded-md border p-2">
        <img src={entry.previewUrl} alt={`Prepared ${entry.originalName}`} className="aspect-[4/3] w-full rounded object-contain bg-muted" />
        <p className="mt-1 truncate text-xs">{index === 0 ? "Primary · " : ""}{entry.originalName}</p>
        <div className="mt-2 flex gap-1"><Button type="button" size="icon" variant="outline" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${entry.originalName} earlier`}><ArrowLeft /></Button><Button type="button" size="icon" variant="outline" disabled={index === prepared.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${entry.originalName} later`}><ArrowRight /></Button><Button type="button" size="icon" variant="outline" onClick={() => remove(index)} aria-label={`Remove ${entry.originalName}`}><X /></Button></div>
      </div>)}
    </div> : null}
  </div>;
}
