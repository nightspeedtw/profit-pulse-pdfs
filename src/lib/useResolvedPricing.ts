// Marketing Autopilot — client-side hook that pulls authoritative prices
// from `product_pricing`. Batch-fetches once per bookIds set. Never
// synthesizes prices. When no row exists (rare — backfill seeds them all),
// the caller's raw price_cents is used as a safe fallback.
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ResolvedPriceRow {
  regularCents: number;
  campaignCents: number | null;
  effectiveCents: number;
  source: "campaign" | "regular";
  campaignValidTo: string | null;
}

export type ResolvedPriceMap = Record<string, ResolvedPriceRow>;

/** Read authoritative prices for a batch of ebook_kids ids. */
export function useResolvedKidsPrices(ids: string[]): ResolvedPriceMap {
  const [map, setMap] = useState<ResolvedPriceMap>({});
  const cacheRef = useRef<Set<string>>(new Set());

  const key = useMemo(() => {
    const uniq = Array.from(new Set(ids.filter(Boolean))).sort();
    return uniq.join(",");
  }, [ids]);

  useEffect(() => {
    const missing = key
      ? key.split(",").filter((id) => !cacheRef.current.has(id))
      : [];
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = supabase.from("product_pricing");
      const { data } = await q
        .select("product_id, regular_price_cents, campaign_price_cents, effective_price_cents, active_campaign_id, campaign_valid_from, campaign_valid_to")
        .eq("product_kind", "ebook_kids")
        .eq("market", "US")
        .in("product_id", missing);
      if (cancelled || !data) return;
      const now = Date.now();
      const patch: ResolvedPriceMap = {};
      for (const r of data as Array<Record<string, unknown>>) {
        const validFrom = r.campaign_valid_from ? new Date(r.campaign_valid_from as string).getTime() : null;
        const validTo = r.campaign_valid_to ? new Date(r.campaign_valid_to as string).getTime() : null;
        const inWindow =
          r.active_campaign_id != null &&
          r.campaign_price_cents != null &&
          validFrom != null && validTo != null &&
          validFrom <= now && validTo > now;
        const regular = Math.max(500, Number(r.regular_price_cents ?? 0));
        const campaign = inWindow ? Math.max(199, Number(r.campaign_price_cents ?? 0)) : null;
        const effective = campaign != null && campaign < regular ? campaign : regular;
        patch[r.product_id as string] = {
          regularCents: regular,
          campaignCents: campaign,
          effectiveCents: effective,
          source: effective < regular ? "campaign" : "regular",
          campaignValidTo: inWindow ? (r.campaign_valid_to as string) : null,
        };
      }
      for (const id of missing) cacheRef.current.add(id);
      setMap((prev) => ({ ...prev, ...patch }));
    })();
    return () => { cancelled = true; };
  }, [key]);

  return map;
}
