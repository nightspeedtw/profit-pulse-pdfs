import { supabase } from "@/integrations/supabase/client";

export interface StorefrontEbook {
  id: string;
  title: string;
  price: number | null;
  cover_url: string | null;
  store_thumbnail_url: string | null;
  product_description: string | null;
  selling_hook: string | null;
  short_hook: string | null;
  shopping_card_description: string | null;
  long_description: string | null;
  benefit_bullets: string[] | null;
  key_benefits: string[] | null;
  who_it_is_for: string | null;
  what_you_get: string[] | null;
  preview_blurb: string | null;
  category_slug: string | null;
  listing_status: string | null;
  product_type: string | null;
  seo_title: string | null;
  seo_meta: string | null;
  tags: string[] | null;
  sales_count: number;
  listed_at: string | null;
  preview_images: string[] | null;
  preview_spreads?: PreviewSpread[] | null;
  total_spreads?: number;
  cliffhanger_hook?: string | null;
  preview_page_count?: number | null;
  hook_description?: string | null;
  is_bestseller?: boolean;
  series_id?: string | null;
  age_group_slugs?: string[];
  theme_slugs?: string[];
  read_aloud_minutes?: number | null;
  ad_promise?: { theme?: string; hook_line?: string; primary_benefit?: string } | null;
  preview_excerpt?: string | null;
  persona?: string | null;
  page_count?: number | null;
  value_cards?: {
    whats_inside?: string[];
    why_kids_love_it?: string[];
    perfect_for?: string[];
  } | null;
}

export interface PreviewSpread {
  page: number;
  image_url: string;
  text: string | null;
  caption: string | null;
}

export interface FetchStorefrontOpts {
  limit?: number;
  category?: string;
  category_slug?: string;
  q?: string;
  id?: string;
  age?: string;
  themes?: string;
  bestseller?: boolean;
  series_id?: string;
  sort?: "new" | "sales";
}

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/list-storefront`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export async function fetchStorefront(opts: FetchStorefrontOpts = {}): Promise<StorefrontEbook[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, typeof v === "boolean" ? String(v) : String(v));
  }
  const res = await fetch(`${FN_URL}?${params.toString()}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error || "Failed to load products");
  return (j.items ?? []) as StorefrontEbook[];
}

export async function fetchStorefrontById(id: string): Promise<StorefrontEbook | null> {
  const items = await fetchStorefront({ id, limit: 1 });
  return items[0] ?? null;
}

export function priceLabel(e: Pick<StorefrontEbook, "price">): string {
  return e.price != null ? `$${Number(e.price).toFixed(2)}` : "—";
}
