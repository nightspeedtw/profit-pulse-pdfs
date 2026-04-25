import { useEffect, useState } from "react";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { ProductCard } from "./ProductCard";
import { FileText, Loader2 } from "lucide-react";

interface ProductGridProps {
  query?: string;
  limit?: number;
  emptyTitle?: string;
  emptyMessage?: string;
}

export const ProductGrid = ({
  query,
  limit = 12,
  emptyTitle = "No products yet",
  emptyMessage = "New printables drop every week. Check back soon.",
}: ProductGridProps) => {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProducts(limit, query)
      .then((data) => !cancelled && setProducts(data))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, limit]);

  if (loading) {
    return (
      <div className="py-24 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 border-2 border-destructive bg-destructive/10 p-6 text-center font-mono text-sm">
        Could not load products: {error}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="py-16 border-2 border-dashed border-foreground text-center px-6">
        <div className="mx-auto mb-4 h-16 w-16 border-2 border-foreground flex items-center justify-center">
          <FileText className="h-8 w-8" />
        </div>
        <h3 className="font-display text-2xl uppercase mb-2">{emptyTitle}</h3>
        <p className="text-muted-foreground max-w-md mx-auto">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {products.map((p) => (
        <ProductCard key={p.node.id} product={p} />
      ))}
    </div>
  );
};
