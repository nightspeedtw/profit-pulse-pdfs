import { useState } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import BookPreviewCarousel from "@/components/BookPreviewCarousel";

interface Props {
  images: string[];
  toc?: { title?: string | null }[] | null;
  onBuyClick?: () => void;
}

/**
 * Wraps the existing preview carousel + adds a "Free preview" button
 * that opens a modal with the table of contents and full-size first pages.
 * Returns null when the book has no preview images.
 */
export default function ProductPreview({ images, toc, onBuyClick }: Props) {
  const [open, setOpen] = useState(false);
  if (!images || images.length < 2) return null;

  const tocEntries = (toc ?? []).filter((c) => c?.title).slice(0, 12);
  const firstPages = images.slice(0, 2);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display text-2xl uppercase">Look Inside</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Eye className="h-4 w-4" /> Free Preview
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display uppercase">Free Preview</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              {tocEntries.length > 0 && (
                <section>
                  <h3 className="font-mono uppercase text-xs tracking-widest mb-3">Table of Contents</h3>
                  <ol className="space-y-1.5 text-sm">
                    {tocEntries.map((c, i) => (
                      <li key={i} className="flex items-baseline gap-3 border-b border-dashed border-foreground/20 pb-1.5">
                        <span className="font-mono text-muted-foreground w-6 shrink-0">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>{c.title}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              <section>
                <h3 className="font-mono uppercase text-xs tracking-widest mb-3">First Pages</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {firstPages.map((url, i) => (
                    <div key={i} className="aspect-[3/4] border-2 border-foreground bg-secondary overflow-hidden">
                      <img src={url} alt={`Preview page ${i + 1}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </section>
              {onBuyClick && (
                <div className="pt-2 border-t-2 border-foreground">
                  <Button
                    className="w-full"
                    onClick={() => { setOpen(false); onBuyClick(); }}
                  >
                    Get the Full Book
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <BookPreviewCarousel images={images} onBuyClick={onBuyClick} />
    </div>
  );
}
