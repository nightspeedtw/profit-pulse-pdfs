// Blog autopilot v2 — 1 SEO/AEO/GEO-optimized post per invocation.
// Phase 2: strong writer (Gemini 2.5 Pro), 17-point quality gate,
// one-shot regenerate on fail, persists blog_qa_findings.
// Cost target: ~$0.03-0.05 per post (2 Gemini calls worst-case + Runware).

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateBlogHero, BlogHeroAllProvidersFailedError } from "../_shared/blog-hero-image.ts";
import { runQualityGate, type BlogDraft, type QaResult } from "../_shared/blog-quality-gate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
const _db = createClient(SUPABASE_URL, SERVICE_KEY);

const POST_TYPES = ["listicle", "product_spotlight", "seasonal", "how_to"] as const;
type PostType = typeof POST_TYPES[number];

// Strong writer model — direct Google, bypassing Lovable gateway per project law.
const WRITER_MODEL = "gemini-2.5-pro";
const WRITER_URL = `https://generativelanguage.googleapis.com/v1beta/models/${WRITER_MODEL}:generateContent?key=${GEMINI_KEY}`;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

async function callWriter(prompt: string): Promise<string> {
  const res = await fetch(WRITER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.75, maxOutputTokens: 8000, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
}

interface Product {
  id: string; title: string; price_cents: number | null;
  age_band: string | null; thumbnail_url: string | null; cover_url: string | null;
}

function buildPrompt(
  postType: PostType, keyword: string, products: Product[], today: string,
  repairNotes?: string[],
): string {
  const productList = products.map((p, i) =>
    `${i + 1}. ${p.title} — ${p.age_band ?? "kids"} — $${((p.price_cents ?? 499) / 100).toFixed(2)} — id:${p.id}`
  ).join("\n");
  const kind = {
    listicle: "a listicle gift/activity guide (numbered list of 5-8 items, each with a descriptive paragraph)",
    product_spotlight: "an editorial spotlight of ONE randomly-picked book (honest review — pros, who it's for, verdict)",
    seasonal: `a seasonal/holiday activity guide (today is ${today})`,
    how_to: "a parenting how-to article on using printable coloring pages for a concrete goal (calm-down, screen-free time, classroom, travel)",
  }[postType];

  const repair = repairNotes?.length
    ? `\n\nPREVIOUS DRAFT FAILED QUALITY GATE — FIX THESE ISSUES:\n${repairNotes.map((r) => `- ${r}`).join("\n")}\n`
    : "";

  return `You are a senior SEO/AEO editor writing for SecretPDF Kids, a printable coloring-book storefront (US/UK market). Write ${kind}.

PRIMARY KEYWORD (must appear in title, first H2, and 4-8 times in body naturally): "${keyword}"

AVAILABLE PRODUCTS (embed 2-4 relevant ones by id using [BOOK_LINK:id] inline):
${productList}

QUALITY BAR (E-E-A-T + AEO + GEO):
- 1000-1600 words of concrete, experience-informed advice
- >= 3 H2 sections and >= 1 H3 per H2 where useful
- Bullet or numbered lists in at least 2 sections
- Cite at least 2 real, widely-known authorities (American Academy of Pediatrics, CDC, Common Sense Media, UNICEF, published parenting authors) — never fabricate statistics
- Direct-answer paragraph (40-80 words) that a voice assistant / LLM can quote verbatim
- 4-6 key takeaways (single-sentence, action-oriented)
- 4-5 real parent FAQs (each answer 40-80 words)
- 2-3 sources with real https URLs from the authorities above (AAP, CDC, Common Sense Media, etc.)
- Embed 2-4 products via [BOOK_LINK:id] inline in relevant paragraphs
- Honest editorial tone. No hype ("revolutionary", "game-changing"). Max 4 exclamation marks total. No fluff openers ("in today's fast-paced world…").
- No medical/treatment claims (never say "cure", "diagnose", "treat your child").
${repair}
Return ONLY valid JSON:
{
  "title": "SEO title, <=65 chars, includes keyword",
  "dek": "1-sentence hook, <=160 chars",
  "meta_title": "<=60 chars",
  "meta_description": "120-160 chars, includes keyword",
  "category": "one of: gift-guides, activities, parenting, seasonal, reviews",
  "hero_image_prompt": "one vivid sentence for hero image, editorial, no text in image",
  "direct_answer": "40-80 word paragraph that directly answers the query implied by the keyword",
  "takeaways": ["4-6 single-sentence action takeaways"],
  "body_md": "full markdown body with ## H2 and ### H3, lists, and inline [BOOK_LINK:id] embeds",
  "faq": [{"q":"...","a":"..."}, ...],
  "secondary_keywords": ["3-5 related long-tail phrases"],
  "sources": [{"title":"...","url":"https://..."}, ...],
  "embedded_product_ids": ["uuid1","uuid2","uuid3"],
  "tags": ["3-6 topical tags"]
}`;
}

function toRepairNotes(qa: QaResult): string[] {
  return qa.findings
    .filter((f) => f.severity === "critical" || f.severity === "major")
    .slice(0, 8)
    .map((f) => `[${f.severity}] ${f.check_name}: ${f.message}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const db = _db;

    // 1. Pick least-used keyword.
    const { data: kws } = await db.from("blog_keywords")
      .select("*").order("times_used", { ascending: true })
      .order("last_used_at", { ascending: true, nullsFirst: true }).limit(1);
    const kw = kws?.[0];
    if (!kw) throw new Error("no keywords seeded");

    // 2. Pick live products.
    const { data: prods, error: prodErr } = await db.from("ebooks_kids")
      .select("id,title,price_cents,age_band,thumbnail_url,cover_url")
      .eq("listing_status", "live").eq("sellable", true).limit(30);
    if (prodErr) throw new Error(`products_query_failed: ${prodErr.message}`);
    if (!prods || prods.length < 2) throw new Error(`not enough live products (got ${prods?.length ?? 0})`);
    const shuffled = [...prods].sort(() => Math.random() - 0.5).slice(0, 8) as Product[];

    // 3. Rotate post type by day-of-year.
    const doy = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86400000);
    const postType = POST_TYPES[doy % POST_TYPES.length];
    const today = new Date().toISOString().slice(0, 10);

    // 4. Draft + quality gate. One-shot regenerate on fail.
    let draft: BlogDraft = {};
    let qa: QaResult = { score: 0, passed: false, findings: [], word_count: 0 };
    let attempts = 0;
    let repairNotes: string[] | undefined;

    for (attempts = 1; attempts <= 2; attempts++) {
      const raw = await callWriter(buildPrompt(postType, kw.keyword, shuffled, today, repairNotes));
      let parsed: BlogDraft;
      try { parsed = JSON.parse(raw) as BlogDraft; }
      catch { throw new Error(`writer_returned_non_json (attempt ${attempts})`); }

      if (!parsed.title || !parsed.body_md) {
        repairNotes = ["missing title or body_md — return the full JSON schema"];
        continue;
      }
      draft = parsed;
      qa = runQualityGate(draft);
      console.log(`[blog-autopilot] attempt=${attempts} score=${qa.score} passed=${qa.passed} findings=${qa.findings.length}`);
      if (qa.passed) break;
      repairNotes = toRepairNotes(qa);
    }

    // Enforce product-embed floor.
    const embedIds = (draft.embedded_product_ids ?? [])
      .filter((id) => shuffled.some((p) => p.id === id));
    if (embedIds.length < 2) {
      for (const p of shuffled) {
        if (embedIds.length >= 3) break;
        if (!embedIds.includes(p.id)) embedIds.push(p.id);
      }
    }

    // 5. Hero image — fail-closed provider ladder (Runware → Cloudflare → Gemini).
    // Per blog_hero_fail_closed_v1: never publish a post without a hero image.
    let heroUrl: string | null = null;
    let heroProvider: string | null = null;
    let heroError: string | null = null;
    const heroPrompt = `${draft.hero_image_prompt ?? draft.title}. Editorial magazine style, bright, kid-friendly. No text.`;
    try {
      const result = await generateBlogHero(heroPrompt);
      const ext = result.contentType === "image/png" ? "png" : "jpg";
      const path = `blog/${today}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const { error: upErr } = await db.storage.from("ebook-covers").upload(path, result.bytes, {
        contentType: result.contentType, upsert: true,
      });
      if (upErr) throw new Error(`upload_failed: ${upErr.message}`);
      heroUrl = `sb:ebook-covers/${path}`;
      heroProvider = result.provider;
    } catch (e) {
      heroError = (e as Error).message;
      console.warn("[blog-autopilot] hero ladder failed:", heroError);
      try {
        await db.from("alert_log").insert({
          alert_type: "blog_hero_all_providers_failed",
          severity: "high",
          message: heroError.slice(0, 500),
          metadata: e instanceof BlogHeroAllProvidersFailedError ? { errors: e.errors } : {},
        });
      } catch { /* alert_log optional */ }
    }

    // 6. Insert / block on critical failures OR missing hero.
    const hasCritical = qa.findings.some((f) => f.severity === "critical");
    const missingHero = !heroUrl;
    if (hasCritical || missingHero) {
      const status = "draft";
      const blockerReason = missingHero
        ? "hero_image_all_providers_failed"
        : "critical_quality_finding";
      let slug = slugify(draft.title ?? `draft-${crypto.randomUUID().slice(0, 6)}`);
      const { data: existing } = await db.from("blog_posts").select("id").eq("slug", slug).maybeSingle();
      if (existing) slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;
      const { data: post } = await db.from("blog_posts").insert({
        slug, title: draft.title, dek: draft.dek, category: draft.category,
        hero_image_url: heroUrl, body_md: draft.body_md, faq: draft.faq ?? [],
        primary_keyword: kw.keyword, secondary_keywords: draft.secondary_keywords ?? [],
        product_ids: embedIds, word_count: qa.word_count,
        meta_title: draft.meta_title, meta_description: draft.meta_description,
        direct_answer: draft.direct_answer, takeaways: draft.takeaways ?? [],
        sources: draft.sources ?? [], tags: (draft as { tags?: string[] }).tags ?? [],
        status,
      }).select().single();
      if (post) await persistFindings(db, post.id, qa);
      return jsonRes({
        ok: false, blocked: true, reason: blockerReason,
        slug: post?.slug, qa_score: qa.score, findings: qa.findings, attempts,
        hero_error: heroError,
      });
    }

    // 7. Publish.
    let slug = slugify(draft.title!);
    const { data: existing } = await db.from("blog_posts").select("id").eq("slug", slug).maybeSingle();
    if (existing) slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;

    const { data: post, error: insErr } = await db.from("blog_posts").insert({
      slug,
      title: draft.title,
      dek: draft.dek,
      category: draft.category,
      hero_image_url: heroUrl,
      body_md: draft.body_md,
      faq: draft.faq ?? [],
      primary_keyword: kw.keyword,
      secondary_keywords: draft.secondary_keywords ?? [],
      product_ids: embedIds,
      word_count: qa.word_count,
      meta_title: draft.meta_title,
      meta_description: draft.meta_description,
      direct_answer: draft.direct_answer,
      takeaways: draft.takeaways ?? [],
      sources: draft.sources ?? [],
      tags: (draft as { tags?: string[] }).tags ?? [],
      reading_time_min: Math.max(1, Math.round(qa.word_count / 220)),
      status: "published",
      published_at: new Date().toISOString(),
      last_updated_at: new Date().toISOString(),
    }).select().single();
    if (insErr) throw insErr;

    if (qa.findings.length) await persistFindings(db, post.id, qa);

    // 8. Bump keyword usage.
    await db.from("blog_keywords").update({
      times_used: (kw.times_used ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    }).eq("id", kw.id);

    return jsonRes({
      ok: true, slug: post.slug, url: `/blog/${post.slug}`,
      word_count: qa.word_count, qa_score: qa.score, attempts,
      post_type: postType, primary_keyword: kw.keyword, product_count: embedIds.length,
      findings_count: qa.findings.length,
    });
  } catch (e) {
    console.error("[blog-autopilot]", e);
    return jsonRes({ ok: false, error: (e as Error).message }, 500);
  }
});

async function persistFindings(
  db: ReturnType<typeof createClient>,
  postId: string,
  qa: QaResult,
): Promise<void> {
  if (!qa.findings.length) return;
  const rows = qa.findings.map((f) => ({
    post_id: postId,
    check_name: f.check_name,
    severity: f.severity,
    category: f.category,
    message: f.message,
    evidence: f.evidence ?? null,
    resolved: false,
  }));
  const { error } = await db.from("blog_qa_findings").insert(rows);
  if (error) console.warn("[blog-autopilot] persistFindings failed:", error.message);
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
