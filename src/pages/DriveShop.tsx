import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Link, useSearchParams } from "react-router-dom";
import { formatUsd, kidsCheckoutPath } from "@/lib/kidsCheckout";

type Product = {
  id: string;
  slug: string;
  title: string;
  category: "coloring" | "storybook";
  price_cents: number;
  cover_url: string | null;
  drive_file_id: string;
};

export default function DriveShop() {
  const [products, setProducts] = useState<Product[]>([]);
  const [kidsIds, setKidsIds] = useState<Record<string, string>>({});
  const [params, setParams] = useSearchParams();
  const cat = params.get("cat");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Never select pdf_url here: the file is delivered only after payment.
      let q = supabase
        .from("drive_products")
        .select("id,slug,title,category,price_cents,cover_url,drive_file_id")
        .eq("status", "live")
        .order("created_at", { ascending: false });
      if (cat === "coloring" || cat === "storybook") q = q.eq("category", cat);
      const { data } = await q;
      const list = (data as Product[]) || [];
      if (cancelled) return;
      setProducts(list);
      // Each Drive product is mirrored into ebooks_kids; that row is what the
      // Paddle checkout sells and what the buyer's library is keyed on.
      const fileIds = list.map((p) => p.drive_file_id).filter(Boolean);
      if (fileIds.length === 0) { setKidsIds({}); return; }
      const { data: kids } = await supabase
        .from("ebooks_kids")
        .select("id,drive_file_id")
        .in("drive_file_id", fileIds);
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const k of (kids as { id: string; drive_file_id: string | null }[] | null) ?? []) {
        if (k.drive_file_id) map[k.drive_file_id] = k.id;
      }
      setKidsIds(map);
    })();
    return () => { cancelled = true; };
  }, [cat]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl uppercase mb-2">Shop</h1>
      <p className="text-muted-foreground mb-6">Coloring books and storybooks — instant PDF download.</p>

      <div className="flex gap-2 mb-6">
        {[
          { k: null, label: "All" },
          { k: "coloring", label: "Coloring" },
          { k: "storybook", label: "Storybooks" },
        ].map((f) => (
          <button
            key={f.k ?? "all"}
            onClick={() => (f.k ? setParams({ cat: f.k }) : setParams({}))}
            className={`px-4 py-2 rounded-full border-2 text-sm font-medium ${
              (cat ?? null) === f.k ? "bg-foreground text-background" : "border-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {products.length === 0 ? (
        <p className="text-muted-foreground py-16 text-center">No products yet — check back soon.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {products.map((p) => (
            <div key={p.id} className="border-2 border-foreground bg-card overflow-hidden flex flex-col">
              <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                {p.cover_url ? (
                  <img src={p.cover_url} alt={p.title} className="w-full h-full object-cover" />
                ) : (
                  <span className="font-display text-4xl text-muted-foreground">PDF</span>
                )}
              </div>
              <div className="p-3 flex-1 flex flex-col gap-2">
                <div className="text-xs font-mono uppercase text-muted-foreground">{p.category}</div>
                <h3 className="font-bold leading-tight line-clamp-2">{p.title}</h3>
                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="font-display text-lg tabular-nums">{formatUsd(p.price_cents)}</span>
                  {kidsIds[p.drive_file_id] ? (
                    <Button size="sm" asChild className="min-h-11 px-5">
                      <Link to={kidsCheckoutPath(kidsIds[p.drive_file_id])}>Buy</Link>
                    </Button>
                  ) : (
                    <Button size="sm" disabled className="min-h-11 px-5">Coming soon</Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
