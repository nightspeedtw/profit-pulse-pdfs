// coloring-marketing-thumbnail — Etsy-style square (1:1) marketing card.
//
// Owner directive 2026-07-18 (etsy-marketing-thumbnail-v1): storefront
// cards must look like Etsy bestseller listings, NOT plain reduced covers.
// This function generates a square 1024×1024 marketing thumbnail via
// Runware Ideogram 3.0 (ideogram:4@1) using the book's actual cover and
// three sample interior pages as reference images. The bubble-text
// headline is baked by the model and gates through the same customer-
// visible spelling verifier that guards the cover title (the ONLY
// critical/unpublishable defect class per spelling-only-critical-v1).
//
// Composition prompt style rotates per book so the catalog looks varied
// (etsy_marketing_style_rotation_v1). All rotation variants share the
// hard requirements: page-count number, "Coloring Pages", ages badge.

// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { uploadAndSignImage } from "../_shared/versioned-assets.ts";
import { verifyExactCoverText } from "../_shared/coloring/cover-text-transcription.ts";
import { coerceForProviderPayload } from "../_shared/coloring/payload-guard.ts";
import { logAiCost, costDb } from "../_shared/cost-log.ts";

declare const Deno: any;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RUNWARE_API_KEY = Deno.env.get("RUNWARE_API_KEY");
const RUNWARE_IDEOGRAM_MODEL = "ideogram:4@1";
const CANVAS = 1024;
const MAX_ATTEMPTS = 2;

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Style rotation → variety across the 100-book catalog.
const STYLE_VARIANTS = [
  { name: "warm_coral",     bg: "warm coral pink",         layout: "cover on the left tilted -6°, three interior pages fanned to the right" },
  { name: "sunny_yellow",   bg: "bright sunny yellow",     layout: "cover centered, four interior pages fanned behind like playing cards" },
  { name: "mint_green",     bg: "fresh mint green",        layout: "cover on the right tilted +6°, three interior pages stacked to the left" },
  { name: "sky_blue",       bg: "soft sky blue",           layout: "cover top-left, three interior pages arranged in a 3-photo grid to the right" },
  { name: "lavender",       bg: "playful lavender purple", layout: "cover centered, two interior pages fanned to each side" },
  { name: "peach_cream",    bg: "warm peach cream",        layout: "cover top-center large, three interior pages in a row underneath" },
];
function pickVariant(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return STYLE_VARIANTS[Math.abs(h) % STYLE_VARIANTS.length];
}

function categoryWord(row: any): string {
  const meta = row?.metadata ?? {};
  const raw = String(
    meta.coloring_category_label
      ?? meta.coloring_theme_bible?.category
      ?? (meta.coloring_category_key ? String(meta.coloring_category_key).replace(/_/g, " ") : "")
      ?? "",
  ).trim();
  const cleaned = raw.replace(/coloring/ig, "").replace(/book/ig, "").replace(/botanical/ig, "").replace(/\s+/g, " ").trim();
  // Title-case a single friendly word for the headline.
  const first = cleaned.split(/\s+/)[0] || "Fun";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}
function ageBand(row: any): string {
  const b = String(row?.metadata?.coloring_age_band ?? row?.age_band ?? "").trim();
  return b || "4-6";
}


function buildPrompt(row: any, pageCount: number, variant: typeof STYLE_VARIANTS[number]): {
  prompt: string;
  headline: string;
  ages: string;
} {
  const cat = categoryWord(row);
  const ages = ageBand(row);
  const headline = `${pageCount} Cute ${cat} Coloring Pages`;
  const prompt = [
    "Etsy bestseller-style MARKETING THUMBNAIL for a children's coloring book.",
    "Square 1:1 full-bleed composition, no borders, no frames, no white margins.",
    `Background: solid saturated ${variant.bg}.`,
    `Layout: ${variant.layout}. The four visual assets are provided as reference images — reproduce them faithfully (do NOT redraw the cover or invent new page art).`,
    "TEXT — MUST APPEAR VERBATIM, spelled exactly, in a big bold playful bubble-lettering / marker font at the top of the card:",
    `  "${headline}"`,
    `Small round pill badge in a bottom corner reading "Ages ${ages}" in clean sans-serif.`,
    "Vibrant, high-contrast, joyful, commercial Etsy aesthetic. No adult styling, no ornate frames, no gradients that muddy the headline. Text must be legible at 200px thumbnail size.",
    "Absolutely no other text, no other numbers, no watermarks, no signatures.",
  ].join("\n");
  return { prompt, headline, ages };
}

