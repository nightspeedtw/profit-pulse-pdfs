import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchProductByHandle } from "@/lib/shopify";
import { useCartStore } from "@/stores/cartStore";
import { Loader2, ArrowLeft, Download, Printer, RefreshCcw, Lock, FileText } from "lucide-react";

interface ProductDetail {
  id: string;
  title: string;
  description: string;
  descriptionHtml: string;
  handle: string;
  productType?: string;
  tags?: string[];
  priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
  images: { edges: Array<{ node: { url: string; altText: string | null } }> };
  variants: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        price: { amount: string; currencyCode: string };
        availableForSale: boolean;
        selectedOptions: Array<{ name: string; value: string }>;
      };
    }>;
  };
  options: Array<{ name: string; values: string[] }>;
}

const Product = () => {
  const { handle } = useParams<{ handle: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeImg, setActiveImg] = useState(0);
  const addItem = useCartStore((s) => s.addItem);
  const isLoading = useCartStore((s) => s.isLoading);

  useEffect(() => {
    if (!handle) return;
    setLoading(true);
    fetchProductByHandle(handle)
      .then((p) => {
        setProduct(p);
        if (p) document.title = `${p.title} — Printly`;
      })
      .finally(() => setLoading(false));
  }, [handle]);

  if (loading) {
    return (
      <div className="container py-32 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container py-24 text-center">
        <h1 className="font-display text-3xl uppercase mb-4">Product not found</h1>
        <Link to="/library" className="font-mono underline">← Back to library</Link>
      </div>
    );
  }

  const variant = product.variants.edges[0]?.node;
  const images = product.images.edges;

  // Wrap product into ShopifyProduct shape needed by cart store
  const productNode = { node: { ...product } } as Parameters<typeof addItem>[0]["product"];

  const handleAdd = async () => {
    if (!variant) return;
    await addItem({
      product: productNode,
      variantId: variant.id,
      variantTitle: variant.title,
      price: variant.price,
      quantity: 1,
      selectedOptions: variant.selectedOptions,
    });
  };

  return (
    <article className="container py-10 lg:py-16">
      <Link to="/library" className="inline-flex items-center gap-2 font-mono text-sm uppercase mb-8 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to library
      </Link>

      <div className="grid lg:grid-cols-2 gap-10 lg:gap-16">
        {/* Gallery */}
        <div className="space-y-4">
          <div className="aspect-square border-2 border-foreground bg-secondary overflow-hidden shadow-brutal">
            {images[activeImg]?.node ? (
              <img
                src={images[activeImg].node.url}
                alt={images[activeImg].node.altText ?? product.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <FileText className="h-24 w-24 text-muted-foreground" strokeWidth={1.5} />
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="grid grid-cols-5 gap-3">
              {images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImg(i)}
                  className={`aspect-square border-2 overflow-hidden ${
                    i === activeImg ? "border-accent shadow-brutal-sm" : "border-foreground"
                  }`}
                >
                  <img src={img.node.url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="lg:sticky lg:top-32 lg:self-start">
          {product.productType && <span className="sticker mb-4">{product.productType}</span>}
          <h1 className="font-display text-4xl lg:text-5xl uppercase leading-[0.95] mt-4 mb-6">
            {product.title}
          </h1>

          <div className="flex items-baseline gap-3 mb-8">
            <span className="font-display text-4xl">
              {product.priceRange.minVariantPrice.currencyCode}{" "}
              {parseFloat(product.priceRange.minVariantPrice.amount).toFixed(2)}
            </span>
            <span className="font-mono text-sm text-muted-foreground uppercase">/ digital PDF</span>
          </div>

          {product.descriptionHtml ? (
            <div
              className="prose prose-sm max-w-none text-foreground/80 leading-relaxed mb-8"
              dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
            />
          ) : (
            <p className="text-foreground/80 leading-relaxed mb-8">{product.description}</p>
          )}

          <button
            onClick={handleAdd}
            disabled={isLoading || !variant?.availableForSale}
            className="w-full h-16 bg-accent text-accent-foreground font-display text-lg uppercase tracking-wider border-2 border-foreground shadow-brutal hover:shadow-brutal-lg hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : !variant?.availableForSale ? (
              "Sold Out"
            ) : (
              <>Add to Cart — Get instant download</>
            )}
          </button>

          <div className="grid grid-cols-2 gap-3 mt-6">
            {[
              { icon: Download, label: "Instant download" },
              { icon: Printer, label: "Print unlimited" },
              { icon: Lock, label: "Secure payment" },
              { icon: RefreshCcw, label: "30-day refund" },
            ].map((it) => (
              <div key={it.label} className="border-2 border-foreground p-3 flex items-center gap-2">
                <it.icon className="h-4 w-4 flex-shrink-0" strokeWidth={2.5} />
                <span className="text-xs font-display uppercase">{it.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
};

export default Product;
