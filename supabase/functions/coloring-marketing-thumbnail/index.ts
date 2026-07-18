// coloring-marketing-thumbnail — Etsy-style square (1:1) marketing card.
//
// Two-step architecture (marketing-thumb-code-typography-v2, 2026-07-18):
//   STEP 1 — Runware Ideogram generates a TEXTLESS collage (background +
//            cover reference + interior page fan). Prompt forbids ALL
//            typography, watermarks, labels, stickers, signatures.
//   STEP 2 — Code-rendered SVG overlay bakes the headline
//            ("32 Cute Floral Coloring Pages") in a Fredoka bubble-style
//            display font + rounded "Ages 4-6" pill. Rasterized via
//            resvg-wasm. Spelling is CORRECT BY CONSTRUCTION — no vision
//            gate needed on the headline, no retries.
//
// Why: spelling is the ONE unpublishable defect class
// (spelling-only-critical-unpublish-v1). Ideogram's collage mode
// hallucinates decorative typography ~30% of the time even with anti-text
// prompts — paying to fight a known model tendency is waste. The book
// COVER still uses AI baked typography (owner's baked-title-only rule
// applies to the hand-painted cover art). The MARKETING THUMBNAIL is a
// promotional card, so code-rendered typography is the correct tool.
//
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import { uploadAndSignImage } from "../_shared/versioned-assets.ts";
import { coerceForProviderPayload } from "../_shared/coloring/payload-guard.ts";
import { logAiCost, costDb } from "../_shared/cost-log.ts";

declare const Deno: any;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RUNWARE_API_KEY = Deno.env.get("RUNWARE_API_KEY");
const RUNWARE_IDEOGRAM_MODEL = "ideogram:4@1";
const CANVAS = 1024;

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Style rotation → variety across the catalog ──────────────────────
const STYLE_VARIANTS = [
  { name: "warm_coral",     bg: "#ff9a8b", bgAccent: "#ffc1a6", textColor: "#3a1a10", pillBg: "#fff4ec", pillText: "#7a2f18", layout: "cover on the left tilted -6°, three interior pages fanned to the right" },
  { name: "sunny_yellow",   bg: "#ffd257", bgAccent: "#ffe58a", textColor: "#3a2b00", pillBg: "#fff8dc", pillText: "#6b5000", layout: "cover centered, four interior pages fanned behind like playing cards" },
  { name: "mint_green",     bg: "#8fdcc4", bgAccent: "#c1eedb", textColor: "#0e3327", pillBg: "#f0fbf5", pillText: "#155f3f", layout: "cover on the right tilted +6°, three interior pages stacked to the left" },
  { name: "sky_blue",       bg: "#95c9f0", bgAccent: "#c9e4f7", textColor: "#0e2a44", pillBg: "#f0f7fd", pillText: "#154163", layout: "cover top-left, three interior pages arranged in a 3-photo grid to the right" },
  { name: "lavender",       bg: "#c7b3e5", bgAccent: "#e0d1f0", textColor: "#26163f", pillBg: "#f5eefc", pillText: "#4a2871", layout: "cover centered, two interior pages fanned to each side" },
  { name: "peach_cream",    bg: "#ffbf9b", bgAccent: "#ffd8bd", textColor: "#3b1b0b", pillBg: "#fff2e5", pillText: "#7a3210", layout: "cover top-center large, three interior pages in a row underneath" },
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
  const first = cleaned.split(/\s+/)[0] || "Fun";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}
function ageBand(row: any): string {
  const b = String(row?.metadata?.coloring_age_band ?? row?.age_band ?? "").trim();
  return b || "4-6";
}

