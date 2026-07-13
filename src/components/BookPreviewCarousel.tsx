import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";

interface Props {
  images: string[];
  onBuyClick?: () => void;
}

export default function BookPreviewCarousel({ images, onBuyClick }: Props) {
  if (!images || images.length < 2) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl uppercase">Look Inside</h2>
        <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          {images.length} preview pages
        </span>
      </div>
      <Carousel className="w-full">
        <CarouselContent>
          {images.map((url, i) => {
            const isTeaser = i === images.length - 1;
            return (
              <CarouselItem key={i}>
                <div className="relative aspect-[3/4] bg-secondary border-2 border-foreground overflow-hidden">
                  <img
                    src={url}
                    alt={`Preview page ${i + 1}`}
                    className={`w-full h-full object-cover ${isTeaser ? "blur-sm scale-105" : ""}`}
                  />
                  {isTeaser && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/70 backdrop-blur-sm p-6 text-center">
                      <Lock className="h-10 w-10" />
                      <p className="font-display text-xl uppercase leading-tight max-w-xs">
                        What happens next? Find out in the full book!
                      </p>
                      {onBuyClick && (
                        <Button onClick={onBuyClick} className="mt-2">
                          Buy Now
                        </Button>
                      )}
                    </div>
                  )}
                  <div className="absolute bottom-2 right-2 bg-foreground text-background text-xs font-mono uppercase px-2 py-1">
                    {i + 1} / {images.length}
                  </div>
                </div>
              </CarouselItem>
            );
          })}
        </CarouselContent>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>
    </section>
  );
}