async function generateMarketingCard(
  refs: string[],
  prompt: string,
  seedish: string,
): Promise<{ bytes: Uint8Array; provider: string; cost: number }> {
  if (!RUNWARE_API_KEY) throw new Error("provider_unconfigured:RUNWARE_API_KEY_missing");
  const taskUUID = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const task = {
    taskType: "imageInference",
    taskUUID,
    positivePrompt: prompt.slice(0, 3000),
    model: RUNWARE_IDEOGRAM_MODEL,
    width: CANVAS,
    height: CANVAS,
    numberResults: 1,
    outputType: ["URL"],
    outputFormat: "JPEG",
    includeCost: true,
    ...(refs.length > 0 ? { referenceImages: refs.slice(0, 4) } : {}),
  };
  const safe = coerceForProviderPayload(task, "runware_marketing_thumb");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch("https://api.runware.ai/v1", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${RUNWARE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify([safe]),
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(`runware_marketing_http_${res.status}:${txt.slice(0, 300)}`);
    const j = JSON.parse(txt);
    if (Array.isArray(j?.errors) && j.errors.length > 0) {
      throw new Error(`runware_marketing_errors:${JSON.stringify(j.errors).slice(0, 300)}`);
    }
    const first = (j?.data ?? [])[0];
    if (!first?.imageURL) throw new Error(`runware_marketing_no_image:${txt.slice(0, 200)}`);
    const imgRes = await fetch(first.imageURL);
    if (!imgRes.ok) throw new Error(`runware_marketing_download_${imgRes.status}`);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    return { bytes, provider: "runware_ideogram_marketing", cost: Number(first.cost ?? 0) || 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function sha16(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { ebook_id, force } = await req.json();
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: row, error } = await db.from("ebooks_kids")
      .select("id, book_type, title, cover_url, thumbnail_url, preview_page_urls, metadata")
      .eq("id", ebook_id).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: "not_found" }, 404);
    if (row.book_type !== "coloring_book") return json({ error: "wrong_lane" }, 400);
    if (!row.cover_url) return json({ error: "no_cover_url" }, 422);

    const meta = (row.metadata ?? {}) as Record<string, any>;
    const existing = meta.marketing_thumbnail_meta;
    if (!force && existing?.version === "etsy_marketing_thumb_v1" && row.thumbnail_url) {
      return json({ ok: true, skipped: "already_generated", thumbnail_url: row.thumbnail_url });
    }

    // Gather interior page URLs (up to 3) — prefer preview_page_urls, else
    // pull first three rendered pages from metadata.rendered_pages or pages table.
    let interiorRefs: string[] = Array.isArray(row.preview_page_urls) ? row.preview_page_urls.slice(0, 3) : [];
    if (interiorRefs.length < 3) {
      const { data: pages } = await db.from("ebook_assets")
        .select("url").eq("ebook_id", ebook_id).eq("kind", "coloring_page")
        .order("created_at", { ascending: true }).limit(3);
      if (Array.isArray(pages)) interiorRefs = pages.map((p: any) => p.url).filter(Boolean).slice(0, 3);
    }
    const refs = [row.cover_url, ...interiorRefs].filter(Boolean).slice(0, 4);
    const pageCount = Number(meta.coloring_page_count ?? meta.page_count ?? interiorRefs.length ?? 32) || 32;
    const variant = pickVariant(String(ebook_id));

    let lastVerdict: any = null;
    let lastBytes: Uint8Array | null = null;
    let lastProvider = ""; let totalCost = 0;
    let attempt = 0;
    let built = buildPrompt(row, pageCount, variant);
    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      const gen = await generateMarketingCard(refs, built.prompt, `${ebook_id}:${attempt}`);
      totalCost += gen.cost;
      lastProvider = gen.provider;
      lastBytes = gen.bytes;

      // Spelling verification: headline is the required token set. Ages badge
      // and category word are optional (subtitle-tier).
      const verdict = await verifyExactCoverText(gen.bytes, {
        title: built.headline,       // "32 Cute Floral Coloring Pages" → required tokens
        subtitle: "",
        ageBadge: `Ages ${built.ages}`,
      }, { timeoutMs: 20_000 });
      lastVerdict = verdict;
      if (verdict.pass) break;

      // Tighten prompt on next attempt.
      if (attempt < MAX_ATTEMPTS) {
        built = {
          ...built,
          prompt: built.prompt +
            `\n\nCRITICAL RE-TRY: previous attempt dropped/misspelled tokens: ${(verdict.missing_required ?? []).join(", ")}. Render the headline EXACTLY: "${built.headline}". Every word must appear, spelled correctly, at the top of the card.`,
        };
      }
    }

    if (!lastBytes) return json({ error: "generation_failed" }, 500);

    const hash = await sha16(lastBytes);
    const path = `kids/${ebook_id}/coloring/marketing-thumb-${Date.now()}-${hash}.jpg`;
    const up = await uploadAndSignImage(db, "ebook-covers", path, lastBytes, { contentType: "image/jpeg" });

    // COST attribution
    try {
      logAiCost(costDb(), {
        ebook_id, step: "coloring_marketing_thumbnail",
        model: RUNWARE_IDEOGRAM_MODEL, images: attempt, cost_usd: totalCost,
        provider: lastProvider,
      });
    } catch (_) { /* best effort */ }

    // Spelling gate result → if failed after MAX_ATTEMPTS, stamp
    // marketing_thumbnail_spelling_unverified so the publish contract can
    // treat it as CRITICAL. Still upload (owner may want to inspect).
    const spellingPass = lastVerdict?.pass === true;
    const nextMeta = {
      ...meta,
      marketing_thumbnail_meta: {
        version: "etsy_marketing_thumb_v1",
        canvas: { width: CANVAS, height: CANVAS },
        style_variant: variant.name,
        headline: built.headline,
        ages: built.ages,
        page_count: pageCount,
        provider: lastProvider,
        attempts: attempt,
        spelling_pass: spellingPass,
        spelling_verdict: lastVerdict,
        source_hash: hash,
        storage_path: up.path,
        signed_url: up.signedUrl,
        rendered_at: new Date().toISOString(),
      },
    };

    const updates: Record<string, any> = {
      thumbnail_url: up.signedUrl,
      metadata: nextMeta,
    };
    if (!spellingPass) {
      updates.blocker_reason =
        `marketing_thumbnail_spelling_unverified:${(lastVerdict?.missing_required ?? []).slice(0, 4).join(",")}`.slice(0, 500);
    }
    await db.from("ebooks_kids").update(updates).eq("id", ebook_id);

    return json({
      ok: true, thumbnail_url: up.signedUrl, spelling_pass: spellingPass,
      style_variant: variant.name, headline: built.headline,
      attempts: attempt, cost_usd: totalCost,
    });
  } catch (e: any) {
    console.error("[coloring-marketing-thumbnail] fatal", e?.message);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
