import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { supabase } from "@/integrations/supabase/client";
import { getStripe, getStripeEnvironment, isPaymentsConfigured } from "@/lib/stripe";
import { useCartStore } from "@/stores/cartStore";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function Checkout() {
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);

  const fetchClientSecret = useCallback(async (): Promise<string> => {
    const { data, error } = await supabase.functions.invoke("create-checkout", {
      body: {
        items: items.map((i) => ({ ebook_id: i.ebook_id, quantity: i.quantity })),
        environment: getStripeEnvironment(),
        return_url: `${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      },
    });
    if (error || !data?.clientSecret) throw new Error(error?.message || data?.error || "Failed to start checkout");
    return data.clientSecret as string;
  }, [items]);

  if (!isPaymentsConfigured()) {
    return (
      <div className="container py-16 text-center">
        <h1 className="font-display text-3xl uppercase mb-4">Checkout unavailable</h1>
        <p className="text-muted-foreground">Payments are not yet configured for this environment.</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="container py-16 text-center">
        <h1 className="font-display text-3xl uppercase mb-4">Your cart is empty</h1>
        <Button onClick={() => navigate("/library")} className="mt-4">Browse Library</Button>
      </div>
    );
  }

  return (
    <>
      <PaymentTestModeBanner />
      <div className="container py-8">
        <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-2 text-sm font-mono uppercase hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="border-2 border-foreground bg-card p-4">
          <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    </>
  );
}
