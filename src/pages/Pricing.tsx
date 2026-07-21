import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Sparkles } from "lucide-react";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { toast } from "sonner";

interface Tier {
  key: string;
  name: string;
  tagline: string;
  credits: number;
  monthlyCents: number;
  yearlyCents: number;
  monthlyPriceId: string;
  yearlyPriceId: string;
  features: string[];
  highlight?: boolean;
}

const TIERS: Tier[] = [
  {
    key: "starter",
    name: "Starter",
    tagline: "Perfect for casual reading.",
    credits: 10,
    monthlyCents: 499,
    yearlyCents: 4900,
    monthlyPriceId: "kids_starter_monthly",
    yearlyPriceId: "kids_starter_yearly",
    features: ["10 book downloads / month", "Access to full library", "Cancel anytime"],
  },
  {
    key: "pro",
    name: "Pro",
    tagline: "Best for family bedtime routines.",
    credits: 30,
    monthlyCents: 999,
    yearlyCents: 9900,
    monthlyPriceId: "kids_pro_monthly",
    yearlyPriceId: "kids_pro_yearly",
    features: ["30 book downloads / month", "Access to full library", "New releases first", "Cancel anytime"],
    highlight: true,
  },
  {
    key: "unlimited",
    name: "Unlimited",
    tagline: "For teachers, libraries and superfans.",
    credits: 100,
    monthlyCents: 1999,
    yearlyCents: 19900,
    monthlyPriceId: "kids_unlimited_monthly",
    yearlyPriceId: "kids_unlimited_yearly",
    features: ["100 book downloads / month", "Priority new releases", "Commercial classroom use", "Cancel anytime"],
  },
];

function money(cents: number) { return `$${(cents / 100).toFixed(2)}`; }

export default function Pricing() {
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const { openSubscriptionCheckout, loading } = usePaddleCheckout();
  const { subscription } = useSubscription(userId);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setUserEmail(data.user?.email ?? null);
    });
  }, []);

  const handleSubscribe = async (tier: Tier) => {
    if (!userId) { window.location.href = `/auth?next=/pricing`; return; }
    try {
      await openSubscriptionCheckout({
        priceId: cycle === "monthly" ? tier.monthlyPriceId : tier.yearlyPriceId,
        userId, customerEmail: userEmail ?? undefined,
      });
    } catch (e) {
      toast.error(`Checkout failed: ${(e as Error).message}`);
    }
  };

  const handlePortal = async () => {
    const { data, error } = await supabase.functions.invoke("create-portal-session");
    if (error || !data?.url) return toast.error("Could not open portal");
    window.open(data.url, "_blank");
  };

  return (
    <div className="min-h-screen bg-background">
      <PaymentTestModeBanner />
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        <div className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">Choose your plan</h1>
          <p className="text-lg text-muted-foreground">One subscription. Hundreds of illustrated books. Cancel anytime.</p>
        </div>

        <div className="flex justify-center mb-8">
          <div className="inline-flex rounded-lg border bg-card p-1">
            <button
              onClick={() => setCycle("monthly")}
              className={`px-4 py-2 text-sm rounded-md transition ${cycle === "monthly" ? "bg-primary text-primary-foreground" : ""}`}
            >Monthly</button>
            <button
              onClick={() => setCycle("yearly")}
              className={`px-4 py-2 text-sm rounded-md transition ${cycle === "yearly" ? "bg-primary text-primary-foreground" : ""}`}
            >Yearly <span className="ml-1 text-xs opacity-80">2 months free</span></button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {TIERS.map((tier) => {
            const cents = cycle === "monthly" ? tier.monthlyCents : tier.yearlyCents;
            const priceId = cycle === "monthly" ? tier.monthlyPriceId : tier.yearlyPriceId;
            const isCurrent = subscription?.price_id === priceId && subscription.isActive;
            return (
              <Card key={tier.key} className={tier.highlight ? "border-primary shadow-lg relative" : ""}>
                {tier.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full font-medium">
                    Most popular
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {tier.name}
                    {tier.highlight && <Sparkles className="w-4 h-4 text-primary" />}
                  </CardTitle>
                  <CardDescription>{tier.tagline}</CardDescription>
                  <div className="pt-4">
                    <span className="text-4xl font-bold">{money(cents)}</span>
                    <span className="text-muted-foreground ml-1">/ {cycle === "monthly" ? "month" : "year"}</span>
                  </div>
                  <div className="text-sm text-primary font-medium">{tier.credits} downloads / month</div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 mb-6">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <Button variant="outline" className="w-full" onClick={handlePortal}>Manage subscription</Button>
                  ) : (
                    <Button
                      className="w-full"
                      variant={tier.highlight ? "default" : "outline"}
                      disabled={loading}
                      onClick={() => handleSubscribe(tier)}
                    >
                      {subscription?.isActive ? "Switch plan" : "Subscribe"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <p className="text-center text-sm text-muted-foreground mt-10">
          Prefer to buy books one at a time? <Link to="/kids" className="underline">Browse the library</Link>.
        </p>
      </div>
    </div>
  );
}
