import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Download, ZoomIn } from "lucide-react";
import { emitColoringEvent } from "@/lib/coloringFunnelEvents";

interface Props {
  ebookId: string;
  title: string;
  coverUrl: string | null;
  /** Watermarked preview image URLs from storefront_meta.preview_page_urls. */
  previewUrls: string[];
  open: boolean;
  onClose: () => void;
  /** Total pages in the full book (for trust line). */
  totalPages?: number;
  /** Price label to render in the sticky buy CTA. */
  priceLabel?: string;
  /** Called when the sticky "Get the Full Book" CTA is clicked. */
  onBuy?: () => void;
  /** Cap number of interior sample pages shown. Defaults to 5. */
  maxPages?: number;
}

/**
 * Instant Preview modal — 5 approved interior pages + sticky purchase CTA.
 * Never receives or renders the sold PDF; only the pre-uploaded PREVIEW pngs.
 */
export function ColoringPreviewLightbox({
  ebookId, title, coverUrl, previewUrls, open, onClose,
  totalPages, priceLabel, onBuy, maxPages = 5,
}: Props) {
  const slides = useMemo(() => {
    const arr = coverUrl ? [{ url: coverUrl, label: "Cover" }] : [];
    previewUrls.slice(0, maxPages).forEach((u, i) => arr.push({ url: u, label: `Sample page ${i + 1}` }));
    return arr;
  }, [coverUrl, previewUrls, maxPages]);

  const [i, setI] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const go = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(slides.length - 1, next));
    setI(clamped);
    setZoomed(false);
    void emitColoringEvent("preview_page_turn", ebookId, { extra: { page_index: clamped } });
    void emitColoringEvent("preview_page_viewed", ebookId, { extra: { page_index: clamped } });
  }, [ebookId, slides.length]);

  useEffect(() => {
    if (!open) return;
    setI(0);
    setZoomed(false);
    void emitColoringEvent("preview_opened", ebookId, { force: true });
    void emitColoringEvent("preview_page_turn", ebookId, { extra: { page_index: 0 } });
    void emitColoringEvent("preview_page_viewed", ebookId, { extra: { page_index: 0 } });
  }, [open, ebookId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(i + 1);
      if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, i, go, onClose]);

  if (!open || slides.length === 0) return null;

  const handleBuy = () => {
    void emitColoringEvent("sample_to_purchase_clicked", ebookId, { force: true, extra: { source: "preview_modal" } });
    onBuy?.();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview inside ${title}`}
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex flex-col"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border">
        <div className="min-w-0">
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground truncate">
            A peek inside this coloring adventure
          </div>
          <div className="text-xs font-mono uppercase tracking-widest">
            {slides[i].label} · {i + 1} / {slides.length}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="p-2 rounded-full hover:bg-muted flex-shrink-0"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        className="relative flex-1 flex items-center justify-center overflow-auto select-none"
        onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          if (zoomed) return;
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
          className="hidden md:flex absolute left-4 h-12 w-12 rounded-full border-2 border-foreground bg-background/90 items-center justify-center disabled:opacity-30 z-10"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        <button
          type="button"
          onClick={() => setZoomed((z) => !z)}
          aria-label={zoomed ? "Zoom out" : "Zoom in"}
          className="cursor-zoom-in"
        >
          <img
            src={slides[i].url}
            alt={`${title} — ${slides[i].label}`}
            loading="lazy"
            className={`bg-white shadow-brand transition-transform duration-200 ${
              zoomed ? "max-w-none max-h-none scale-[1.6]" : "max-h-[70vh] max-w-[92vw] object-contain"
            }`}
          />
        </button>

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/90 border-2 border-foreground text-[11px] font-mono uppercase tracking-widest">
          <ZoomIn className="h-3 w-3" /> Tap image to zoom
        </div>

        <button
          type="button"
          aria-label="Next page"
          onClick={() => go(i + 1)}
          disabled={i === slides.length - 1}
          className="hidden md:flex absolute right-4 h-12 w-12 rounded-full border-2 border-foreground bg-background/90 items-center justify-center disabled:opacity-30 z-10"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      <div className="px-4 pt-3 border-t-2 border-border overflow-x-auto">
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
        <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground text-center pt-2 pb-1">
          These are real black-and-white printable pages included in your full book.
        </p>
      </div>

      {/* Sticky purchase CTA */}
      {(onBuy || priceLabel) && (
        <div className="border-t-2 border-foreground bg-background px-4 py-3 space-y-2">
          <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground text-center">
            {totalPages ? `${totalPages} unique pages` : "Full book"} · A4 + US Letter · Instant download
          </p>
          <button
            type="button"
            onClick={handleBuy}
            className="w-full h-12 rounded-md bg-foreground text-background font-display uppercase tracking-wide text-sm inline-flex items-center justify-center gap-2 hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <Download className="h-4 w-4" />
            Get the Full Book{priceLabel ? ` — ${priceLabel}` : ""}
          </button>
        </div>
      )}
    </div>
  );
}
