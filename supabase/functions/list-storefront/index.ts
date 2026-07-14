// Public storefront listing — returns ebooks marked as listed for sale. (redeploy v2)
// Supports optional kids-taxonomy filters (age, themes), bestseller flag, and sort order.
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
    const age = url.searchParams.get("age"); // age group slug (e.g. "4-6")
    const themesParam = url.searchParams.get("themes"); // comma-separated theme slugs
    const bestseller = url.searchParams.get("bestseller"); // "true"
    const seriesId = url.searchParams.get("series_id");
    const sort = url.searchParams.get("sort"); // "new" (default) | "sales"
    const categorySlug = url.searchParams.get("category_slug"); // exact category_slug match

    // Resolve taxonomy filters into a list of ebook ids (intersection semantics)
    let taxonomyIds: string[] | null = null;

    if (age) {
      const { data: ag } = await supabase
        .from("kids_age_groups")
        .select("id")
        .eq("slug", age)
        .maybeSingle();
      if (ag) {
        const { data: rows } = await supabase
          .from("ebook_kids_ages")
          .select("ebook_id")
          .eq("age_group_id", ag.id);
        const ids = (rows ?? []).map((r: any) => r.ebook_id);
        taxonomyIds = taxonomyIds ? taxonomyIds.filter((x) => ids.includes(x)) : ids;
      } else {
        taxonomyIds = [];
      }
    }

    if (themesParam) {
      const themeSlugs = themesParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (themeSlugs.length > 0) {
        const { data: themes } = await supabase
          .from("kids_themes")
          .select("id")
          .in("slug", themeSlugs);
        const themeIds = (themes ?? []).map((t: any) => t.id);
        if (themeIds.length === 0) {
          taxonomyIds = [];
        } else {
          const { data: rows } = await supabase
            .from("ebook_kids_themes")
            .select("ebook_id")
            .in("theme_id", themeIds);
          const ids = Array.from(new Set((rows ?? []).map((r: any) => r.ebook_id)));
          taxonomyIds = taxonomyIds ? taxonomyIds.filter((x) => ids.includes(x)) : ids;
        }
      }
    }

    let query = supabase
      .from("ebooks")
      .select("id, title, price, cover_url, store_thumbnail_url, product_description, selling_hook, short_hook, shopping_card_description, long_description, benefit_bullets, key_benefits, who_it_is_for, what_you_get, preview_blurb, category_slug, listing_status, product_type, seo_title, seo_meta, tags, sales_count, listed_at, inside_illustrations_json, is_bestseller, series_id, cliffhanger_hook, preview_page_count, hook_description")
      .not("listed_at", "is", null)
      .not("pdf_url", "is", null)
      .not("price", "is", null)
      .limit(limit);

    if (sort === "sales") {
      query = query.order("sales_count", { ascending: false }).order("listed_at", { ascending: false });
    } else {
      query = query.order("listed_at", { ascending: false });
    }

    if (id) query = query.eq("id", id);
    if (category) query = query.eq("product_type", category);
    if (categorySlug) query = query.eq("category_slug", categorySlug);
    if (bestseller === "true") query = query.eq("is_bestseller", true);
    if (seriesId) query = query.eq("series_id", seriesId);
    if (q) query = query.ilike("title", `%${q}%`);
    if (taxonomyIds !== null) {
      if (taxonomyIds.length === 0) {
        return new Response(JSON.stringify({ items: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      query = query.in("id", taxonomyIds);
    }

    let { data, error } = await query;
    if (error) throw error;

    // Kids fallback: if we're looking up a single id and it's not in the adult
    // ebooks table, look it up in ebooks_kids and shape the response to match.
    if (id && (!data || data.length === 0)) {
      const { data: kid } = await supabase
        .from("ebooks_kids")
        .select("id, title, subtitle, description, cover_url, thumbnail_url, price_cents, listing_status, storefront_meta, page_count, preview_page_urls, interior_illustrations, age_group_id, theme_ids")
        .eq("id", id)
        .eq("listing_status", "live")
        .maybeSingle();
      if (kid) {
        const meta = (kid.storefront_meta ?? {}) as any;
        const cc = (meta.conversion_copy ?? {}) as any;
        const ap = (meta.ad_promise ?? {}) as any;
        const previews = Array.isArray(kid.interior_illustrations)
          ? (kid.interior_illustrations as any[]).slice(0, 4).map((r, i) => ({
              page: r?.page_number ?? i + 3,
              image_url: r?.url ?? '',
              text: r?.scene ?? null,
              caption: null,
            })).filter((s) => s.image_url)
          : [];
        data = [{
          id: kid.id,
          title: kid.title,
          subtitle: kid.subtitle,
          price: (kid.price_cents ?? 799) / 100,
          cover_url: kid.cover_url,
          store_thumbnail_url: kid.thumbnail_url,
          product_description: cc.product_description ?? kid.description,
          selling_hook: cc.selling_hook ?? null,
          short_hook: cc.short_hook ?? null,
          shopping_card_description: cc.shopping_card_description ?? null,
          preview_blurb: cc.preview_blurb ?? null,
          benefit_bullets: cc.benefit_bullets ?? [],
          key_benefits: cc.benefit_bullets ?? [],
          who_it_is_for: ap.theme ? `Perfect for a child working on: ${ap.theme}` : null,
          what_you_get: [],
          long_description: cc.product_description ?? kid.description,
          category_slug: 'children_illustrated',
          listing_status: kid.listing_status,
          product_type: 'children_illustrated',
          seo_title: kid.title,
          seo_meta: cc.short_hook ?? kid.description,
          tags: ap.theme ? [ap.theme] : [],
          sales_count: 0,
          listed_at: null,
          inside_illustrations_json: null,
          is_bestseller: false,
          series_id: null,
          cliffhanger_hook: null,
          preview_page_count: previews.length,
          hook_description: cc.selling_hook ?? null,
          // extra fields not on adult schema — used by Product.tsx directly.
          _kids_preview_spreads: previews,
          _kids_total_spreads: kid.page_count ?? previews.length,
          _kids_read_aloud_minutes: cc.read_aloud_minutes ?? null,
          _kids_ad_promise: ap ?? null,
        }] as any;
      }
    }

    // Fetch taxonomy for the returned rows so the frontend can render badges.
    const rowIds = (data ?? []).map((r: any) => r.id);
    let ageBy: Record<string, string[]> = {};
    let themeBy: Record<string, string[]> = {};
    if (rowIds.length > 0) {
      const [{ data: ea }, { data: et }] = await Promise.all([
        supabase
          .from("ebook_kids_ages")
          .select("ebook_id, kids_age_groups(slug, label_th)")
          .in("ebook_id", rowIds),
        supabase
          .from("ebook_kids_themes")
          .select("ebook_id, kids_themes(slug, label_th)")
          .in("ebook_id", rowIds),
      ]);
      for (const r of ea ?? []) {
        const slug = (r as any).kids_age_groups?.slug;
        if (!slug) continue;
        (ageBy[(r as any).ebook_id] ||= []).push(slug);
      }
      for (const r of et ?? []) {
        const slug = (r as any).kids_themes?.slug;
        if (!slug) continue;
        (themeBy[(r as any).ebook_id] ||= []).push(slug);
      }
    }

    const items = (data ?? []).map((row: any) => {
      const raw = row.inside_illustrations_json;
      let preview_images: string[] = [];
      let preview_spreads: Array<{ page: number; image_url: string; text: string | null; caption: string | null }> = [];
      let total_spreads = 0;
      if (raw && typeof raw === "object") {
        const entries = Object.entries(raw)
          .map(([k, v]: any) => [Number(k), v] as [number, any])
          .filter(([n, v]) => Number.isFinite(n) && v && typeof v === "object")
          .sort(([a], [b]) => a - b);
        total_spreads = entries.length;
        preview_images = entries
          .map(([, v]) => v?.url)
          .filter((u: any): u is string => typeof u === "string" && u.length > 0)
          .slice(0, 4);
        preview_spreads = entries
          .filter(([, v]) => typeof v?.url === "string" && v.url.length > 0)
          .map(([page, v]) => ({
            page,
            image_url: v.url as string,
            text: typeof v.text === "string" ? v.text : null,
            caption: typeof v.caption === "string" ? v.caption : null,
          }));
      }
      const { inside_illustrations_json, ...rest } = row;
      return {
        ...rest,
        preview_images,
        preview_spreads,
        total_spreads,
        age_group_slugs: ageBy[row.id] ?? [],
        theme_slugs: themeBy[row.id] ?? [],
      };
    });
    return new Response(JSON.stringify({ items }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message, items: [] }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
