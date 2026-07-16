import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { emitColoringEvent } from "@/lib/coloringFunnelEvents";

interface Props {
  ebookId: string;
  title: string;
  coverUrl: string | null;
  /** Watermarked preview image URLs from storefront_meta.preview_page_urls. */
  previewUrls: string[];
  open: boolean;
  onClose: () => void;
}

/**
 * Watermarked look-inside lightbox. Never receives or renders the sold PDF —
 * only the pre-uploaded PREVIEW pngs that `coloring-book-publish` produced.
 * Emits `preview_page_turn` per unique page_index (dedupe handled in the
 * event helper) so the daily repricer's popularity signal grows with real
 * engagement, not accidental double-taps.
 */
export function ColoringPreviewLightbox({
  ebookId, title, coverUrl, previewUrls, open, onClose,
}: Props) {
  const slides = useMemo(() => {
    const arr = coverUrl ? [{ url: coverUrl, label: "Cover" }] : [];
    previewUrls.forEach((u, i) => arr.push({ url: u, label: `Sample page ${i + 1}` }));
    return arr;
  }, [coverUrl, previewUrls]);

  const [i, setI] = useState(0);
  const touchStartX = useRef<number | null>(null);

  const go = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(slides.length - 1, next));
    setI(clamped);
    void emitColoringEvent("preview_page_turn", ebookId, { extra: { page_index: clamped } });
  }, [ebookId, slides.length]);

  useEffect(() => {
    if (!open) return;
    setI(0);
    void emitColoringEvent("preview_page_turn", ebookId, { extra: { page_index: 0 } });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(i + 1);
      if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // i intentionally omitted — arrow handlers use functional refresh via closure on each render below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(i + 1);
      if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, i, go]);

  if (!open || slides.length === 0) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Look inside ${title}`}
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex flex-col"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border">
        <div className="text-xs font-mono uppercase tracking-widest">
          {slides[i].label} · {i + 1} / {slides.length}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="p-2 rounded-full hover:bg-muted"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        className="relative flex-1 flex items-center justify-center overflow-hidden select-none"
        onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const start = touchStartX.current;
          if (start == null) return;
          const dx = (e.changedTouches[0]?.clientX ?? start) - start;
          if (dx <= -40) go(i + 1);
          else if (dx >= 40) go(i - 1);
          touchStartX.current = null;
        }}
      >
        <button
          type="button"
          aria-label="Previous page"
          onClick={() => go(i - 1)}
          disabled={i === 0}
          className="hidden md:flex absolute left-4 h-12 w-12 rounded-full border-2 border-foreground bg-background/90 items-center justify-center disabled:opacity-30"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        <img
          src={slides[i].url}
          alt={`${title} — ${slides[i].label}`}
          loading="lazy"
          className="max-h-[85vh] max-w-[92vw] object-contain shadow-brand bg-white"
        />

        <button
          type="button"
          aria-label="Next page"
          onClick={() => go(i + 1)}
          disabled={i === slides.length - 1}
          className="hidden md:flex absolute right-4 h-12 w-12 rounded-full border-2 border-foreground bg-background/90 items-center justify-center disabled:opacity-30"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      <div className="px-4 py-3 border-t-2 border-border overflow-x-auto">
        <div className="flex gap-2">
          {slides.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => go(idx)}
              aria-label={`Go to ${s.label}`}
              aria-current={i === idx}
              className={`flex-shrink-0 h-16 w-12 border-2 overflow-hidden ${i === idx ? "border-accent" : "border-border"}`}
            >
              <img src={s.url} alt="" className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
