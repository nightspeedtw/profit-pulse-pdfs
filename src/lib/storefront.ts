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
}


const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/list-storefront`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export async function fetchStorefront(opts: {
  limit?: number;
  category?: string;
  q?: string;
  id?: string;
} = {}): Promise<StorefrontEbook[]> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.category) params.set("category", opts.category);
  if (opts.q) params.set("q", opts.q);
  if (opts.id) params.set("id", opts.id);
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
