import { Link } from "react-router-dom";
import { FileText, Download, ArrowRight, Check, Star } from "lucide-react";
import type { StorefrontEbook } from "@/lib/storefront";
import { freeDownload } from "@/lib/freeDownload";

interface Props {
  product: StorefrontEbook;
}

const CATEGORY_LABEL: Record<string, string> = {
  finance: "Finance",
  "personal-finance": "Finance",
  children_illustrated: "Kids",
  business_career: "Business",
  "business-templates": "Business",
  "secret-ai": "AI Systems",
  "secret-productivity": "Productivity",
  wellness_selfhelp: "Wellness",
  "health-wellness": "Wellness",
  "wellness-mind": "Wellness",
  education_workbook: "Workbook",
  "study-exam": "Study",
  parenting_family: "Parenting",
  "parenting-kids": "Parenting",
  creative_hobby: "Creative",
  "art-creative": "Creative",
  "fitness-meal-plans": "Fitness",
  "cooking-recipes": "Cooking",
  "lifestyle-planners": "Lifestyle",
  beginner_guide: "Starter",
  fiction_short: "Story",
};

const fallbackTeaser = (title: string): string => {
  const clean = (title || "").replace(/^The\s+/i, "");
  return `A step-by-step system to master ${clean.toLowerCase()} — with frameworks and worksheets you can actually use.`;
};

export const ProductCard = ({ product }: Props) => {
  const price = product.price != null ? Number(product.price) : null;
  const isFree = price === 0 || price == null;

  const handleCta = (e: React.MouseEvent) => {
    if (!isFree) return;
    e.preventDefault();
    e.stopPropagation();
    freeDownload(product.id, product.title);
  };

  const categorySlug = product.category_slug ?? product.product_type ?? "";
  const categoryLabel = CATEGORY_LABEL[categorySlug] || categorySlug?.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || null;

  // Prefer realistic 3D book mockup; fall back to baked store thumbnail; then flat cover.
  const image =
    product.thumbnail_url ||
    product.store_thumbnail_url ||
    product.cover_url;
  const isMockup = !!product.thumbnail_url;
  const isBakedThumb = !isMockup && !!product.store_thumbnail_url;

  const hook = product.short_hook || product.selling_hook;
  const teaser =
    product.shopping_card_description ||
    hook ||
    fallbackTeaser(product.title);
  const bullets = (product.benefit_bullets ?? product.key_benefits ?? []).slice(0, 2);

  return (
    <Link
      to={`/product/${product.id}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border-2 border-foreground bg-card shadow-[4px_4px_0_0_hsl(var(--foreground))] hover:shadow-[6px_6px_0_0_hsl(var(--foreground))] hover:-translate-y-0.5 transition-all duration-200"
    >
      {/* Image stage: neutral premium bookstore backdrop */}
      <div className="relative aspect-[4/5] overflow-hidden border-b-2 border-foreground bg-gradient-to-br from-muted/60 via-background to-muted/30">
        {image ? (
          <div className="absolute inset-0 flex items-center justify-center p-5">
            <img
              src={image}
              alt={product.title}
              className={`max-h-full max-w-full ${isBakedThumb ? "w-full h-full object-cover rounded-md" : "object-contain drop-shadow-[0_18px_24px_rgba(0,0,0,0.28)]"} group-hover:scale-[1.04] transition-transform duration-500 ease-out`}
              loading="lazy"
            />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <FileText className="h-16 w-16" strokeWidth={1.5} />
          </div>
        )}

        {categoryLabel && (
          <span className="absolute top-3 left-3 z-20 text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 bg-background/90 backdrop-blur border-2 border-foreground rounded-full">
            {categoryLabel}
          </span>
        )}

        <span
          className={`absolute top-3 right-3 z-20 font-display text-base px-3 py-1 rounded-full border-2 border-foreground shadow-[2px_2px_0_0_hsl(var(--foreground))] ${
            isFree ? "bg-accent text-accent-foreground" : "bg-background text-foreground"
          }`}
        >
          {isFree ? "FREE" : `$${price!.toFixed(2)}`}
        </span>
      </div>

      {/* Content */}
      <div className="p-5 flex flex-col flex-1 gap-3">
        {hook && (
          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary font-bold line-clamp-1">
            {hook}
          </p>
        )}
        <h3 className="font-display text-xl leading-snug line-clamp-2 tracking-tight">
          {product.title}
        </h3>
        <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
          {teaser}
        </p>

        {bullets.length > 0 && (
          <ul className="space-y-1.5 pt-1">
            {bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                <Check className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-primary" strokeWidth={3} />
                <span className="line-clamp-1">{b}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto pt-3 flex items-center gap-2">
          <button
            onClick={handleCta}
            className="flex-1 h-11 bg-foreground text-background font-display uppercase text-sm tracking-wider rounded-lg border-2 border-foreground hover:bg-primary hover:text-primary-foreground transition-colors flex items-center justify-center gap-2 group/btn"
          >
            {isFree ? (
              <>
                <Download className="h-4 w-4" /> Download Free
              </>
            ) : (
              <>
                Get Instant Access
                <ArrowRight className="h-4 w-4 group-hover/btn:translate-x-0.5 transition-transform" />
              </>
            )}
          </button>
        </div>

        {product.sales_count > 0 && (
          <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            <Star className="h-3 w-3 fill-current text-amber-500" strokeWidth={0} />
            {product.sales_count.toLocaleString()} readers
          </div>
        )}
      </div>
    </Link>
  );
};
