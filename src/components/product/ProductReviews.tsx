import { useEffect, useState } from "react";
import { Star, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  ebookId: string;
}

interface Review {
  id: string;
  reviewer_name: string;
  rating: number;
  comment: string | null;
  verified_purchase: boolean;
  created_at: string;
}

const INITIAL_LIMIT = 3;

/**
 * Lists real customer reviews for a book.
 * Never shows placeholder / fake data — returns null when the table is empty.
 */
export default function ProductReviews({ ebookId }: Props) {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data, count }] = await Promise.all([
        supabase
          .from("product_reviews" as never)
          .select("*", { count: "exact" })
          .eq("ebook_id", ebookId)
          .order("created_at", { ascending: false })
          .limit(expanded ? 100 : INITIAL_LIMIT),
      ]);
      if (cancelled) return;
      setReviews((data ?? []) as unknown as Review[]);
      setTotalCount(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [ebookId, expanded]);

  if (!reviews || reviews.length === 0) return null;

  return (
    <section id="reviews" className="space-y-4 scroll-mt-24">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-display text-2xl uppercase">Customer Reviews</h2>
        <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          {totalCount} verified reader{totalCount === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="grid gap-3 md:grid-cols-3">
        {reviews.map((r) => (
          <li key={r.id} className="border-2 border-foreground bg-background p-4 space-y-2">
            <div className="flex items-center gap-1" aria-label={`${r.rating} stars`}>
              {[1, 2, 3, 4, 5].map((i) => (
                <Star
                  key={i}
                  className={`h-4 w-4 ${i <= r.rating ? "fill-foreground text-foreground" : "text-foreground/25"}`}
                  strokeWidth={1.5}
                />
              ))}
            </div>
            {r.comment && (
              <p className="text-sm leading-snug">{r.comment}</p>
            )}
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wide text-muted-foreground pt-1 border-t border-dashed border-foreground/20">
              <span className="font-bold text-foreground">{initials(r.reviewer_name)}</span>
              {r.verified_purchase && (
                <span className="inline-flex items-center gap-1 text-[10px]">
                  <ShieldCheck className="h-3 w-3" /> Verified
                </span>
              )}
              <span className="ml-auto">{formatDate(r.created_at)}</span>
            </div>
          </li>
        ))}
      </ul>
      {!expanded && totalCount > INITIAL_LIMIT && (
        <div className="pt-2">
          <Button variant="outline" onClick={() => setExpanded(true)}>
            See all {totalCount} reviews
          </Button>
        </div>
      )}
    </section>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "Reader";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join(".") + ".";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