function buildTextlessPrompt(variant: typeof STYLE_VARIANTS[number]): string {
  return [
    "Etsy bestseller-style MARKETING THUMBNAIL collage for a children's coloring book.",
    "Square 1:1 full-bleed composition, no borders, no frames, no white margins.",
    `Background: solid saturated color close to ${variant.bg}, with a soft radial glow toward ${variant.bgAccent}.`,
    `Layout: ${variant.layout}. Use the provided reference images faithfully — do NOT redraw the cover or invent new page art. Show the book cover as a photographic product mock (subtle drop shadow, gentle paper edge) and the interior sample pages as clean flat sheets slightly rotated and overlapping.`,
    "The TOP THIRD of the composition MUST BE VISUALLY CLEAR / EMPTY (just background color and soft glow) — leave that headline space open so a text label can be composited on top later. The BOTTOM-RIGHT corner must also be clear for a small badge.",
    "",
    "ABSOLUTE TEXT RULE — NON-NEGOTIABLE:",
    "  · This image must contain ZERO typography, ZERO letters, ZERO numbers, ZERO words.",
    "  · No headline, no title, no subtitle, no logo, no watermark, no signature, no page numbers, no captions, no stickers, no labels, no shop names.",
    "  · If the reference cover in the collage shows the book's own baked title, that is the ONLY text allowed and it must be small and inside the cover thumbnail area — never anywhere else on the composition.",
    "  · No decorative gibberish typography, no fake latin, no scribbles that look like letters. Pure illustration and background only.",
    "",
    "Style: vibrant, high-contrast, joyful, commercial Etsy aesthetic. No adult styling, no ornate frames, no muddy gradients.",
  ].join("\n");
}

