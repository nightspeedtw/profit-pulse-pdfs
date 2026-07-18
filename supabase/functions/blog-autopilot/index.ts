// Blog autopilot — generates 1 SEO/GEO-optimized post per invocation.
// Rotates post types (listicle, product-spotlight, seasonal, how-to),
// pulls the least-used keyword from blog_keywords, embeds 2-4 live
// coloring products, generates a hero image via Runware.
// Cost target: ~$0.01-0.02 per post (Gemini flash-lite text + Runware image).

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { runwareInference, RUNWARE_MODELS } from "../_shared/runware.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
// Module-scope singleton client (reused across warm invocations).
const _db = createClient(SUPABASE_URL, SERVICE_KEY);

const POST_TYPES = ["listicle", "product_spotlight", "seasonal", "how_to"] as const;
type PostType = typeof POST_TYPES[number];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

async function callGemini(prompt: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 4000, responseMimeType: "application/json" },
      }),
    },
  );
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
}

function buildPrompt(postType: PostType, keyword: string, products: any[], today: string): string {
  const productList = products.map((p, i) =>
    `${i + 1}. ${p.title} — ${p.age_band ?? "kids"} — $${((p.price_cents ?? 499) / 100).toFixed(2)} — id:${p.id}`
  ).join("\n");
  const kind = {
    listicle: "a listicle-style gift/activity guide (numbered list of 5-8 items, each with a short description)",
    product_spotlight: "a platform-review spotlight of ONE random book (honest editorial review — pros, who it's for, verdict)",
    seasonal: `a seasonal/holiday activity guide (today is ${today})`,
    how_to: "a parenting how-to article on using printable coloring pages for a real goal (calm-down, screen-free time, classroom, etc.)",
  }[postType];
  return `You are an SEO editor writing for SecretPDF Kids, a printable coloring-book storefront (US/UK market). Write ${kind}.

PRIMARY KEYWORD (must appear in title, H1, and 2-3 times in body naturally): "${keyword}"

AVAILABLE PRODUCTS TO LINK (embed 2-4 relevant ones by id):
${productList}

REQUIREMENTS (GEO/AI-citation optimized):
- 900-1400 words
- Clear H2/H3 hierarchy, scannable bullet lists
- Cite at least 2 concrete statistics or expert quotes (fabricated stats are forbidden — use widely-known ones like "American Academy of Pediatrics recommends...")
- Include an FAQ section with 3-5 real parent questions
- Include 2-4 product embeds by referencing product ids in embedded_product_ids
- Honest tone, no hype, no exclamation-mark spam

Return ONLY valid JSON:
{
  "title": "SEO title, <65 chars, includes keyword",
  "dek": "1-sentence hook, <160 chars",
  "meta_description": "<160 chars, includes keyword",
  "category": "one of: gift-guides, activities, parenting, seasonal, reviews",
  "hero_image_prompt": "vivid 1 sentence prompt for hero image, kid-friendly, no text in image",
  "body_md": "full markdown body with ## H2 and ### H3 headings, lists, and inline product mentions like [BOOK_LINK:{id}] where a product should be embedded",
  "faq": [{"q":"...","a":"..."}, ...],
  "secondary_keywords": ["3 related long-tail phrases"],
  "embedded_product_ids": ["uuid1","uuid2","uuid3"]
}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1. Pick least-used keyword.
    const { data: kws } = await db.from("blog_keywords")
      .select("*").order("times_used", { ascending: true }).order("last_used_at", { ascending: true, nullsFirst: true })
      .limit(1);
    const kw = kws?.[0];
    if (!kw) throw new Error("no keywords seeded");

    // 2. Pick live products (random 6, filter down).
    const { data: prods, error: prodErr } = await db.from("ebooks_kids")
      .select("id,title,price_cents,age_band,thumbnail_url,cover_url")
      .eq("listing_status", "live").eq("sellable", true).limit(30);
    console.log(`[blog-autopilot] live products query: count=${prods?.length ?? 0} err=${prodErr?.message ?? "none"}`);
    if (prodErr) throw new Error(`products_query_failed: ${prodErr.message}`);
    if (!prods || prods.length < 2) throw new Error(`not enough live products (got ${prods?.length ?? 0})`);
    const shuffled = [...prods].sort(() => Math.random() - 0.5).slice(0, 6);

    // 3. Rotate post type by day-of-year.
    const doy = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86400000);
    const postType = POST_TYPES[doy % POST_TYPES.length];
    const today = new Date().toISOString().slice(0, 10);

    // 4. Generate content.
    const raw = await callGemini(buildPrompt(postType, kw.keyword, shuffled, today));
    const parsed = JSON.parse(raw);
    if (!parsed.title || !parsed.body_md) throw new Error("generator returned invalid shape");

    // 5. Enforce product-embed gate.
    const embedIds: string[] = (parsed.embedded_product_ids ?? []).filter((id: string) =>
      shuffled.some((p) => p.id === id));
    if (embedIds.length < 2) {
      // Fallback: force-embed first 3 shuffled products.
      embedIds.push(...shuffled.slice(0, 3).map((p) => p.id).filter((id) => !embedIds.includes(id)));
    }
    if (embedIds.length < 2) throw new Error("blog_gate_failed: fewer than 2 product embeds");

    // 6. Generate hero image (Runware, ~$0.002).
    let heroUrl: string | null = null;
    try {
      const bytes = await runwareInference({
        prompt: `${parsed.hero_image_prompt}. Editorial magazine style, bright, kid-friendly. No text.`,
        image_size: "landscape_16_9",
        model: RUNWARE_MODELS.line_art,
        step: "blog_hero",
      });
      const path = `blog/${today}-${crypto.randomUUID().slice(0, 8)}.jpg`;
      const { error: upErr } = await db.storage.from("ebook-covers").upload(path, bytes, {
        contentType: "image/jpeg", upsert: true,
      });
      if (!upErr) {
        const { data: signed } = await db.storage.from("ebook-covers")
          .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
        heroUrl = signed?.signedUrl ?? null;
      }
    } catch (e) {
      console.warn("[blog-autopilot] hero image failed:", (e as Error).message);
    }

    // 7. Insert post.
    let slug = slugify(parsed.title);
    // Ensure unique
    const { data: existing } = await db.from("blog_posts").select("id").eq("slug", slug).maybeSingle();
    if (existing) slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;

    const wc = (parsed.body_md as string).split(/\s+/).length;
    const { data: post, error: insErr } = await db.from("blog_posts").insert({
      slug,
      title: parsed.title,
      dek: parsed.dek,
      category: parsed.category,
      hero_image_url: heroUrl,
      body_md: parsed.body_md,
      faq: parsed.faq ?? [],
      primary_keyword: kw.keyword,
      secondary_keywords: parsed.secondary_keywords ?? [],
      product_ids: embedIds,
      word_count: wc,
      meta_description: parsed.meta_description,
      status: "published",
      published_at: new Date().toISOString(),
    }).select().single();
    if (insErr) throw insErr;

    // 8. Bump keyword usage.
    await db.from("blog_keywords").update({
      times_used: (kw.times_used ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    }).eq("id", kw.id);

    return new Response(JSON.stringify({
      ok: true, slug: post.slug, url: `/blog/${post.slug}`, word_count: wc,
      post_type: postType, primary_keyword: kw.keyword, product_count: embedIds.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[blog-autopilot]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
