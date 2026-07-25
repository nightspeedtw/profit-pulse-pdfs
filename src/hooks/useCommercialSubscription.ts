// Reads the current user's commercial subscription + credit balance.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CommercialSub {
  id: string;
  plan_code: "commercial_25" | "commercial_50";
  status: string;
  credits_per_period: number;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface CommercialState {
  subscription: CommercialSub | null;
  creditBalance: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useCommercialSubscription(): CommercialState {
  const [subscription, setSubscription] = useState<CommercialSub | null>(null);
  const [creditBalance, setCreditBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) {
      setSubscription(null);
      setCreditBalance(0);
      setLoading(false);
      return;
    }
    const [{ data: sub }, { data: bal }] = await Promise.all([
      supabase
        .from("commercial_subscriptions")
        .select("id,plan_code,status,credits_per_period,current_period_end,cancel_at_period_end")
        .eq("user_id", uid)
        .in("status", ["active", "trialing", "past_due"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.rpc("commercial_credit_balance", { user_uuid: uid }),
    ]);
    setSubscription((sub as CommercialSub) ?? null);
    setCreditBalance(typeof bal === "number" ? bal : 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { subscription, creditBalance, loading, refresh: load };
}
