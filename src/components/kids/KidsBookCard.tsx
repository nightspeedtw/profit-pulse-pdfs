import { Link } from "react-router-dom";
import { Download, FileText } from "lucide-react";
import type { KidsTheme } from "@/lib/kidsTaxonomy";
import { deriveSalePricing } from "@/lib/storefrontPricing";
import { EditorialQualityBadge } from "@/components/product/EditorialQualityBadge";
import { ensureColoringLabel } from "@/lib/coloring-title";

export interface KidsBookCardData {
  id: string;
  title: string;
  cover_url: string | null;
  thumbnail_url?: string | null;
  price_cents: number;
  theme_ids: string[];
  storefront_meta: Record<string, unknown> | null;
  book_type?: string | null;
}

export interface KidsBookCardResolvedPrice {
  effectiveCents: number;
  regularCents: number;
  campaignCents: number | null;
}

interface Props {
  book: KidsBookCardData;
  themes: KidsTheme[];
  variant?: "grid" | "strip";
  index?: number;
  onPreview?: () => void;
  /** Authoritative price from `product_pricing` (marketing autopilot Phase 1). */
  resolvedPrice?: KidsBookCardResolvedPrice;
}

/**
 * Etsy-style storefront card. Owner directive (2026-07-18):
 * "ทำหน้าตาให้ได้แบบเค้าเลย... ระยะห่างจากเล่มต่อเล่มก็ทำสวยมาก
 *  ไม่มีช่องห่างเยอะ" — replicate Etsy market grid density and card
 * anatomy exactly. No borders/shadows, no on-card BUY button, the entire
 * image is the click-through link. Meta rows sit tight under the image.
 */
export const KidsBookCard = ({ book, themes, variant = "grid", index = 0, onPreview: _onPreview, resolvedPrice }: Props) => {
  void _onPreview;
  void themes;

  const isStrip = variant === "strip";
  const isColoring = book.book_type === "coloring_book";
  const productHref = isColoring ? `/kids/coloring/${book.id}` : `/product/${book.id}`;
  const image = (isColoring && book.thumbnail_url) ? book.thumbnail_url : book.cover_url;
  // Owner order 2026-07-20: coloring cards must always advertise "Coloring Book"
  // so titles like "Cyber City Countdown" don't confuse buyers.
  const displayTitle = isColoring ? ensureColoringLabel(book.title) : book.title;

  // Marketing Autopilot Phase 1: prefer the authoritative product_pricing row.
  // When a campaign is active, we render regular → sale with a % off badge
  // (จิตวิทยาการตลาด — anchor + discount + urgency). Otherwise, fall back to
  // the honest-pricing helper (which only shows a strikethrough when verified).
  const effectiveCents = resolvedPrice?.effectiveCents ?? book.price_cents;
  const hasLiveCampaign =
    !!resolvedPrice &&
    resolvedPrice.regularCents > effectiveCents &&
    resolvedPrice.campaignCents != null;
  const campaignPct = hasLiveCampaign
    ? Math.max(1, Math.round(((resolvedPrice!.regularCents - effectiveCents) / resolvedPrice!.regularCents) * 100))
    : null;
  const fallbackPricing = deriveSalePricing(book.id, effectiveCents, book.storefront_meta);
  const pricing = hasLiveCampaign
    ? {
        priceLabel: `$${(effectiveCents / 100).toFixed(2)}`,
        originalLabel: `$${(resolvedPrice!.regularCents / 100).toFixed(2)}`,
        discountPct: campaignPct,
      }
    : {
        priceLabel: fallbackPricing.priceLabel,
        originalLabel: fallbackPricing.originalLabel,
        discountPct: fallbackPricing.discountPct,
      };

  return (
    <Link
      to={productHref}
      aria-label={`ดูรายละเอียด ${displayTitle}`}
      className={[
        "group flex flex-col animate-fade-in-up",
        isStrip ? "flex-shrink-0 w-56 md:w-64" : "",
      ].join(" ")}
      style={{ animationDelay: `${Math.min(index * 30, 240)}ms` }}
    >
      {/* Image tile — square, rounded, borderless. The image IS the card.
          FILL-THUMBNAIL law (owner order 2026-07-23): thumbnails fill the
          tile edge-to-edge with no white borders. object-cover on all books;
          the cover art's own safe-zone keeps the title readable. */}
      <div className="relative w-full aspect-square overflow-hidden rounded-lg bg-muted">
        {image ? (
          <img
            src={image}
            alt={displayTitle}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <FileText className="h-14 w-14" strokeWidth={1.5} />
          </div>
        )}
        {pricing.discountPct != null && pricing.discountPct >= 20 && (
          <span className="absolute top-2 left-2 z-10 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-md">
            Save {pricing.discountPct}%
          </span>
        )}
      </div>

      {/* Meta rows — tight vertical rhythm, no extra padding container. */}
      <div className="mt-2 flex flex-col gap-1">
        <h3
          title={displayTitle}
          className="truncate text-[15px] leading-snug text-foreground group-hover:underline"
        >
          {displayTitle}
        </h3>

        <EditorialQualityBadge compact />


        <div className="flex items-baseline flex-wrap gap-x-1.5 gap-y-0">
          <span className="text-[16px] font-extrabold text-red-600 tabular-nums">
            {pricing.priceLabel}
          </span>
          {pricing.originalLabel && (
            <>
              <span className="text-xs text-muted-foreground line-through tabular-nums">
                {pricing.originalLabel}
              </span>
              {pricing.discountPct != null && (
                <span className="text-xs font-semibold text-red-600">
                  −{pricing.discountPct}%
                </span>
              )}
            </>
          )}
        </div>
        {pricing.originalLabel && pricing.discountPct != null && (
          <p className="text-[11px] font-medium text-green-700">
            You save ${((Number(pricing.originalLabel.replace("$","")) - Number(pricing.priceLabel.replace("$","")))).toFixed(2)} today
          </p>
        )}

        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Download className="h-3 w-3" strokeWidth={2} />
          <span>Digital Download</span>
        </p>
      </div>
    </Link>
  );
};
