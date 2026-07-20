// useSuggestedBundle — returns the best current live bundle containing this
// product. Prefers the newest live bundle including the product id.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SuggestedBundle {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  ageBand: string;
  memberIds: string[];
  bundlePriceCents: number;
  membersTotalCents: number;
  savingsCents: number;
  savingsPct: number;
  coverUrls: string[];
}

export function useSuggestedBundle(productId: string | null | undefined): SuggestedBundle | null {
  const [bundle, setBundle] = useState<SuggestedBundle | null>(null);

  useEffect(() => {
    if (!productId) { setBundle(null); return; }
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = supabase.from("bundles");
      const { data } = await q
        .select("id, slug, title, subtitle, age_band, member_ids, bundle_price_cents, members_total_cents, savings_cents, savings_pct, cover_urls, created_at")
        .eq("status", "live")
        .contains("member_ids", [productId])
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const row = ((data ?? [])[0]) as any;
      if (!row) { setBundle(null); return; }
      setBundle({
        id: row.id,
        slug: row.slug,
        title: row.title,
        subtitle: row.subtitle,
        ageBand: row.age_band,
        memberIds: row.member_ids ?? [],
        bundlePriceCents: Number(row.bundle_price_cents),
        membersTotalCents: Number(row.members_total_cents),
        savingsCents: Number(row.savings_cents),
        savingsPct: Number(row.savings_pct),
        coverUrls: Array.isArray(row.cover_urls) ? row.cover_urls : [],
      });
    })();
    return () => { cancelled = true; };
  }, [productId]);

  return bundle;
}
