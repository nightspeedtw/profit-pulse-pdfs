// useActiveCampaign — resolves the highest-priority live campaign for a
// given ebook_kids product. Returns null when no active campaign exists.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ActiveCampaignInfo {
  campaignId: string;
  campaignSlug: string;
  campaignName: string;
  seasonKey: string | null;
  campaignPriceCents: number;
  compareAtCents: number | null;
  savingsPct: number;
  endsAt: string;
}

export function useActiveCampaign(productId: string | null | undefined): ActiveCampaignInfo | null {
  const [info, setInfo] = useState<ActiveCampaignInfo | null>(null);

  useEffect(() => {
    if (!productId) { setInfo(null); return; }
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = supabase.from("campaign_products");
      const { data } = await q
        .select("campaign_id, campaign_price_cents, compare_at_cents, compare_at_valid, campaigns:campaign_id(id, slug, name, season_key, status, ends_at, priority)")
        .eq("product_kind", "ebook_kids")
        .eq("product_id", productId)
        .eq("market", "US");
      if (cancelled) return;
      const rows = ((data ?? []) as any[])
        .filter((r) => r.campaigns?.status === "live")
        .sort((a, b) => (a.campaigns?.priority ?? 999) - (b.campaigns?.priority ?? 999));
      if (rows.length === 0) { setInfo(null); return; }
      const r = rows[0];
      const compare = r.compare_at_valid ? Number(r.compare_at_cents ?? 0) : null;
      const savingsPct = compare && compare > 0
        ? Math.round(((compare - r.campaign_price_cents) / compare) * 100)
        : 0;
      setInfo({
        campaignId: r.campaign_id,
        campaignSlug: r.campaigns.slug,
        campaignName: r.campaigns.name,
        seasonKey: r.campaigns.season_key,
        campaignPriceCents: Number(r.campaign_price_cents),
        compareAtCents: compare,
        savingsPct,
        endsAt: r.campaigns.ends_at,
      });
    })();
    return () => { cancelled = true; };
  }, [productId]);

  return info;
}
