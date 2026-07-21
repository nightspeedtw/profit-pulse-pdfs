import { useState } from "react";
import { Button } from "@/components/ui/button";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";

interface Props {
  bookId: string;
  priceCents: number;
  compareAtCents?: number | null;
  userId: string | null | undefined;
  userEmail?: string | null;
  className?: string;
  size?: "sm" | "default" | "lg";
}

export function BuyBookButton({ bookId, priceCents, userId, userEmail, className, size = "default" }: Props) {
  const nav = useNavigate();
  const { openBookCheckout, loading } = usePaddleCheckout();
  const { subscription } = useSubscription(userId);
  const [redeeming, setRedeeming] = useState(false);

  const priceStr = `$${(priceCents / 100).toFixed(2)}`;

  const handleBuy = async () => {
    if (!userId) { nav(`/auth?next=${encodeURIComponent(window.location.pathname)}`); return; }
    try {
      await openBookCheckout({ bookId, userId, customerEmail: userEmail ?? undefined });
    } catch (e) {
      toast.error(`Checkout failed: ${(e as Error).message}`);
    }
  };

  const handleRedeem = async () => {
    if (!userId) return;
    setRedeeming(true);
    try {
      const { data, error } = await supabase.functions.invoke("redeem-credit-download", { body: { bookId } });
      if (error) throw error;
      toast.success(`Added to your library! ${data.remaining} credits left this month.`);
      nav("/account/library");
    } catch (e) {
      toast.error(`Couldn't redeem: ${(e as Error).message}`);
    } finally {
      setRedeeming(false);
    }
  };

  if (subscription?.isActive && subscription.creditsRemaining > 0) {
    return (
      <div className={`flex flex-col gap-2 ${className ?? ""}`}>
        <Button onClick={handleRedeem} disabled={redeeming} size={size} className="w-full gap-2">
          {redeeming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Get it free — 1 credit ({subscription.creditsRemaining} left)
        </Button>
        <button
          onClick={handleBuy}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          or buy this one for {priceStr}
        </button>
      </div>
    );
  }

  return (
    <Button onClick={handleBuy} disabled={loading} size={size} className={`w-full ${className ?? ""}`}>
      {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
      Buy for {priceStr}
    </Button>
  );
}
