import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchStorefrontById, type StorefrontEbook } from "@/lib/storefront";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Download } from "lucide-react";
import { freeDownload } from "@/lib/freeDownload";

export default function Product() {
  const { handle } = useParams();
  const [product, setProduct] = useState<StorefrontEbook | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="container py-8 max-w-5xl">
      <Link to="/library" className="inline-flex items-center gap-2 text-sm font-mono uppercase mb-6 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Library
      </Link>
      <div className="grid md:grid-cols-2 gap-8">
        <div className="aspect-[3/4] bg-secondary border-2 border-foreground overflow-hidden">
          {(product.store_thumbnail_url || product.cover_url) ? (
            <img src={product.store_thumbnail_url || product.cover_url!} alt={product.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">No cover</div>
          )}
        </div>
        <div className="space-y-5">
          {product.product_type && (
            <span className="sticker inline-block">{product.product_type}</span>
          )}
          {product.selling_hook && (
            <p className="text-xs font-mono uppercase tracking-widest text-accent-foreground font-bold">
              {product.selling_hook}
            </p>
          )}

          <h1 className="font-display text-4xl uppercase leading-tight">{product.title}</h1>
          {(() => {
            const price = product.price != null ? Number(product.price) : null;
            const isFree = price === 0 || price == null;
            return (
              <p className="font-display text-3xl text-accent-foreground">
                {isFree ? "FREE" : `$${price!.toFixed(2)}`}
              </p>
            );
          })()}
          <div className="prose prose-sm max-w-none whitespace-pre-wrap">
            {product.product_description ||
              product.shopping_card_description ||
              product.short_hook ||
              "Premium digital PDF, instant download."}
          </div>
          {product.benefit_bullets && product.benefit_bullets.length > 0 && (
            <ul className="space-y-2 pt-2">
              {product.benefit_bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 h-2 w-2 rounded-full bg-accent-foreground flex-shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-3 pt-2">
            <Button onClick={() => freeDownload(product.id, product.title)} className="h-14 flex-1 gap-2">
              <Download className="h-5 w-5" />
              {product.price && Number(product.price) > 0 ? `Buy · $${Number(product.price).toFixed(2)}` : "Download PDF"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

