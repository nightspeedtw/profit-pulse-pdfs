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
        .select("id, title, subtitle, description, cover_url, thumbnail_url, price_cents, listing_status, storefront_meta, page_count, preview_page_urls, interior_illustrations, age_group_id, theme_ids, manuscript_md")
        .eq("id", id)
        .eq("listing_status", "live")
        .maybeSingle();
      if (kid) {
        const meta = (kid.storefront_meta ?? {}) as any;
        const cc = (meta.conversion_copy ?? {}) as any;
        const ap = (meta.ad_promise ?? {}) as any;
        // Resolve kids-native taxonomy from ebooks_kids scalar columns (they
        // don't use the adult ebook_kids_ages/themes join tables).
        let kidsAgeSlugs: string[] = [];
        let kidsThemeSlugs: string[] = [];
        try {
          if ((kid as any).age_group_id) {
            const { data: ag } = await supabase.from('kids_age_groups')
              .select('slug').eq('id', (kid as any).age_group_id).maybeSingle();
            if (ag?.slug) kidsAgeSlugs = [ag.slug];
          }
          const tids = Array.isArray((kid as any).theme_ids) ? (kid as any).theme_ids.filter(Boolean) : [];
          if (tids.length > 0) {
            const { data: ts } = await supabase.from('kids_themes').select('slug').in('id', tids);
            kidsThemeSlugs = (ts ?? []).map((r: any) => r.slug).filter(Boolean);
          }
        } catch (_) { /* non-fatal */ }
        // Build previews (up to 6 spreads) with actual per-page manuscript text.
        // Priority: storefront_meta.preview_pairs (canonical, set by build/repair)
        // → derive from interior_illustrations + manuscript_md split.
        function splitMd(md: string, n: number): string[] {
          const paras = (md ?? '').split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
          if (paras.length === 0 || n <= 0) return Array(n).fill('');
          const expanded = [...paras];
          while (expanded.length < n) {
            let bestIdx = -1, bestScore = 0;
            for (let i = 0; i < expanded.length; i++) {
              const words = expanded[i].split(/\s+/).filter(Boolean).length;
              const sentences = expanded[i].split(/(?<=[.!?])\s+/).filter(Boolean).length;
              const score = words + sentences * 12;
              if (words >= 12 && score > bestScore) { bestScore = score; bestIdx = i; }
            }
            if (bestIdx < 0) break;
            const text = expanded[bestIdx];
            const sents = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
            if (sents.length >= 2) {
              const mid = Math.ceil(sents.length / 2);
              expanded.splice(bestIdx, 1, sents.slice(0, mid).join(' '), sents.slice(mid).join(' '));
            } else {
              const w = text.split(/\s+/).filter(Boolean);
              const mid = Math.ceil(w.length / 2);
              expanded.splice(bestIdx, 1, w.slice(0, mid).join(' '), w.slice(mid).join(' '));
            }
          }
          const source = expanded.length >= n ? expanded : paras;
          const chunkSize = Math.max(1, Math.ceil(source.length / n));
          const out: string[] = [];
          for (let i = 0; i < n; i++) out.push(source.slice(i * chunkSize, (i + 1) * chunkSize).join(' '));
          return out;
        }
        const storedPairs = Array.isArray((meta as any).preview_pairs) ? (meta as any).preview_pairs : null;
        const illArr = Array.isArray(kid.interior_illustrations) ? (kid.interior_illustrations as any[]) : [];
        let previews: Array<{ page: number; image_url: string; text: string | null; caption: string | null }> = [];
        if (storedPairs && storedPairs.length > 0) {
          previews = storedPairs.slice(0, 6).map((p: any, i: number) => ({
            page: p.page ?? i + 3,
            image_url: p.image_url ?? '',
            text: (typeof p.text === 'string' && p.text.trim().length > 0) ? p.text : null,
            caption: null,
          })).filter((s) => s.image_url);
        } else if (illArr.length > 0) {
          const captions = splitMd(kid.manuscript_md ?? '', illArr.length);
          previews = illArr.slice(0, 6).map((r: any, i: number) => ({
            page: r?.page_number ?? i + 3,
            image_url: r?.url ?? '',
            text: (captions[i] && captions[i].trim().length > 0) ? captions[i] : (r?.scene ?? null),
            caption: null,
          })).filter((s) => s.image_url);
        }

        // Preview excerpt: prefer stored, else best 160-220 word contiguous window from manuscript_md.
        let previewExcerpt: string | null = typeof meta.preview_excerpt === 'string' && meta.preview_excerpt.trim().length > 0
          ? meta.preview_excerpt as string
          : null;
        if (!previewExcerpt && typeof kid.manuscript_md === 'string' && kid.manuscript_md.length > 0) {
          const paras = kid.manuscript_md.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
          const acc: string[] = [];
          let words = 0;
          for (const p of paras) {
            const w = p.split(/\s+/).length;
            if (words + w > 220 && acc.length > 0) break;
            acc.push(p);
            words += w;
            if (words >= 160) break;
          }
          previewExcerpt = acc.join('\n\n') || null;
        }

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
          preview_excerpt: previewExcerpt,
          persona: cc.persona ?? 'parent-warm',
          page_count: kid.page_count ?? 32,
          // extra fields not on adult schema — used by Product.tsx directly.
          _kids_preview_spreads: previews,
          _kids_total_spreads: kid.page_count ?? previews.length,
          _kids_read_aloud_minutes: cc.read_aloud_minutes ?? 6,
          _kids_ad_promise: ap ?? null,
          _kids_value_cards: (meta.value_cards ?? cc.value_cards ?? null),
          _kids_age_slugs: kidsAgeSlugs,
          _kids_theme_slugs: kidsThemeSlugs,
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
      // Kids fallback rows carry `_kids_preview_spreads` etc — prefer those
      // over the adult inside_illustrations_json path.
      if (Array.isArray(row._kids_preview_spreads)) {
        preview_spreads = row._kids_preview_spreads;
        preview_images = row._kids_preview_spreads.map((s: any) => s.image_url).filter(Boolean);
        total_spreads = row._kids_total_spreads ?? preview_spreads.length;
      }
      const { inside_illustrations_json, _kids_preview_spreads, _kids_total_spreads, _kids_read_aloud_minutes, _kids_ad_promise, _kids_value_cards, ...rest } = row;
      return {
        ...rest,
        preview_images,
        preview_spreads,
        total_spreads,
        age_group_slugs: ageBy[row.id] ?? [],
        theme_slugs: themeBy[row.id] ?? [],
        read_aloud_minutes: _kids_read_aloud_minutes ?? null,
        ad_promise: _kids_ad_promise ?? null,
        value_cards: _kids_value_cards ?? null,
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
