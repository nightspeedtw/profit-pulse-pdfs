// Full-book "Look Inside" flipbook modal.
// Renders every available preview / interior page with a real page-turn feel,
// keyboard + swipe navigation, auto-play, thumbnail strip, and a Buy CTA
// pinned to the footer so browsing stays commercial.
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Pause, X, ShoppingCart } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  images: string[];
  title: string;
  priceLabel: string;
  onBuy: () => void;
}

export default function LookInsideFlipbook({ open, onClose, images, title, priceLabel, onBuy }: Props) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [turnDir, setTurnDir] = useState<"next" | "prev">("next");
  const timerRef = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const total = images.length;

  useEffect(() => {
    if (open) setIdx(0);
    else setPlaying(false);
  }, [open]);

  useEffect(() => {
    if (!open || !playing || total < 2) return;
    timerRef.current = window.setInterval(() => {
      setTurnDir("next");
      setIdx((i) => (i + 1) % total);
    }, 1400);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [open, playing, total]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") { setTurnDir("next"); setIdx((i) => Math.min(total - 1, i + 1)); }
      else if (e.key === "ArrowLeft") { setTurnDir("prev"); setIdx((i) => Math.max(0, i - 1)); }
      else if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, total, onClose]);

  if (!open) return null;
  if (total === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-foreground/90 flex items-center justify-center p-6" onClick={onClose}>
        <div className="max-w-md bg-background border-2 border-foreground rounded-lg p-6 text-center" onClick={(e) => e.stopPropagation()}>
          <h2 className="font-bold text-lg mb-2">Sample coming soon</h2>
          <p className="text-sm text-muted-foreground mb-4">
            The full {title} PDF unlocks the moment you buy — every page, print-ready.
          </p>
          <button onClick={onBuy} className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-lg bg-primary text-primary-foreground font-bold">
            <ShoppingCart className="h-4 w-4" /> Get the book · {priceLabel}
          </button>
        </div>
      </div>
    );
  }

  const goNext = () => { setTurnDir("next"); setIdx((i) => Math.min(total - 1, i + 1)); };
  const goPrev = () => { setTurnDir("prev"); setIdx((i) => Math.max(0, i - 1)); };

  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/95 flex flex-col"
      role="dialog"
      aria-label={`Look inside ${title}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-background/20 text-background">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono uppercase tracking-widest opacity-70">Look inside</span>
          <span className="text-sm font-semibold truncate max-w-[50vw]">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono tabular-nums">{idx + 1} / {total}</span>
          <button
            onClick={() => setPlaying((p) => !p)}
            className="p-2 rounded-full border border-background/30 hover:bg-background/10"
            aria-label={playing ? "Pause flipbook" : "Play flipbook"}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button onClick={onClose} className="p-2 rounded-full border border-background/30 hover:bg-background/10" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Page stage */}
      <div
        className="flex-1 flex items-center justify-center relative overflow-hidden select-none"
        onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchStartX.current == null) return;
          const dx = e.changedTouches[0].clientX - touchStartX.current;
          if (dx < -40) goNext();
          else if (dx > 40) goPrev();
          touchStartX.current = null;
        }}
      >
        <button
          onClick={goPrev}
          disabled={idx === 0}
          className="absolute left-2 md:left-6 z-10 p-3 rounded-full bg-background/10 text-background hover:bg-background/20 disabled:opacity-30"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        <div className="relative w-full h-full max-w-[900px] flex items-center justify-center px-4">
          <div
            key={`${idx}-${turnDir}`}
            className={`bg-white shadow-2xl rounded-md overflow-hidden w-full max-h-[75vh] aspect-square flex items-center justify-center ${
              turnDir === "next" ? "animate-flip-next" : "animate-flip-prev"
            }`}
            style={{ transformOrigin: turnDir === "next" ? "left center" : "right center" }}
          >
            <img
              src={images[idx]}
              alt={`${title} — page ${idx + 1}`}
              className="w-full h-full object-contain"
              draggable={false}
            />
          </div>
        </div>

        <button
          onClick={goNext}
          disabled={idx === total - 1}
          className="absolute right-2 md:right-6 z-10 p-3 rounded-full bg-background/10 text-background hover:bg-background/20 disabled:opacity-30"
          aria-label="Next page"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      {/* Thumbnails */}
      <div className="border-t border-background/20 bg-foreground/70 px-3 py-2 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {images.map((u, i) => (
            <button
              key={`${u}-${i}`}
              onClick={() => { setTurnDir(i > idx ? "next" : "prev"); setIdx(i); }}
              className={`w-14 h-14 flex-shrink-0 rounded overflow-hidden bg-white border-2 transition-all ${
                i === idx ? "border-accent ring-2 ring-accent" : "border-background/30 opacity-70 hover:opacity-100"
              }`}
              aria-label={`Go to page ${i + 1}`}
            >
              <img src={u} alt="" loading="lazy" className="w-full h-full object-contain" />
            </button>
          ))}
        </div>
      </div>

      {/* Buy footer */}
      <div className="border-t border-background/20 bg-background px-4 md:px-6 py-3 flex items-center justify-between gap-4">
        <div className="text-xs md:text-sm text-muted-foreground hidden sm:block">
          Instant PDF · Print unlimited copies · Personal + classroom use
        </div>
        <button
          onClick={onBuy}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-bold hover:opacity-90"
        >
          <ShoppingCart className="h-4 w-4" /> Get the full book · {priceLabel}
        </button>
      </div>

      {/* Local styles for page-turn feel */}
      <style>{`
        @keyframes flipNext {
          0% { transform: perspective(1200px) rotateY(-25deg); opacity: 0.4; }
          100% { transform: perspective(1200px) rotateY(0deg); opacity: 1; }
        }
        @keyframes flipPrev {
          0% { transform: perspective(1200px) rotateY(25deg); opacity: 0.4; }
          100% { transform: perspective(1200px) rotateY(0deg); opacity: 1; }
        }
        .animate-flip-next { animation: flipNext 350ms ease-out; }
        .animate-flip-prev { animation: flipPrev 350ms ease-out; }
      `}</style>
    </div>
  );
}
