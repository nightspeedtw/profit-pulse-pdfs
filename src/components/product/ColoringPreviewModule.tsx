import { Download, Printer, Shield, Zap, FileText, PackageOpen, Heart, Gift, Check, Palette, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PreviewSpread } from "@/lib/storefront";

interface Props {
  title: string;
  shortHook: string | null;
  sellingHook: string | null;
  ageBand: string | null;
  categoryLabel: string | null;
  pageCount: number | null;
  trimSize: string | null;
  formatLabel: string | null;
  spreads: PreviewSpread[];
  priceLabel: string;
  onBuy: () => void;
  valueCards?: {
    whats_inside?: string[];
    why_kids_love_it?: string[];
    perfect_for?: string[];
  } | null;
  digitalDeliveryNote?: string | null;
  licenseNote?: string | null;
}

/**
 * ColoringPreviewModule
 *
 * Owner law 2026-07-18: coloring-book sales pages must render interior
 * coloring pages (line art, no manuscript text), coloring-specific badges
 * (page count, trim, print-ready), and coloring value cards. The picture-book
 * StoryPreviewModule (excerpt, read-aloud minutes) does not apply here.
 */
export default function ColoringPreviewModule({
  title, shortHook, sellingHook, ageBand, categoryLabel, pageCount,
  trimSize, formatLabel, spreads, priceLabel, onBuy, valueCards,
  digitalDeliveryNote, licenseNote,
}: Props) {
  const hasCards = !!(valueCards && (
    (valueCards.whats_inside?.length ?? 0) > 0 ||
    (valueCards.why_kids_love_it?.length ?? 0) > 0 ||
    (valueCards.perfect_for?.length ?? 0) > 0
  ));

  return (
    <section aria-label="Coloring book preview" className="border-2 border-foreground bg-card rounded-2xl overflow-hidden">
      {/* 1. Badge row */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3 px-5 md:px-7 pt-5 md:pt-6 pb-4 border-b border-border bg-highlight/40">
        {ageBand && <Badge icon={Palette}>Ages {ageBand}</Badge>}
        {pageCount && <Badge icon={FileText}>{pageCount} coloring pages</Badge>}
        {trimSize && <Badge icon={Ruler}>{trimSize}</Badge>}
        <Badge icon={Printer}>Print-ready PDF</Badge>
        <Badge icon={Zap}>Instant download</Badge>
        <Badge icon={Shield}>Personal + classroom use</Badge>
        {categoryLabel && <Badge>{categoryLabel}</Badge>}
        <span className="ml-auto text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Art powered by Runware · Gemini · Cloudflare AI
        </span>
      </div>

      <div className="px-5 md:px-7 py-6 md:py-8 space-y-6">
        {/* 2. Selling hook */}
        {sellingHook && (
          <p className="text-xs md:text-sm font-mono uppercase tracking-widest text-accent-foreground font-bold">
            {sellingHook}
          </p>
        )}

        {/* 3. Short hook */}
        {shortHook && (
          <p className="text-base md:text-lg leading-relaxed font-serif text-foreground/90 border-l-4 border-accent pl-4 italic">
            {shortHook}
          </p>
        )}

        {/* 4. Interior page grid (the star of a coloring book sales page) */}
        {spreads.length > 0 && (
          <div>
            <p className="font-mono uppercase tracking-widest text-[10px] text-muted-foreground mb-3">
              Sample pages from inside the book
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {spreads.slice(0, 4).map((s, i) => (
                <figure
                  key={`${s.page}-${i}`}
                  className="rounded-lg overflow-hidden border-2 border-border bg-white aspect-[17/22] relative"
                >
                  <img
                    src={s.image_url}
                    alt={`Coloring page ${s.page} from ${title}`}
                    loading="lazy"
                    className="w-full h-full object-contain"
                  />
                  <figcaption className="absolute bottom-0 left-0 right-0 text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-2 py-1 border-t border-border bg-background/90">
                    Page {s.page}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}

        {/* 5. Value cards */}
        {hasCards && (
          <div className="grid md:grid-cols-3 gap-4 pt-2">
            {(valueCards?.whats_inside?.length ?? 0) > 0 && (
              <ValueCard icon={PackageOpen} title="What's inside" items={valueCards!.whats_inside!} accent="bg-highlight/60" />
            )}
            {(valueCards?.why_kids_love_it?.length ?? 0) > 0 && (
              <ValueCard icon={Heart} title="Why kids love it" items={valueCards!.why_kids_love_it!} accent="bg-accent/20" />
            )}
            {(valueCards?.perfect_for?.length ?? 0) > 0 && (
              <ValueCard icon={Gift} title="Perfect for" items={valueCards!.perfect_for!} accent="bg-muted/60" />
            )}
          </div>
        )}

        {/* 6. Offer stack */}
        <div className="pt-2 space-y-3 border-t-2 border-foreground/10 mt-2">
          {formatLabel && (
            <p className="text-sm font-mono uppercase tracking-wider text-foreground/80 pt-3">
              {formatLabel}
            </p>
          )}
          <Button
            onClick={onBuy}
            className="w-full md:w-auto h-14 px-8 gap-2 text-base font-display tracking-wide"
          >
            <Download className="h-5 w-5" />
            Buy · {priceLabel}
            <span className="opacity-70 text-sm font-sans font-normal ml-1">(Instant PDF · print at home)</span>
          </Button>

          {digitalDeliveryNote && (
            <p className="text-xs text-muted-foreground">{digitalDeliveryNote}</p>
          )}
          {licenseNote && (
            <p className="text-xs text-muted-foreground">{licenseNote}</p>
          )}

          {/* Trust layer */}
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-3 border-t border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Shield className="h-3 w-3" /> Secure checkout</span>
            <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3" /> Instant download</span>
            <span className="inline-flex items-center gap-1"><Printer className="h-3 w-3" /> Print unlimited</span>
            <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> PDF{pageCount ? ` · ${pageCount} pages` : ""}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Badge({ icon: Icon, children }: { icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-background text-[11px] font-mono uppercase tracking-wider">
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

function ValueCard({
  icon: Icon, title, items, accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  items: string[];
  accent?: string;
}) {
  return (
    <div className={`rounded-xl border-2 border-foreground p-4 ${accent ?? "bg-card"}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4" />
        <h3 className="font-display text-sm uppercase tracking-wide">{title}</h3>
      </div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
            <Check className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 opacity-70" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
