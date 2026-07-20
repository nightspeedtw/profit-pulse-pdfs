// Auto flipbook — plays as a video-like preview in the gallery.
// Renders in-browser (no ffmpeg, no per-book asset). A play badge appears
// on the thumbnail; clicking opens a modal that animates through the
// interior preview URLs with a page-turn effect. Same source data every
// book has at publish, so this works automatically for every book.
import { useEffect, useRef, useState } from "react";
import { Play, X } from "lucide-react";

interface Props {
  images: string[];
  title: string;
}

export default function FlipbookPreview({ images, title }: Props) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open || images.length === 0) return;
    timerRef.current = window.setInterval(() => {
      setIdx((i) => (i + 1) % images.length);
    }, 1200);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [open, images.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (images.length < 2) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => { setIdx(0); setOpen(true); }}
        className="relative aspect-square w-full border-2 border-foreground bg-white overflow-hidden group"
        aria-label="Play flipbook preview"
      >
        <img src={images[0]} alt="Flipbook preview" className="w-full h-full object-contain opacity-70 group-hover:opacity-100 transition-opacity" loading="lazy" />
        <span className="absolute inset-0 flex items-center justify-center bg-foreground/40 group-hover:bg-foreground/20 transition-colors">
          <span className="w-12 h-12 rounded-full bg-background text-foreground border-2 border-foreground flex items-center justify-center shadow-brutal">
            <Play className="h-5 w-5 fill-current" />
          </span>
        </span>
        <span className="absolute bottom-1 left-1 text-[10px] font-mono uppercase tracking-widest bg-foreground text-background px-1.5 py-0.5">
          Flipbook
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-foreground/90 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-background bg-foreground border-2 border-background w-10 h-10 flex items-center justify-center"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className="relative w-full max-w-2xl aspect-square bg-white border-2 border-background shadow-brutal-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              key={idx}
              src={images[idx]}
              alt={`${title} — preview page ${idx + 1}`}
              className="w-full h-full object-contain animate-fade-in"
            />
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] font-mono uppercase tracking-widest bg-foreground text-background px-2 py-1">
              Page {idx + 1} / {images.length}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
