import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchStorefrontById, type StorefrontEbook } from "@/lib/storefront";
import { useCartStore } from "@/stores/cartStore";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ShoppingCart, Loader2, Download } from "lucide-react";

export default function Product() {
  const { handle } = useParams();
  const [product, setProduct] = useState<StorefrontEbook | null>(null);
  const [loading, setLoading] = useState(true);
  const addItem = useCartStore((s) => s.addItem);

  useEffect(() => {
    if (!handle) return;
    setLoading(true);
    fetchStorefrontById(handle)
      .then(setProduct)
      .finally(() => setLoading(false));
  }, [handle]);

  if (loading) {
    return (
      <div className="container py-24 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!product) {
    return (
      <div className="container py-24 text-center">
        <h1 className="font-display text-3xl uppercase mb-4">Product not found</h1>
        <Link to="/library" className="underline">Back to library</Link>
      </div>
    );
  }

  const price = product.price != null ? `$${Number(product.price).toFixed(2)}` : "—";

  return (
    <div className="container py-8 max-w-5xl">
      <Link to="/library" className="inline-flex items-center gap-2 text-sm font-mono uppercase mb-6 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Library
      </Link>
      <div className="grid md:grid-cols-2 gap-8">
        <div className="aspect-[4/5] bg-secondary border-2 border-foreground overflow-hidden">
          {product.cover_url ? (
            <img src={product.cover_url} alt={product.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">No cover</div>
          )}
        </div>
        <div className="space-y-6">
          {product.product_category && (
            <span className="sticker inline-block">{product.product_category}</span>
          )}
          <h1 className="font-display text-4xl uppercase leading-tight">{product.title}</h1>
          <p className="font-display text-3xl">{price}</p>
          <div className="prose prose-sm max-w-none whitespace-pre-wrap">
            {product.product_description || "Premium digital PDF, instant download after purchase."}
          </div>
          <div className="flex gap-3">
            <Button onClick={() => addItem(product)} disabled={!product.price} className="h-14 flex-1 gap-2">
              <ShoppingCart className="h-5 w-5" /> Add to Cart
            </Button>
          </div>
          <ul className="text-xs text-muted-foreground space-y-1 pt-4 border-t-2 border-foreground/20">
            <li className="flex items-center gap-2"><Download className="h-3 w-3" /> Instant PDF delivery</li>
            <li>7-day download window · up to 5 downloads per purchase</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
