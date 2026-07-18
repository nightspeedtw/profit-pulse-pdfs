import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

type P = {
  id: string; title: string; thumbnail_url: string | null; cover_url: string | null;
  price_cents: number | null;
};

/**
 * Etsy-style "Recently viewed & more" strip. Random rotation per pageview
 * (schema supports retargeting later — currently random).
 */
export function ProductStrip({ title = "Recently viewed & more" }: { title?: string }) {
  const [items, setItems] = useState<P[]>([]);

  useEffect(() => {
    supabase.from("ebooks_kids")
      .select("id,title,thumbnail_url,cover_url,price_cents")
      .eq("listing_status", "live").eq("sellable", true).limit(30)
      .then(({ data }) => {
        const shuffled = [...((data ?? []) as unknown as P[])].sort(() => Math.random() - 0.5).slice(0, 8);
        setItems(shuffled);
      });
  }, []);

  if (!items.length) return null;

  return (
    <section aria-label={title}>
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-display text-2xl">{title}</h3>
        <Link to="/kids" className="text-sm text-primary hover:underline">Shop all →</Link>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 snap-x snap-mandatory">
        {items.map((p) => {
          const price = (p.price_cents ?? 499) / 100;
          const original = price * 1.5;
          return (
            <Link key={p.id} to={`/kids/coloring/${p.id}`} className="group flex-none w-[180px] snap-start">
              <div className="aspect-square rounded-xl overflow-hidden bg-white border border-border mb-2">
                <img src={p.thumbnail_url ?? p.cover_url ?? ""} alt={p.title}
                  className="w-full h-full object-contain group-hover:scale-105 transition-transform" />
              </div>
              <p className="text-sm font-medium leading-tight line-clamp-2 mb-1">{p.title}</p>
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold text-primary">${price.toFixed(2)}</span>
                <span className="text-xs text-foreground/50 line-through">${original.toFixed(2)}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
