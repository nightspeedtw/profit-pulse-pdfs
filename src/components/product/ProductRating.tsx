import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EditorialQualityBadge } from "@/components/product/EditorialQualityBadge";

interface Props {
  ebookId: string;
  /** Optional: id of the reviews section to scroll to on click. */
  targetId?: string;
}

type Mode =
  | { kind: "customer"; average: number; count: number }
  | { kind: "none" };

/**
 * Shows a star rating ONLY when real customer reviews exist. Otherwise
 * renders the honest Editorial Quality badge — never a fabricated rating
 * or fake review count (Marketing Autopilot Phase 0 honest-reviews law).
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
        setMode({ kind: "none" });
      }
    })();
    return () => { cancelled = true; };
  }, [ebookId]);

  if (!mode) return null;
  if (mode.kind === "none") return <EditorialQualityBadge />;

  const rounded = Math.round(mode.average * 2) / 2;
  const label = `Rated ${mode.average} out of 5, ${mode.count} reviews`;
  const handleClick = () => {
    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 text-sm hover:opacity-80 transition-opacity text-left"
      aria-label={label}
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
      <span className="font-mono text-muted-foreground underline underline-offset-2">
        ({mode.count})
      </span>
    </button>
  );
}
