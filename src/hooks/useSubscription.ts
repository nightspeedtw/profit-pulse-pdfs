import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getPaddleEnvironment } from "@/lib/paddle";

export interface SubscriptionInfo {
  id: string;
  price_id: string;
  product_id: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  credits_per_period: number;
  credits_reset_at: string | null;
  creditsRemaining: number;
  isActive: boolean;
}

export function useSubscription(userId: string | null | undefined) {
  const [data, setData] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) { setLoading(false); setData(null); return; }
    let cancelled = false;
    const env = getPaddleEnvironment();

    const fetchIt = async () => {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .eq("environment", env)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!sub) { if (!cancelled) { setData(null); setLoading(false); } return; }

      // Compute credits used this period
      const periodStart = sub.credits_reset_at
        ? new Date(new Date(sub.credits_reset_at).getTime() - 32 * 24 * 60 * 60 * 1000).toISOString()
        : new Date(0).toISOString();
      const { data: spends } = await supabase
        .from("wallet_transactions")
        .select("id")
        .eq("user_id", userId)
        .eq("type", "sub_credit_spend")
        .gte("created_at", periodStart);
      const used = spends?.length ?? 0;

      const nowMs = Date.now();
      const endMs = sub.current_period_end ? new Date(sub.current_period_end).getTime() : Infinity;
      const isActive =
        (["active", "trialing", "past_due"].includes(sub.status) && (endMs === Infinity || endMs > nowMs)) ||
        (sub.status === "canceled" && endMs > nowMs);

      if (!cancelled) {
        setData({
          id: sub.id,
          price_id: sub.price_id,
          product_id: sub.product_id,
          status: sub.status,
          cancel_at_period_end: sub.cancel_at_period_end,
          current_period_end: sub.current_period_end,
          credits_per_period: sub.credits_per_period,
          credits_reset_at: sub.credits_reset_at,
          creditsRemaining: Math.max(0, (sub.credits_per_period ?? 0) - used),
          isActive,
        });
        setLoading(false);
      }
    };

    fetchIt();

    // Realtime: re-fetch on any subscriptions row change for this user
    const chan = supabase
      .channel(`sub-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${userId}` }, fetchIt)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "wallet_transactions", filter: `user_id=eq.${userId}` }, fetchIt)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(chan); };
  }, [userId]);

  return { subscription: data, loading };
}
