import { useState } from "react";
import { initializePaddle, getPaddlePriceId, getPaddleEnvironment } from "@/lib/paddle";
import { supabase } from "@/integrations/supabase/client";

interface OpenBookCheckout {
  bookId: string;
  customerEmail?: string;
  userId: string;
  successUrl?: string;
}

interface OpenSubscriptionCheckout {
  priceId: string; // human-readable, e.g. "kids_pro_monthly"
  customerEmail?: string;
  userId: string;
  successUrl?: string;
}

export function usePaddleCheckout() {
  const [loading, setLoading] = useState(false);

  const openBookCheckout = async (opts: OpenBookCheckout) => {
    setLoading(true);
    try {
      await initializePaddle();
      const environment = getPaddleEnvironment();
      const { data, error } = await supabase.functions.invoke("resolve-checkout-price", {
        body: { bookId: opts.bookId, environment },
      });
      if (error || !data?.transactionId) throw new Error(error?.message || "Failed to create transaction");

      window.Paddle.Checkout.open({
        transactionId: data.transactionId,
        customer: opts.customerEmail ? { email: opts.customerEmail } : undefined,
        settings: {
          displayMode: "overlay",
          successUrl: opts.successUrl || `${window.location.origin}/account/library?purchase=success`,
          allowLogout: false,
          variant: "one-page",
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const openSubscriptionCheckout = async (opts: OpenSubscriptionCheckout) => {
    setLoading(true);
    try {
      await initializePaddle();
      const paddlePriceId = await getPaddlePriceId(opts.priceId);

      window.Paddle.Checkout.open({
        items: [{ priceId: paddlePriceId, quantity: 1 }],
        customer: opts.customerEmail ? { email: opts.customerEmail } : undefined,
        customData: { userId: opts.userId },
        settings: {
          displayMode: "overlay",
          successUrl: opts.successUrl || `${window.location.origin}/account?subscription=success`,
          allowLogout: false,
          variant: "one-page",
        },
      });
    } finally {
      setLoading(false);
    }
  };

  return { openBookCheckout, openSubscriptionCheckout, loading };
}
