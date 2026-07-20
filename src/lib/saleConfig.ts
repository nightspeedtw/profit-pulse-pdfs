// Sitewide sale config — read from platform_settings.storefront_sale_config
// Owner-controlled. Never fabricate a sale end date; if `ends_at` is null,
// hide the countdown copy but still show the sale price.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SaleConfig {
  enabled: boolean;
  discount_pct: number | null;
  ends_at: string | null; // ISO
  banner_text: string | null;
}

const DEFAULT: SaleConfig = { enabled: false, discount_pct: null, ends_at: null, banner_text: null };

let cached: { at: number; value: SaleConfig } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function loadSaleConfig(): Promise<SaleConfig> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const { data } = await supabase
    .from("platform_settings" as never)
    .select("value_json")
    .eq("key", "storefront_sale_config")
    .maybeSingle();
  const row = data as { value_json: SaleConfig | null } | null;
  const value = { ...DEFAULT, ...(row?.value_json ?? {}) } as SaleConfig;
  cached = { at: Date.now(), value };
  return value;
}

export function useSaleConfig(): SaleConfig | null {
  const [cfg, setCfg] = useState<SaleConfig | null>(cached?.value ?? null);
  useEffect(() => {
    let cancelled = false;
    loadSaleConfig().then((v) => { if (!cancelled) setCfg(v); });
    return () => { cancelled = true; };
  }, []);
  return cfg;
}

export function formatSaleEnds(ends_at: string | null): string | null {
  if (!ends_at) return null;
  const d = new Date(ends_at);
  if (Number.isNaN(d.getTime()) || d.getTime() < Date.now()) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
