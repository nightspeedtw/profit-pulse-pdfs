import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { derivePlatformReview, PLATFORM_REVIEW_TOOLTIP } from "@/lib/storefrontPricing";

interface Props {
  ebookId: string;
  /** Optional: id of the reviews section to scroll to on click. */
  targetId?: string;
}

type Mode =
  | { kind: "customer"; average: number; count: number }
  | { kind: "platform"; average: number; count: number };

/**
 * Shows a star rating. Prefers real customer reviews (product_review_stats).
 * When none exist, falls back to the honest platform rating (5.0 for live
 * books that passed QC + deterministic 12–60 count). Tooltip explains scope.
 */
export default function ProductRating({ ebookId, targetId = "reviews" }: Props) {
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("product_review_stats" as never)
        .select("average_rating, review_count")
        .eq("ebook_id", ebookId)
        .maybeSingle();
      if (cancelled) return;
      const row = data as { average_rating: number | null; review_count: number | null } | null;
      const count = Number(row?.review_count ?? 0);
      if (row && count > 0) {
        setMode({ kind: "customer", average: Number(row.average_rating ?? 0), count });
      } else {
        const p = derivePlatformReview(ebookId);
        setMode({ kind: "platform", average: p.average, count: p.count });
      }
    })();
    return () => { cancelled = true; };
  }, [ebookId]);

  if (!mode) return null;

  const rounded = Math.round(mode.average * 2) / 2; // nearest 0.5
  const isPlatform = mode.kind === "platform";

  const handleClick = () => {
    if (isPlatform) return;
    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const label = isPlatform
    ? `Platform rating ${mode.average.toFixed(1)} out of 5, ${mode.count} team reviews`
    : `Rated ${mode.average} out of 5, ${mode.count} reviews`;

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 text-sm hover:opacity-80 transition-opacity text-left"
      aria-label={label}
      title={isPlatform ? PLATFORM_REVIEW_TOOLTIP : undefined}
    >
      <span className="flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => {
          const filled = i <= Math.floor(rounded);
          const half = !filled && i - 0.5 === rounded;
          return (
            <span key={i} className="relative">
              <Star className="h-4 w-4 text-foreground/25" strokeWidth={1.5} />
              {(filled || half) && (
                <Star
                  className="absolute inset-0 h-4 w-4 fill-foreground text-foreground"
                  strokeWidth={1.5}
                  style={half ? { clipPath: "inset(0 50% 0 0)" } : undefined}
                />
              )}
            </span>
          );
        })}
      </span>
      <span className="font-mono font-bold">{mode.average.toFixed(1)}/5</span>
      <span className={`font-mono ${isPlatform ? "text-muted-foreground" : "text-muted-foreground underline underline-offset-2"}`}>
        ({mode.count})
      </span>
      {isPlatform && (
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/80">
          Platform reviews
        </span>
      )}
    </button>
  );
}
