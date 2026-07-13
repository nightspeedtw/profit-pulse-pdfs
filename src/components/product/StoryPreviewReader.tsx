import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Lock, Download, Mail } from "lucide-react";
import type { PreviewSpread } from "@/lib/storefront";

interface Props {
  spreads: PreviewSpread[];
  totalPages: number;
  previewPageCount: number;
  cliffhangerHook: string | null;
  priceLabel: string;
  onBuy: () => void;
}

/**
 * Interactive story preview: reads N spreads (image + text) one at a time,
 * then locks the next page with a Zeigarnik-style cliffhanger + buy CTA.
 */
export default function StoryPreviewReader({
  spreads,
  totalPages,
  previewPageCount,
  cliffhangerHook,
  priceLabel,
  onBuy,
}: Props) {
  const unlockedCount = Math.max(1, Math.min(previewPageCount || 3, spreads.length - 1));
  const lockSpread = spreads[unlockedCount] ?? spreads[spreads.length - 1] ?? null;
  const total = totalPages || spreads.length;
  const stepsCount = unlockedCount + 1; // pages + 1 lock card
  const [step, setStep] = useState(0);

  const currentSpread = useMemo(() => {
    if (step < unlockedCount) return spreads[step];
    return null;
  }, [step, unlockedCount, spreads]);

  const isLock = step >= unlockedCount;
  const currentPageNumber = isLock ? unlockedCount + 1 : (currentSpread?.page ?? step + 1);

  if (!spreads || spreads.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display text-2xl uppercase">Story Preview</h2>
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {isLock ? "Next up" : `Page ${currentPageNumber} of ${total}`}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full border-2 border-foreground bg-background overflow-hidden">
        <div
          className="h-full bg-accent-foreground transition-all"
          style={{ width: `${Math.min(100, ((step + 1) / stepsCount) * 100)}%` }}
        />
      </div>

      {/* Spread frame */}
      <div className="border-2 border-foreground bg-secondary shadow-brutal overflow-hidden">
        {!isLock && currentSpread ? (
          <div className="grid md:grid-cols-2">
            <div className="aspect-[4/5] md:aspect-auto md:min-h-[420px] bg-background border-b-2 md:border-b-0 md:border-r-2 border-foreground overflow-hidden">
              <img
                src={currentSpread.image_url}
                alt={currentSpread.caption ?? `Page ${currentSpread.page}`}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-6 md:p-8 flex flex-col justify-center gap-3">
              {currentSpread.caption && (
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  {currentSpread.caption}
                </p>
              )}
              <p className="text-lg md:text-xl leading-relaxed font-serif whitespace-pre-wrap">
                {currentSpread.text ??
                  currentSpread.caption ??
                  "..."}
              </p>
              <p className="mt-auto pt-4 font-mono text-xs text-muted-foreground">
                — page {currentSpread.page} / {total}
              </p>
            </div>
          </div>
        ) : (
          <CliffhangerLock
            blurImage={lockSpread?.image_url ?? spreads[spreads.length - 1]?.image_url ?? ""}
            hook={cliffhangerHook}
            remainingPages={Math.max(0, total - unlockedCount)}
            priceLabel={priceLabel}
            onBuy={onBuy}
          />
        )}
      </div>

      {/* Nav */}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" /> Previous
        </Button>
        <div className="flex gap-1.5">
          {Array.from({ length: stepsCount }).map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              aria-label={`Go to page ${i + 1}`}
              className={`h-2 w-6 border border-foreground transition-all ${
                i === step ? "bg-accent-foreground" : "bg-background hover:bg-muted"
              }`}
            />
          ))}
        </div>
        <Button
          onClick={() => setStep((s) => Math.min(stepsCount - 1, s + 1))}
          disabled={step >= stepsCount - 1}
          className="gap-2"
        >
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}

function CliffhangerLock({
  blurImage,
  hook,
  remainingPages,
  priceLabel,
  onBuy,
}: {
  blurImage: string;
  hook: string | null;
  remainingPages: number;
  priceLabel: string;
  onBuy: () => void;
}) {
  return (
    <div className="relative min-h-[420px]">
      {blurImage && (
        <img
          src={blurImage}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: "blur(18px) brightness(0.75)", transform: "scale(1.05)" }}
        />
      )}
      <div className="absolute inset-0 bg-background/60" />
      <div className="relative z-10 flex flex-col items-center justify-center text-center gap-5 p-8 md:p-12 min-h-[420px]">
        <div className="h-14 w-14 rounded-full border-2 border-foreground bg-highlight flex items-center justify-center shadow-brutal">
          <Lock className="h-6 w-6" />
        </div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Next pages are locked
        </p>
        <h3 className="font-display text-2xl md:text-3xl uppercase leading-tight max-w-xl">
          {hook ?? "Want to know what happens next? Continue in the full book"}
        </h3>
        {remainingPages > 0 && (
          <p className="text-sm text-muted-foreground">
            Still <strong>{remainingPages} pages</strong> waiting for you
          </p>
        )}
        <div className="w-full max-w-sm space-y-3 pt-2">
          <Button onClick={onBuy} className="h-14 w-full gap-2 text-base">
            <Download className="h-5 w-5" />
            Get the full story · {priceLabel}
          </Button>
          <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
            Delivered to your email within 1 minute of purchase
          </p>
        </div>
      </div>
    </div>
  );
}
