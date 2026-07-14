import { useEffect } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  images: string[];
}

export const PreviewLightbox = ({ open, onClose, title, images }: Props) => {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!open) return;
    setI(0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((v) => Math.min(v + 1, images.length - 1));
      if (e.key === "ArrowLeft")  setI((v) => Math.max(v - 1, 0));
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open, images.length, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in-up" onClick={onClose}>
      <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
        <button
          type="button" onClick={onClose}
          className="absolute -top-12 right-0 text-white/80 hover:text-white inline-flex items-center gap-1"
          aria-label="Close preview"
        >
          <X className="h-5 w-5" /> ปิด
        </button>
        <div className="aspect-square bg-white rounded-2xl overflow-hidden shadow-elegant">
          {images.length > 0 ? (
            <img src={images[i]} alt={`${title} — spread ${i + 1}`} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
              ตัวอย่างเล่มนี้กำลังจัดเตรียม
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between text-white/85 text-sm">
          <button type="button" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} className="p-2 disabled:opacity-30">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="font-display">{title} · {images.length > 0 ? `${i + 1}/${images.length}` : "—"}</p>
          <button type="button" onClick={() => setI(Math.min(images.length - 1, i + 1))} disabled={i >= images.length - 1} className="p-2 disabled:opacity-30">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
