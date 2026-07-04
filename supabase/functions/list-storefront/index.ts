// Public storefront listing — returns ebooks marked as listed for sale.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/stripe.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 50));
    const category = url.searchParams.get("category");
    const q = url.searchParams.get("q");
    const id = url.searchParams.get("id");

    let query = supabase
      .from("ebooks")
      .select("id, title, price, cover_url, product_description, selling_hook, short_hook, shopping_card_description, long_description, benefit_bullets, key_benefits, who_it_is_for, what_you_get, preview_blurb, category_slug, listing_status, product_type, seo_title, seo_meta, tags, sales_count, listed_at")
      .not("listed_at", "is", null)
      .not("pdf_url", "is", null)
      .not("price", "is", null)
      .order("listed_at", { ascending: false })
      .limit(limit);

    if (id) query = query.eq("id", id);
    if (category) query = query.eq("product_type", category);

    if (q) query = query.ilike("title", `%${q}%`);

    const { data, error } = await query;
    if (error) throw error;
    return new Response(JSON.stringify({ items: data ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message, items: [] }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
