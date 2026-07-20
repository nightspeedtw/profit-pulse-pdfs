// Real-data social-proof badges — NEVER fabricated.
// Reads coloring_book_events and shows a badge only when a minimum
// real-event threshold is met. Falls back to nothing.
//
// Thresholds (owner directive Wave 1):
//   • carts_24h  >= 3  → "In N+ carts"
//   • buys_24h   >= 1  → "N bought in last 24h"
//   • buys_7d    >= 25 → "Bestseller"
import { useEffect, useState } from "react";
import { Flame, ShoppingBag, Award } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props { ebookId: string; }
interface Counts { carts24: number; buys24: number; buys7d: number; }

export default function SocialProofBadges({ ebookId }: Props) {
  const [c, setC] = useState<Counts | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const now = Date.now();
      const day = new Date(now - 24 * 3600 * 1000).toISOString();
      const week = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
      const [carts, buys24r, buys7dr] = await Promise.all([
        supabase.from("coloring_book_events" as never)
          .select("id", { count: "exact", head: true })
          .eq("ebook_kids_id", ebookId).eq("event_type", "add_to_cart").gte("created_at", day),
        supabase.from("coloring_book_events" as never)
          .select("id", { count: "exact", head: true })
          .eq("ebook_kids_id", ebookId).eq("event_type", "click_buy").gte("created_at", day),
        supabase.from("coloring_book_events" as never)
          .select("id", { count: "exact", head: true })
          .eq("ebook_kids_id", ebookId).eq("event_type", "click_buy").gte("created_at", week),
      ]);
      if (cancelled) return;
      setC({
        carts24: Number(carts.count ?? 0),
        buys24: Number(buys24r.count ?? 0),
        buys7d: Number(buys7dr.count ?? 0),
      });
    })();
    return () => { cancelled = true; };
  }, [ebookId]);

  if (!c) return null;
  const badges: { key: string; text: string; icon: JSX.Element; tone: string }[] = [];
  if (c.buys24 >= 1) {
    badges.push({
      key: "demand",
      text: `In demand — ${c.buys24} bought in last 24h`,
      icon: <Flame className="h-3.5 w-3.5" />,
      tone: "bg-accent text-accent-foreground border-foreground",
    });
  }
  if (c.carts24 >= 3) {
    badges.push({
      key: "carts",
      text: `In ${c.carts24}+ carts`,
      icon: <ShoppingBag className="h-3.5 w-3.5" />,
      tone: "bg-background text-foreground border-foreground",
    });
  }
  if (c.buys7d >= 25) {
    badges.push({
      key: "bestseller",
      text: "Bestseller",
      icon: <Award className="h-3.5 w-3.5" />,
      tone: "bg-highlight text-foreground border-foreground",
    });
  }
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((b) => (
        <span
          key={b.key}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 border-2 rounded-full text-[11px] font-mono uppercase tracking-widest ${b.tone}`}
        >
          {b.icon}
          {b.text}
        </span>
      ))}
    </div>
  );
}
