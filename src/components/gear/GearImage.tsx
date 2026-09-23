import { useEffect, useState } from "react";
import { ImageOff, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSignedImageUrl } from "@/lib/gearShareApi";

export function GearImage({
  imagePath,
  title,
  className,
  variant = "card",
}: {
  imagePath?: string;
  title: string;
  className?: string;
  variant?: "compact" | "card" | "detail" | "editor";
}) {
  const [source, setSource] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setSource(undefined);
    setFailed(false);
    if (imagePath) getSignedImageUrl(imagePath).then((url) => {
      objectUrl = url;
      if (active) setSource(url); else URL.revokeObjectURL(url);
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imagePath]);

  return (
    <div className={cn(
      "relative overflow-hidden rounded-md bg-muted grid place-items-center",
      variant === "compact" && "aspect-[4/3]",
      variant === "card" && "aspect-[16/9]",
      variant === "detail" && "h-56 sm:h-64 lg:h-72",
      variant === "editor" && "aspect-[16/10]",
      className,
    )}>
      {source ? (
        <img src={source} alt={title} className="absolute inset-0 h-full w-full object-contain" />
      ) : failed ? (
        <div className="text-center text-xs text-destructive px-3">
          <ImageOff className="h-7 w-7 mx-auto mb-1" />
          Photo unavailable
        </div>
      ) : (
        <div className="text-center text-xs text-muted-foreground">
          <Package className="h-8 w-8 mx-auto mb-1" />
          {imagePath ? "Loading photo…" : "No photo"}
        </div>
      )}
    </div>
  );
}
