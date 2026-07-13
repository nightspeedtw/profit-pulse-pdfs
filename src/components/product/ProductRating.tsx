import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  ebookId: string;
  /** Optional: id of the reviews section to scroll to on click. */
  targetId?: string;
}

/**
 * Shows "★★★★☆ 4.8/5 (126 reviews)".
 * Returns null when the book has no reviews yet — never renders a fake "0.0".
 */
export default function ProductRating({ ebookId, targetId = "reviews" }: Props) {
  const [stats, setStats] = useState<{ average: number; count: number } | null>(null);

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
      if (row && Number(row.review_count ?? 0) > 0) {
        setStats({
          average: Number(row.average_rating ?? 0),
          count: Number(row.review_count ?? 0),
        });
      }
    })();
    return () => { cancelled = true; };
  }, [ebookId]);

  if (!stats) return null;

  const rounded = Math.round(stats.average * 2) / 2; // nearest 0.5

  const handleClick = () => {
    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 text-sm hover:opacity-80 transition-opacity"
      aria-label={`Rated ${stats.average} out of 5, ${stats.count} reviews`}
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
      <span className="font-mono font-bold">{stats.average.toFixed(1)}/5</span>
      <span className="font-mono text-muted-foreground underline underline-offset-2">
        ({stats.count} review{stats.count === 1 ? "" : "s"})
      </span>
    </button>
  );
}
