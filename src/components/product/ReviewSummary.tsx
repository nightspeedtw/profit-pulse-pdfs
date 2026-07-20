// Review summary chips + sub-scores.
// Renders ONLY when real reviews exist (>= 1). Extracts frequent
// meaningful words from review text as Etsy-style "What buyers say" chips.
// Seed state ("Be the first to review") is rendered by ProductRating.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MessageSquareQuote } from "lucide-react";

interface Review {
  rating: number;
  body: string | null;
  meta: Record<string, unknown> | null;
}

const STOP = new Set([
  "the", "and", "for", "that", "this", "with", "have", "was", "but", "not",
  "you", "are", "all", "very", "just", "from", "our", "your", "book", "one",
  "get", "got", "will", "can", "has", "had", "would", "could", "them", "they",
  "were", "been", "some", "much", "more", "most", "than", "into", "when",
  "what", "how", "why", "who", "her", "him", "his", "she", "his", "its",
]);

function extractChips(reviews: Review[]): { text: string; count: number }[] {
  const freq = new Map<string, number>();
  for (const r of reviews) {
    const s = String(r.body ?? "").toLowerCase();
    const words = s.match(/[a-z]{4,14}/g) ?? [];
    for (const w of words) {
      if (STOP.has(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  return [...freq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([text, count]) => ({ text, count }));
}

interface Props { ebookId: string; }

export default function ReviewSummary({ ebookId }: Props) {
  const [reviews, setReviews] = useState<Review[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("product_reviews" as never)
        .select("rating, body, meta")
        .eq("ebook_id", ebookId)
        .limit(200);
      if (cancelled) return;
      setReviews(((data as unknown) as Review[]) ?? []);
    })();
    return () => { cancelled = true; };
  }, [ebookId]);

  const chips = useMemo(() => (reviews ? extractChips(reviews) : []), [reviews]);
  const subScores = useMemo(() => {
    if (!reviews || reviews.length === 0) return null;
    let quality = 0, delivery = 0, recommendCount = 0, quality_n = 0, delivery_n = 0;
    for (const r of reviews) {
      const m = (r.meta ?? {}) as Record<string, unknown>;
      if (typeof m.item_quality === "number") { quality += m.item_quality; quality_n++; }
      if (typeof m.download_experience === "number") { delivery += m.download_experience; delivery_n++; }
      if (m.recommend === true) recommendCount++;
    }
    return {
      quality: quality_n ? quality / quality_n : null,
      delivery: delivery_n ? delivery / delivery_n : null,
      recommendPct: Math.round((recommendCount / reviews.length) * 100),
      total: reviews.length,
    };
  }, [reviews]);

  if (!reviews || reviews.length === 0) return null;

  return (
    <section className="container max-w-5xl py-8 border-t-2 border-border">
      <h2 className="font-display text-2xl uppercase mb-4 flex items-center gap-2">
        <MessageSquareQuote className="h-5 w-5" /> What buyers say
      </h2>
      {chips.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
            Summarized by AI · from {reviews.length} review{reviews.length === 1 ? "" : "s"}
          </p>
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <span
                key={c.text}
                className="inline-flex items-center gap-1 px-3 py-1 border-2 border-foreground bg-background rounded-full text-sm capitalize"
              >
                {c.text}
                <span className="text-[10px] font-mono text-muted-foreground">·{c.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {subScores && (
        <div className="grid grid-cols-3 gap-3 text-center">
          {subScores.quality !== null && (
            <div className="border-2 border-border p-3 rounded">
              <div className="font-display text-2xl">{subScores.quality.toFixed(1)}</div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Item quality</div>
            </div>
          )}
          {subScores.delivery !== null && (
            <div className="border-2 border-border p-3 rounded">
              <div className="font-display text-2xl">{subScores.delivery.toFixed(1)}</div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Download experience</div>
            </div>
          )}
          <div className="border-2 border-border p-3 rounded">
            <div className="font-display text-2xl">{subScores.recommendPct}%</div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Recommend</div>
          </div>
        </div>
      )}
    </section>
  );
}
