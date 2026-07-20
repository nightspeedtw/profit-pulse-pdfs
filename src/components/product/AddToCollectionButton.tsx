// Etsy-style "Add to collection" (wishlist) — localStorage now, auth-sync later.
import { Heart } from "lucide-react";
import { useWishlist } from "@/lib/wishlist";

interface Props {
  ebookId: string;
}

export default function AddToCollectionButton({ ebookId }: Props) {
  const { inWishlist, toggle } = useWishlist(ebookId);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={inWishlist}
      aria-label={inWishlist ? "Remove from your collection" : "Add to your collection"}
      className={`w-full h-11 rounded-md border-2 border-foreground font-display uppercase tracking-wide text-sm inline-flex items-center justify-center gap-2 transition-colors ${
        inWishlist ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"
      }`}
    >
      <Heart className={`h-4 w-4 ${inWishlist ? "fill-current" : ""}`} />
      {inWishlist ? "Saved to your collection" : "Add to collection"}
    </button>
  );
}
