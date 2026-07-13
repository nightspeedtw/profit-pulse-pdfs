import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface Props {
  title: string;
  price: number | null;
  /** Ref to the primary in-page Buy button. Bar appears when it leaves the viewport. */
  watchRef: React.RefObject<HTMLElement>;
  onBuy: () => void;
}

/**
 * Sticky "Buy Now" bar. Appears once the user scrolls past the main Buy button.
 * Mobile: full-width bottom bar. Desktop (md+): floating card bottom-right.
 * All colors from semantic tokens.
 */
export default function StickyBuyBar({ title, price, watchRef, onBuy }: Props) {
  const [show, setShow] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = watchRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Show when the primary Buy button is fully out of view.
        setShow(!entry.isIntersecting);
      },
      { threshold: 0, rootMargin: "0px 0px -20% 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [watchRef]);

  const isFree = price == null || price === 0;
  const label = isFree ? "Download Free" : `Buy · $${price.toFixed(2)}`;

  return (
    <div
      ref={barRef}
      aria-hidden={!show}
      className={`fixed z-40 transition-all duration-300 ${
        show ? "opacity-100 translate-y-0" : "opacity-0 pointer-events-none translate-y-4"
      } bottom-0 inset-x-0 md:inset-x-auto md:right-6 md:bottom-6 md:max-w-sm`}
    >
      <div className="border-t-2 md:border-2 border-foreground bg-background p-3 md:p-4 shadow-lg md:shadow-xl flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            {isFree ? "Free download" : "Instant download"}
          </div>
          <div className="text-sm font-bold truncate">{title}</div>
        </div>
        <Button onClick={onBuy} className="gap-2 shrink-0">
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">{isFree ? "Free" : `$${price!.toFixed(2)}`}</span>
        </Button>
      </div>
    </div>
  );
}
