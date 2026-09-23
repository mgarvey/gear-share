import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GearImage } from "@/components/gear/GearImage";
import { Button } from "@/components/ui/button";

export function GearGallery({ imagePaths, title }: { imagePaths: string[]; title: string }) {
  const paths = imagePaths.slice(0, 4);
  const [active, setActive] = useState(0);
  const touchStart = useRef<number>();
  useEffect(() => { setActive((current) => Math.min(current, Math.max(0, paths.length - 1))); }, [paths.length]);
  const move = (direction: -1 | 1) => setActive((current) => (current + direction + paths.length) % paths.length);

  return <div
    className="space-y-3"
    tabIndex={paths.length > 1 ? 0 : undefined}
    aria-label={`${title} photo gallery`}
    onKeyDown={(event) => {
      if (paths.length < 2) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
    }}
    onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX; }}
    onTouchEnd={(event) => {
      const end = event.changedTouches[0]?.clientX;
      if (paths.length > 1 && touchStart.current !== undefined && end !== undefined && Math.abs(end - touchStart.current) > 40) move(end < touchStart.current ? 1 : -1);
      touchStart.current = undefined;
    }}
  >
    <div className="relative">
      <GearImage imagePath={paths[active]} title={paths.length > 1 ? `${title}, photo ${active + 1} of ${paths.length}` : title} variant="detail" className="rounded-none border-y" />
      {paths.length > 1 ? <>
        <Button type="button" size="icon" variant="secondary" className="absolute left-3 top-1/2 -translate-y-1/2" onClick={() => move(-1)} aria-label="Previous photo"><ChevronLeft /></Button>
        <Button type="button" size="icon" variant="secondary" className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => move(1)} aria-label="Next photo"><ChevronRight /></Button>
        <p className="absolute bottom-3 right-3 rounded-full bg-background/90 px-2 py-1 text-xs font-medium">{active + 1} of {paths.length}</p>
      </> : null}
    </div>
    {paths.length > 1 ? <div className="flex gap-2 overflow-x-auto px-4" aria-label="Choose a photo">
      {paths.map((path, index) => <button key={path} type="button" className={`w-20 shrink-0 rounded-md border-2 ${index === active ? "border-primary" : "border-transparent"}`} onClick={() => setActive(index)} aria-label={`Show photo ${index + 1}`} aria-current={index === active ? "true" : undefined}><GearImage imagePath={path} title="" variant="compact" /></button>)}
    </div> : null}
  </div>;
}
