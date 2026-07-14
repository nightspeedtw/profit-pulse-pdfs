import { useState } from "react";
import { Download, BookOpen, Clock, Shield, Zap, FileText } from "lucide-react";
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
}

export default function StoryPreviewModule({
  title, excerpt, shortHook, ageBand, readAloudMin, themeLabel,
  pageCount, spreads, priceLabel, onBuy,
}: Props) {
  const [showMore, setShowMore] = useState(false);
  const warmestSpread = spreads[Math.min(1, spreads.length - 1)] ?? spreads[0] ?? null;

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

        {/* 5. CTA + secondary */}
        <div className="pt-2 space-y-3">
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
                <div className="mt-4 grid sm:grid-cols-2 gap-3">
                  {spreads.slice(0, 6).map((s) => (
                    <figure key={s.page} className="rounded-lg overflow-hidden border border-border bg-muted">
                      <img src={s.image_url} alt={`Page ${s.page}`} loading="lazy" className="w-full h-auto object-contain" />
                      <figcaption className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground px-2 py-1 border-t border-border">
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
