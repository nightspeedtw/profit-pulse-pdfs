import { useState } from "react";
import { Download, BookOpen, Clock, Shield, Zap, FileText, Gift, Heart, PackageOpen, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PreviewSpread } from "@/lib/storefront";

interface Props {
  title: string;
  excerpt: string | null;
  shortHook: string | null;
  ageBand: string | null;
  readAloudMin: number | null;
  themeLabel: string | null;
  pageCount: number | null;
  spreads: PreviewSpread[];
  priceLabel: string;
  onBuy: () => void;
  valueCards?: {
    whats_inside?: string[];
    why_kids_love_it?: string[];
    perfect_for?: string[];
  } | null;
}

export default function StoryPreviewModule({
  title, excerpt, shortHook, ageBand, readAloudMin, themeLabel,
  pageCount, spreads, priceLabel, onBuy, valueCards,
}: Props) {
  const [showMore, setShowMore] = useState(false);
  const warmestSpread = spreads[Math.min(1, spreads.length - 1)] ?? spreads[0] ?? null;
  const themeReadable = themeLabel ? themeLabel.replace(/[-_]/g, ' ') : null;
  const specsLine = [
    ageBand ? `Perfect for ages ${ageBand}` : null,
    themeReadable,
    readAloudMin ? `read-aloud ~${readAloudMin} min` : null,
    pageCount ? `${pageCount} pages` : null,
  ].filter(Boolean).join(' · ');
  const hasCards = !!(valueCards && (
    (valueCards.whats_inside?.length ?? 0) > 0 ||
    (valueCards.why_kids_love_it?.length ?? 0) > 0 ||
    (valueCards.perfect_for?.length ?? 0) > 0
  ));

  return (
    <section aria-label="Story preview" className="border-2 border-foreground bg-card rounded-2xl overflow-hidden">
      {/* 1. Badge row */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3 px-5 md:px-7 pt-5 md:pt-6 pb-4 border-b border-border bg-highlight/40">
        {ageBand && (
          <Badge icon={BookOpen}>Ages {ageBand}</Badge>
        )}
        {readAloudMin && (
          <Badge icon={Clock}>~{readAloudMin} min read-aloud</Badge>
        )}
        <Badge icon={FileText}>Illustrated PDF{pageCount ? ` · ${pageCount} pages` : ""}</Badge>
        {themeLabel && (
          <Badge>{themeLabel}</Badge>
        )}
      </div>

      <div className="px-5 md:px-7 py-6 md:py-8 space-y-6">
        {/* 2. Short hook */}
        {shortHook && (
          <p className="text-base md:text-lg leading-relaxed font-serif text-foreground/90 border-l-4 border-accent pl-4 italic">
            {shortHook}
          </p>
        )}

        {/* 3. Visible excerpt + 4. inline spread */}
        <div className="grid md:grid-cols-[1fr,minmax(220px,300px)] gap-6 md:gap-8 items-start">
          <div>
            <p className="font-mono uppercase tracking-widest text-[10px] text-muted-foreground mb-2">
              A page from inside the book
            </p>
            {excerpt ? (
              <div className="font-serif text-[15px] md:text-base leading-[1.75] text-foreground whitespace-pre-line first-letter:font-display first-letter:text-5xl first-letter:font-bold first-letter:float-left first-letter:mr-2 first-letter:leading-none first-letter:mt-1">
                {excerpt}
              </div>
            ) : (
              <p className="text-muted-foreground italic">Excerpt coming soon.</p>
            )}
          </div>

          {warmestSpread && (
            <figure className="rounded-lg overflow-hidden border-2 border-border bg-muted">
              <img
                src={warmestSpread.image_url}
                alt={`Interior spread from ${title}`}
                loading="lazy"
                className="w-full h-auto object-contain"
              />
              <figcaption className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground px-3 py-2 border-t border-border">
                Interior spread · page {warmestSpread.page}
              </figcaption>
            </figure>
          )}
        </div>

        {/* 4b. Marketplace-style value cards */}
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

        {/* 5. Offer stack: specs → CTA → reassurance → trust */}
        <div className="pt-2 space-y-3 border-t-2 border-foreground/10 mt-2">
          {specsLine && (
            <p className="text-sm font-mono uppercase tracking-wider text-foreground/80 pt-3">
              {specsLine}
            </p>
          )}
          <Button
            onClick={onBuy}
            className="w-full md:w-auto h-14 px-8 gap-2 text-base font-display tracking-wide"
          >
            <Download className="h-5 w-5" />
            Buy · {priceLabel} <span className="opacity-70 text-sm font-sans font-normal ml-1">(Instant PDF download)</span>
          </Button>


          {spreads.length > 1 && (
            <div>
              <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                className="text-sm font-mono uppercase tracking-wide underline text-muted-foreground hover:text-foreground"
                aria-expanded={showMore}
              >
                {showMore ? "Hide sample" : `Read a longer sample (${spreads.length} spreads)`}
              </button>
              {showMore && (
                <div className="mt-4 grid sm:grid-cols-2 gap-4">
                  {spreads.slice(0, 6).map((s) => (
                    <figure key={s.page} className="rounded-lg overflow-hidden border border-border bg-card flex flex-col">
                      <img src={s.image_url} alt={`Page ${s.page}`} loading="lazy" className="w-full h-auto object-cover" />
                      {s.text && s.text.trim().length > 0 && (
                        <div className="px-3 py-3 border-t border-border">
                          <p className="font-serif text-sm md:text-[15px] leading-relaxed text-foreground whitespace-pre-line">
                            {s.text}
                          </p>
                        </div>
                      )}
                      <figcaption className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground px-3 py-1.5 border-t border-border bg-muted/40">
                        Page {s.page}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Reassurance microcopy */}
          <p className="text-xs text-muted-foreground">
            Instant download · Illustrated PDF{ageBand ? ` · ages ${ageBand}` : ""}{readAloudMin ? ` · read-aloud ~${readAloudMin} min` : ""}
          </p>

          {/* Trust layer */}
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-3 border-t border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Shield className="h-3 w-3" /> Secure checkout</span>
            <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3" /> Instant access</span>
            <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> PDF{pageCount ? ` · ${pageCount} pages` : ""}</span>
            <span className="inline-flex items-center gap-1"><BookOpen className="h-3 w-3" /> QC ≥ 90 quality gate</span>
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
