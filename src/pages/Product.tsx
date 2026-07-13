import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchStorefrontById, type StorefrontEbook } from "@/lib/storefront";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Download } from "lucide-react";
import { freeDownload } from "@/lib/freeDownload";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PlatformTrustSection from "@/components/PlatformTrustSection";
import ProductRating from "@/components/product/ProductRating";
import ProductPreview from "@/components/product/ProductPreview";
import ProductReviews from "@/components/product/ProductReviews";
import TrustBadges from "@/components/product/TrustBadges";
import StickyBuyBar from "@/components/product/StickyBuyBar";
import StoryPreviewReader from "@/components/product/StoryPreviewReader";

export default function Product() {
  const { handle } = useParams();
  const [product, setProduct] = useState<StorefrontEbook | null>(null);
  const [loading, setLoading] = useState(true);
  const buyRef = useRef<HTMLDivElement>(null);

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

  const price = product.price != null ? Number(product.price) : null;
  const isFree = price === 0 || price == null;
  const priceText = isFree ? "FREE" : `$${price!.toFixed(2)}`;
  const previewImages = product.preview_images ?? [];
  const previewSpreads = product.preview_spreads ?? [];
  const totalPages = product.total_spreads ?? previewSpreads.length;
  const hasStoryPreview = previewSpreads.length >= 2;

  const hookText =
    product.hook_description ||
    product.short_hook ||
    product.shopping_card_description ||
    product.preview_blurb ||
    "";
  const fullDescription =
    product.product_description ||
    product.long_description ||
    product.shopping_card_description ||
    "Premium digital PDF, instant download.";

  const scrollToBuy = () => buyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  const handleBuy = () => freeDownload(product.id, product.title);

  return (
    <div className="container py-8 max-w-5xl pb-32 md:pb-8">
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

          <h1 className="font-display text-4xl uppercase leading-tight break-words">
            {product.title}
          </h1>

          {((product.age_group_slugs?.length ?? 0) > 0 || (product.theme_slugs?.length ?? 0) > 0) && (
            <div className="flex flex-wrap gap-2">
              {product.age_group_slugs?.map((slug) => (
                <Link
                  key={`age-${slug}`}
                  to={`/kids?age=${encodeURIComponent(slug)}`}
                  className="inline-block px-3 py-1 border-2 border-foreground bg-highlight text-xs font-mono uppercase tracking-wide hover:shadow-brutal transition-all"
                >
                  Age {slug}
                </Link>
              ))}
              {product.theme_slugs?.map((slug) => (
                <Link
                  key={`theme-${slug}`}
                  to={`/kids?themes=${encodeURIComponent(slug)}`}
                  className="inline-block px-3 py-1 border-2 border-foreground bg-accent text-accent-foreground text-xs font-mono uppercase tracking-wide hover:shadow-brutal transition-all"
                >
                  #{slug}
                </Link>
              ))}
            </div>
          )}

          <ProductRating ebookId={product.id} />

          <div className="inline-block border-2 border-foreground bg-background px-4 py-2">
            <p className="font-display text-3xl md:text-4xl font-black text-foreground tracking-tight">
              {priceText}
            </p>
          </div>

          {hookText && (
            <p className="text-base md:text-lg leading-relaxed font-serif border-l-4 border-accent-foreground pl-4">
              {hookText}
            </p>
          )}

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
          <div ref={buyRef} className="flex gap-3 pt-2">
            <Button onClick={handleBuy} className="h-14 flex-1 gap-2">
              <Download className="h-5 w-5" />
              {price && price > 0 ? `Buy · $${price.toFixed(2)}` : "Download PDF"}
            </Button>
          </div>

          <TrustBadges />
        </div>
      </div>

      <div className="mt-12 space-y-12">
        {hasStoryPreview ? (
          <StoryPreviewReader
            spreads={previewSpreads}
            totalPages={totalPages}
            previewPageCount={product.preview_page_count ?? 3}
            cliffhangerHook={product.cliffhanger_hook ?? null}
            priceLabel={priceText}
            onBuy={handleBuy}
          />
        ) : (
          <ProductPreview images={previewImages} onBuyClick={scrollToBuy} />
        )}

        <section className="space-y-4">
          <h2 className="font-display text-2xl uppercase">More details</h2>
          <Tabs defaultValue="description">
            <TabsList>
              <TabsTrigger value="description">Description</TabsTrigger>
              {product.who_it_is_for && <TabsTrigger value="audience">Who it's for</TabsTrigger>}
              {product.what_you_get && product.what_you_get.length > 0 && (
                <TabsTrigger value="contents">What's inside</TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="description">
              <div className="prose prose-sm max-w-none whitespace-pre-wrap pt-4">
                {fullDescription}
              </div>
            </TabsContent>
            {product.who_it_is_for && (
              <TabsContent value="audience">
                <div className="prose prose-sm max-w-none whitespace-pre-wrap pt-4">
                  {product.who_it_is_for}
                </div>
              </TabsContent>
            )}
            {product.what_you_get && product.what_you_get.length > 0 && (
              <TabsContent value="contents">
                <ul className="space-y-2 pt-4">
                  {product.what_you_get.map((x, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="mt-1 h-2 w-2 rounded-full bg-accent-foreground flex-shrink-0" />
                      <span>{x}</span>
                    </li>
                  ))}
                </ul>
              </TabsContent>
            )}
          </Tabs>
        </section>

        <ProductReviews ebookId={product.id} />
        <PlatformTrustSection />
      </div>

      <StickyBuyBar
        title={product.title}
        price={price}
        watchRef={buyRef}
        onBuy={handleBuy}
      />
    </div>
  );
}

