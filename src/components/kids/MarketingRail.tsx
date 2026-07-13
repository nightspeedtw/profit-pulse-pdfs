import { useEffect, useState } from "react";
import { fetchStorefront, type StorefrontEbook } from "@/lib/storefront";
import { ProductCard } from "@/components/ProductCard";
import { Loader2 } from "lucide-react";

interface Props {
  title: string;
  eyebrow?: string;
  query: {
    category_slug?: string;
    bestseller?: boolean;
    sort?: "new" | "sales";
    limit?: number;
  };
}

export const MarketingRail = ({ title, eyebrow, query }: Props) => {
  const [items, setItems] = useState<StorefrontEbook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchStorefront({
      limit: query.limit ?? 8,
      // storefront lib doesn't type these yet — passthrough via any
      ...(query as any),
    } as any)
      .then((data) => !cancelled && setItems(data))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query)]);

  if (loading) {
    return (
      <div className="py-8 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <section className="space-y-4">
      <div>
        {eyebrow && (
          <p className="font-mono uppercase tracking-widest text-xs mb-2">[ {eyebrow} ]</p>
        )}
        <h2 className="font-display text-2xl md:text-3xl uppercase">{title}</h2>
      </div>
      <div className="flex gap-5 overflow-x-auto pb-3 -mx-4 px-4 snap-x snap-mandatory">
        {items.map((p) => (
          <div key={p.id} className="w-64 shrink-0 snap-start">
            <ProductCard product={p} />
          </div>
        ))}
      </div>
    </section>
  );
};
