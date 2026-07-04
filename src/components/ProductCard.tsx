import { Link } from "react-router-dom";
import { FileText, Download, Check } from "lucide-react";
import type { StorefrontEbook } from "@/lib/storefront";
import { freeDownload } from "@/lib/freeDownload";

interface Props {
  product: StorefrontEbook;
}

const CATEGORY_LABEL: Record<string, string> = {
  finance: "FINANCE",
  "personal-finance": "FINANCE",
  children_illustrated: "KIDS STORY",
  business_career: "BUSINESS",
  "secret-ai": "AI SYSTEMS",
  "secret-productivity": "PRODUCTIVITY",
  wellness_selfhelp: "WELLNESS",
  "health-wellness": "WELLNESS",
  education_workbook: "WORKBOOK",
  parenting_family: "PARENTING",
  creative_hobby: "CREATIVE",
  beginner_guide: "STARTER",
  fiction_short: "STORY",
};

const CATEGORY_ACCENT: Record<string, string> = {
  finance: "from-amber-500/25 to-transparent",
  "personal-finance": "from-amber-500/25 to-transparent",
  business_career: "from-blue-500/25 to-transparent",
  "secret-ai": "from-violet-500/25 to-transparent",
  "secret-productivity": "from-cyan-500/25 to-transparent",
  wellness_selfhelp: "from-emerald-500/25 to-transparent",
  "health-wellness": "from-emerald-500/25 to-transparent",
  children_illustrated: "from-pink-500/25 to-transparent",
};

const fallbackTeaser = (title: string): string => {
  const clean = (title || "").replace(/^The\s+/i, "");
  return `A step-by-step system to master ${clean.toLowerCase()} — with frameworks and worksheets you can actually use.`;
};

export const ProductCard = ({ product }: Props) => {
  const price = product.price != null ? Number(product.price) : null;
  const isFree = price === 0 || price == null;

  const handleCta = (e: React.MouseEvent) => {
    if (!isFree) return; // let Link navigate to product page for paid items
    e.preventDefault();
    e.stopPropagation();
    freeDownload(product.id, product.title);
  };

  const categorySlug = product.category_slug ?? product.product_type ?? "";
  const categoryLabel = CATEGORY_LABEL[categorySlug] || categorySlug?.toUpperCase() || null;
  const accent = CATEGORY_ACCENT[categorySlug] ?? "from-foreground/20 to-transparent";

  const hook = product.short_hook || product.selling_hook;
  const teaser =
    product.shopping_card_description ||
    hook ||
    fallbackTeaser(product.title);
  const bullets = (product.benefit_bullets ?? []).slice(0, 2);

  const image = product.cover_url;

  return (
    <Link to={`/product/${product.id}`} className="group brutal-card flex flex-col overflow-hidden">
      <div className="relative aspect-[3/4] bg-gradient-to-br from-neutral-900 to-neutral-800 overflow-hidden border-b-2 border-foreground">
        {image ? (
          <>
            {/* Background cover — contain so full book mockup shows without cropping */}
            <img
              src={image}
              alt={product.title}
              className="absolute inset-0 w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
              loading="lazy"
            />
            {/* Bottom gradient to guarantee readable title overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />
            {/* Category-tinted top accent */}
            <div className={`absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b ${accent} pointer-events-none`} />
            {/* Title overlay so cards are always readable even when cover art has no text */}
            <div className="absolute inset-x-0 bottom-0 p-3 z-10">
              <div className="font-display uppercase text-white text-lg leading-tight line-clamp-3 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                {product.title}
              </div>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <FileText className="h-16 w-16" strokeWidth={1.5} />
          </div>
        )}

        {categoryLabel && (
          <span className="absolute top-3 left-3 sticker z-20">{categoryLabel}</span>
        )}

        <span
          className={`absolute top-3 right-3 z-20 font-display text-lg px-3 py-1 border-2 border-foreground ${
            isFree ? "bg-accent text-accent-foreground" : "bg-white text-foreground"
          }`}
        >
          {isFree ? "FREE" : `$${price!.toFixed(2)}`}
        </span>
      </div>
      <div className="p-4 flex flex-col flex-1 gap-2">
        {hook && (
          <p className="text-[10px] font-mono uppercase tracking-widest text-accent-foreground font-bold line-clamp-1">
            {hook}
          </p>
        )}
        <h3 className="font-display text-lg uppercase leading-tight line-clamp-2">{product.title}</h3>
        <p className="text-sm text-muted-foreground line-clamp-3 flex-1">{teaser}</p>
        {bullets.length > 0 && (
          <ul className="text-xs text-muted-foreground space-y-1">
            {bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Check className="h-3 w-3 mt-0.5 flex-shrink-0 text-accent-foreground" />
                <span className="line-clamp-1">{b}</span>
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={handleCta}
          className="mt-auto w-full h-11 bg-foreground text-background font-display uppercase text-sm tracking-wider border-2 border-foreground hover:bg-accent hover:text-accent-foreground transition-colors flex items-center justify-center gap-2"
        >
          {isFree ? (
            <>
              <Download className="h-4 w-4" /> Download
            </>
          ) : (
            <>Buy · ${price!.toFixed(2)}</>
          )}
        </button>
      </div>
    </Link>
  );
};
