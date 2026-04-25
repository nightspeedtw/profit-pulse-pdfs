import { Link } from "react-router-dom";
import { useCartStore } from "@/stores/cartStore";
import { Loader2, FileText } from "lucide-react";
import type { ShopifyProduct } from "@/lib/shopify";

interface ProductCardProps {
  product: ShopifyProduct;
  variant?: "default" | "featured";
}

export const ProductCard = ({ product, variant = "default" }: ProductCardProps) => {
  const addItem = useCartStore((s) => s.addItem);
  const isLoading = useCartStore((s) => s.isLoading);
  const node = product.node;
  const selectedVariant = node.variants.edges[0]?.node;
  const img = node.images?.edges?.[0]?.node;
  const price = node.priceRange.minVariantPrice;

  const handleAdd = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedVariant) return;
    await addItem({
      product,
      variantId: selectedVariant.id,
      variantTitle: selectedVariant.title,
      price: selectedVariant.price,
      quantity: 1,
      selectedOptions: selectedVariant.selectedOptions || [],
    });
  };

  return (
    <Link
      to={`/product/${node.handle}`}
      className="group brutal-card flex flex-col overflow-hidden"
    >
      <div className="relative aspect-[4/5] bg-secondary overflow-hidden border-b-2 border-foreground">
        {img ? (
          <img
            src={img.url}
            alt={img.altText ?? node.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <FileText className="h-16 w-16" strokeWidth={1.5} />
          </div>
        )}
        {node.productType && (
          <span className="absolute top-3 left-3 sticker">{node.productType}</span>
        )}
        <span className="absolute bottom-3 right-3 bg-foreground text-background font-display text-lg px-3 py-1 border-2 border-foreground">
          {price.currencyCode} {parseFloat(price.amount).toFixed(2)}
        </span>
      </div>
      <div className="p-4 flex flex-col flex-1 gap-3">
        <h3 className="font-display text-lg uppercase leading-tight line-clamp-2">
          {node.title}
        </h3>
        <p className="text-sm text-muted-foreground line-clamp-2 flex-1">
          {node.description || "Premium printable PDF, instant download."}
        </p>
        <button
          onClick={handleAdd}
          disabled={isLoading || !selectedVariant?.availableForSale}
          className="mt-auto w-full h-11 bg-foreground text-background font-display uppercase text-sm tracking-wider border-2 border-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : !selectedVariant?.availableForSale ? (
            "Sold Out"
          ) : (
            "Add to Cart"
          )}
        </button>
      </div>
    </Link>
  );
};