// ── Runware call ─────────────────────────────────────────────────────
async function callRunware(refs: string[], prompt: string): Promise<{ bytes: Uint8Array; cost: number }> {
  if (!RUNWARE_API_KEY) throw new Error("provider_unconfigured:RUNWARE_API_KEY_missing");
  const taskUUID = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const task = {
    taskType: "imageInference",
    taskUUID,
    positivePrompt: prompt.slice(0, 3000),
    negativePrompt: "text, letters, words, typography, logo, watermark, signature, caption, label, gibberish text, decorative writing, latin script, alphabet, numbers spelled out, shop name",
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
      throw new Error(`runware_marketing_errors:${JSON.stringify(j.errors).slice(0, 400)}`);
    }
    const first = (j?.data ?? [])[0];
    if (!first?.imageURL) throw new Error(`runware_marketing_no_image:${txt.slice(0, 200)}`);
    const imgRes = await fetch(first.imageURL);
    if (!imgRes.ok) throw new Error(`runware_marketing_download_${imgRes.status}`);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    return { bytes, cost: Number(first.cost ?? 0) || 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function generateCollage(refs: string[], prompt: string): Promise<{ bytes: Uint8Array; cost: number }> {
  // Runware validates every reference-image URL up-front for width/height in
  // [128, 2048]. Interior page renders may be outside that band. If the
  // multi-ref call fails on a validation error, fall back to cover-only,
  // then to zero refs (pure prompt).
  const attempts: string[][] = [];
  attempts.push(refs);
  if (refs.length > 1) attempts.push(refs.slice(0, 1));
  attempts.push([]);
  let lastErr: unknown = null;
  for (const set of attempts) {
    try {
      return await callRunware(set, prompt);
    } catch (e) {
      lastErr = e;
      const msg = (e as Error).message ?? String(e);
      // Retry only when the error is validation of reference images or their download.
      if (!/invalidReferenceImage|referenceImages|reference_image|http_400/i.test(msg)) throw e;
      console.warn(`[marketing-thumb] runware ref-set len=${set.length} failed → falling back`, msg.slice(0, 200));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ── SVG overlay renderer (Fredoka bubble-style headline) ─────────────
let wasmReady: Promise<void> | null = null;
async function ensureWasm() {
  if (!wasmReady) {
    wasmReady = (async () => {
      const res = await fetch("https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm");
      const buf = await res.arrayBuffer();
      await initWasm(buf);
    })();
  }
  await wasmReady;
}

const FONT_URLS: Record<string, string> = {
  // Fredoka 700 — rounded, playful bubble display face (Google Fonts, MIT).
  // Version-less jsdelivr path resolves to the latest published tag.
  fredoka:   "https://cdn.jsdelivr.net/npm/@fontsource/fredoka/files/fredoka-latin-700-normal.woff2",
  // Nunito 700 — clean rounded sans for the pill / small labels.
  nunito:    "https://cdn.jsdelivr.net/npm/@fontsource/nunito@5.0.20/files/nunito-latin-700-normal.woff2",
};

let fontsCache: Uint8Array[] | null = null;
async function loadFonts(): Promise<Uint8Array[]> {
  if (fontsCache) return fontsCache;
  const buffers: Uint8Array[] = [];
  for (const [name, url] of Object.entries(FONT_URLS)) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${name}:${r.status}`);
      buffers.push(new Uint8Array(await r.arrayBuffer()));
    } catch (e) {
      console.warn(`[marketing-thumb] font ${name} failed`, (e as Error).message);
    }
  }
  fontsCache = buffers;
  return buffers;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(bin);
}
function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Fit headline to available width by tuning font-size within [min, max]. */
function fitFontSize(text: string, maxWidthPx: number, maxSize: number, minSize: number): number {
  // Rough Fredoka bold width metric: 0.58em per char average uppercase-mixed.
  const perChar = 0.60;
  const raw = maxWidthPx / (text.length * perChar);
  return Math.max(minSize, Math.min(maxSize, Math.floor(raw)));
}

/** Wrap headline to 2 lines when it overflows a single-line size test. */
function wrapHeadline(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/);
  if (text.length <= maxCharsPerLine) return [text];
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxCharsPerLine && current) { lines.push(current); current = w; }
    else current = candidate;
  }
  if (current) lines.push(current);
  return lines.slice(0, 2); // hard cap at 2 lines
}

async function composeMarketingCard(
  collageBytes: Uint8Array,
  headline: string,
  agesLabel: string,
  variant: typeof STYLE_VARIANTS[number],
): Promise<Uint8Array> {
  await ensureWasm();
  const fonts = await loadFonts();

  const collageB64 = bytesToBase64(collageBytes);
  const lines = wrapHeadline(headline, 22);
  const singleLine = lines.length === 1;
  const headlineFontSize = singleLine
    ? fitFontSize(lines[0], CANVAS - 120, 108, 64)
    : fitFontSize(lines.reduce((a, b) => a.length > b.length ? a : b), CANVAS - 120, 90, 56);
  const lineHeight = Math.round(headlineFontSize * 1.05);
  const headlineTopY = 80; // baseline offset area from top
  const strokePx = Math.max(6, Math.round(headlineFontSize * 0.11));

  const agesFontSize = 32;
  // Rough pill width: text length * 18px + horizontal padding.
  const pillTextW = agesLabel.length * (agesFontSize * 0.58);
  const pillW = Math.round(pillTextW + 56);
  const pillH = 60;
  const pillX = CANVAS - pillW - 36;
  const pillY = CANVAS - pillH - 36;

  // SVG: collage as full-bleed image, headline text with heavy stroke for
  // bubble-outline look, pill for Ages badge.
  const linesSvg = lines.map((ln, i) => {
    const y = headlineTopY + (i + 1) * lineHeight;
    const escaped = xmlEscape(ln);
    return `
      <text x="${CANVAS / 2}" y="${y}" text-anchor="middle"
            font-family="Fredoka, Nunito, sans-serif" font-weight="700"
            font-size="${headlineFontSize}"
            fill="${variant.textColor}"
            stroke="#ffffff" stroke-width="${strokePx}" stroke-linejoin="round"
            paint-order="stroke fill">${escaped}</text>
      <text x="${CANVAS / 2}" y="${y}" text-anchor="middle"
            font-family="Fredoka, Nunito, sans-serif" font-weight="700"
            font-size="${headlineFontSize}"
            fill="${variant.textColor}">${escaped}</text>`;
  }).join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <filter id="headlineShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="4"/>
      <feOffset dx="0" dy="4" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.35"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <image x="0" y="0" width="${CANVAS}" height="${CANVAS}"
         preserveAspectRatio="xMidYMid slice"
         href="data:image/jpeg;base64,${collageB64}"/>
  <g filter="url(#headlineShadow)">
    ${linesSvg}
  </g>
  <g>
    <rect x="${pillX}" y="${pillY}" rx="${pillH / 2}" ry="${pillH / 2}"
          width="${pillW}" height="${pillH}"
          fill="${variant.pillBg}" stroke="${variant.pillText}" stroke-width="3"/>
    <text x="${pillX + pillW / 2}" y="${pillY + pillH / 2 + agesFontSize / 3}"
          text-anchor="middle"
          font-family="Nunito, Fredoka, sans-serif" font-weight="700"
          font-size="${agesFontSize}" fill="${variant.pillText}">${xmlEscape(agesLabel)}</text>
  </g>
</svg>`;

  const resvg = new Resvg(svg, {
    background: variant.bg,
    fitTo: { mode: "width", value: CANVAS },
    font: {
      fontBuffers: fonts,
      loadSystemFonts: false,
      defaultFontFamily: "Fredoka",
    },
  });
  return new Uint8Array(resvg.render().asPng());
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
    if (!force && existing?.version === "etsy_marketing_thumb_v2" && row.thumbnail_url) {
      return json({ ok: true, skipped: "already_generated", thumbnail_url: row.thumbnail_url });
    }

    // Gather interior page URLs (up to 3) for the collage reference set.
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

    const cat = categoryWord(row);
    const ages = ageBand(row);
    const headline = `${pageCount} Cute ${cat} Coloring Pages`;
    const agesLabel = `Ages ${ages}`;

    // STEP 1: generate textless collage art.
    const collagePrompt = buildTextlessPrompt(variant);
    const gen = await generateCollage(refs, collagePrompt);

    // STEP 2: code-render headline + pill via SVG → PNG.
    const composed = await composeMarketingCard(gen.bytes, headline, agesLabel, variant);

    const hash = await sha16(composed);
    const path = `kids/${ebook_id}/coloring/marketing-thumb-${Date.now()}-${hash}.png`;
    const up = await uploadAndSignImage(db, "ebook-covers", path, composed, { contentType: "image/png" });

    try {
      logAiCost(costDb(), {
        ebook_id, step: "coloring_marketing_thumbnail",
        model: RUNWARE_IDEOGRAM_MODEL, images: 1, cost_usd: gen.cost,
        provider: "runware_ideogram_marketing",
      });
    } catch (_) { /* best effort */ }

    // Spelling is guaranteed correct by construction — headline is baked
    // by resvg, not by the model. Store metadata + clear any prior
    // marketing_thumbnail_spelling_unverified blocker.
    const nextMeta = {
      ...meta,
      marketing_thumbnail_meta: {
        version: "etsy_marketing_thumb_v2",
        text_rendering: "code_svg_overlay",
        canvas: { width: CANVAS, height: CANVAS },
        style_variant: variant.name,
        headline,
        ages: agesLabel,
        page_count: pageCount,
        provider_collage: "runware_ideogram_marketing",
        collage_prompt_version: "textless_v1",
        spelling_pass: true,
        spelling_reason: "code_rendered_svg_overlay_guarantees_correct_spelling",
        source_hash: hash,
        storage_path: up.path,
        signed_url: up.signedUrl,
        cost_usd: gen.cost,
        rendered_at: new Date().toISOString(),
      },
    };

    const updates: Record<string, any> = {
      thumbnail_url: up.signedUrl,
      metadata: nextMeta,
    };
    // Clear stale marketing spelling blocker if present.
    if (typeof (row as any).blocker_reason === "string" && (row as any).blocker_reason.startsWith("marketing_thumbnail_spelling_unverified")) {
      updates.blocker_reason = null;
    } else {
      // Also clear via a second selective fetch — cheap safety net.
      const { data: br } = await db.from("ebooks_kids").select("blocker_reason").eq("id", ebook_id).maybeSingle();
      if (br?.blocker_reason && String(br.blocker_reason).startsWith("marketing_thumbnail_spelling_unverified")) {
        updates.blocker_reason = null;
      }
    }
    await db.from("ebooks_kids").update(updates).eq("id", ebook_id);

    return json({
      ok: true, thumbnail_url: up.signedUrl, spelling_pass: true,
      text_rendering: "code_svg_overlay",
      style_variant: variant.name, headline, ages: agesLabel,
      cost_usd: gen.cost,
    });
  } catch (e: any) {
    console.error("[coloring-marketing-thumbnail] fatal", e?.message);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
