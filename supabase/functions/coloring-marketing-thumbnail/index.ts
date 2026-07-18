// coloring-marketing-thumbnail — Etsy-style square (1:1) marketing card.
//
// Fully code-composed architecture (marketing-thumb-svg-composite-v3,
// 2026-07-18): NO AI generation on this surface. Everything the customer
// sees is deterministic:
//
//   • Background — radial gradient in a style-variant palette (rotates per
//     book id so the catalog looks varied).
//   • Book cover mock — the REAL cover_url embedded via SVG <image>, tilted
//     with a drop shadow. Never a hallucinated fake cover.
//   • Interior page fan — up to 3 REAL preview page URLs, tilted and
//     overlapping to sell "unique pages".
//   • Headline — "32 Cute Floral Coloring Pages" rendered in Fredoka 700
//     via resvg-wasm with a white outline for bubble-lettering feel.
//   • Ages pill — rounded rect + Nunito 700 label.
//
// Why we dropped the AI collage step: Runware Ideogram in collage/multi-ref
// mode ~invariably invents decorative typography ("Faddliney", "Colloring
// Colorhe", stray page labels) even with hard anti-text prompts. That's
// fatal here — spelling is the ONE unpublishable defect class
// (spelling-only-critical-unpublish-v1) and this is a customer-visible
// surface. Owner's ruling: code-rendered typography, no AI text baking on
// marketing cards. We extend that logic to the whole composition — real
// assets composited in SVG give zero hallucination risk and cost $0.00.
//
// The book COVER art itself still uses AI baked typography per the
// baked-title-only law — that rule was about the hand-painted book cover,
// NOT this promotional card. See doctrine
// `marketing-thumb-code-typography-v2` (superseded here by v3).
//
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import { uploadAndSignImage } from "../_shared/versioned-assets.ts";

declare const Deno: any;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CANVAS = 1024;

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Style variants ────────────────────────────────────────────────────
// Each variant picks a palette + layout template (cover x/y/rot, interior
// page positions/rotations). Templates all fit inside the 1024×1024 canvas
// with the top ~260px reserved for the headline and bottom-right ~140px
// for the Ages pill.
type Placement = { x: number; y: number; w: number; h: number; rot: number };
type Layout = { cover: Placement; pages: Placement[] };

const LAYOUT_A: Layout = {
  // Cover left-tilted, three pages fanned right.
  cover: { x: 60,  y: 300, w: 380, h: 490, rot: -7 },
  pages: [
    { x: 380, y: 340, w: 300, h: 388, rot: 8 },
    { x: 520, y: 320, w: 300, h: 388, rot: 14 },
    { x: 650, y: 300, w: 300, h: 388, rot: 20 },
  ],
};
const LAYOUT_B: Layout = {
  // Cover centered large, two pages fanned each side.
  cover: { x: 300, y: 280, w: 420, h: 540, rot: 0 },
  pages: [
    { x: 60,  y: 340, w: 300, h: 388, rot: -14 },
    { x: 175, y: 320, w: 300, h: 388, rot: -7 },
    { x: 640, y: 320, w: 300, h: 388, rot: 7 },
  ],
};
const LAYOUT_C: Layout = {
  // Cover right-tilted, pages stacked left.
  cover: { x: 560, y: 300, w: 380, h: 490, rot: 7 },
  pages: [
    { x: 60,  y: 300, w: 300, h: 388, rot: -20 },
    { x: 200, y: 320, w: 300, h: 388, rot: -12 },
    { x: 340, y: 340, w: 300, h: 388, rot: -4 },
  ],
};

const STYLE_VARIANTS = [
  { name: "warm_coral",   bg: "#ffb199", bgAccent: "#ffd6c2", textColor: "#3a1a10", pillBg: "#fff4ec", pillText: "#7a2f18", layout: LAYOUT_A },
  { name: "sunny_yellow", bg: "#ffd257", bgAccent: "#ffe58a", textColor: "#3a2b00", pillBg: "#fff8dc", pillText: "#6b5000", layout: LAYOUT_B },
  { name: "mint_green",   bg: "#8fdcc4", bgAccent: "#c1eedb", textColor: "#0e3327", pillBg: "#f0fbf5", pillText: "#155f3f", layout: LAYOUT_C },
  { name: "sky_blue",     bg: "#95c9f0", bgAccent: "#c9e4f7", textColor: "#0e2a44", pillBg: "#f0f7fd", pillText: "#154163", layout: LAYOUT_A },
  { name: "lavender",     bg: "#c7b3e5", bgAccent: "#e0d1f0", textColor: "#26163f", pillBg: "#f5eefc", pillText: "#4a2871", layout: LAYOUT_B },
  { name: "peach_cream",  bg: "#ffbf9b", bgAccent: "#ffd8bd", textColor: "#3b1b0b", pillBg: "#fff2e5", pillText: "#7a3210", layout: LAYOUT_C },
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

// ── SVG rasterization ────────────────────────────────────────────────
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
  fredoka: "https://cdn.jsdelivr.net/npm/@fontsource/fredoka/files/fredoka-latin-700-normal.woff2",
  nunito:  "https://cdn.jsdelivr.net/npm/@fontsource/nunito@5.0.20/files/nunito-latin-700-normal.woff2",
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

async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ctype = (r.headers.get("content-type") ?? "").split(";")[0].trim() || "image/jpeg";
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length === 0) return null;
    return `data:${ctype};base64,${bytesToBase64(bytes)}`;
  } catch (e) {
    console.warn("[marketing-thumb] fetchAsDataUri failed", (e as Error).message);
    return null;
  }
}

function fitFontSize(text: string, maxWidthPx: number, maxSize: number, minSize: number): number {
  // Fredoka bold width ≈ 0.60em avg per glyph (mixed-case).
  const perChar = 0.60;
  const raw = maxWidthPx / (text.length * perChar);
  return Math.max(minSize, Math.min(maxSize, Math.floor(raw)));
}
function wrapHeadline(text: string, maxCharsPerLine: number): string[] {
  if (text.length <= maxCharsPerLine) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxCharsPerLine && current) { lines.push(current); current = w; }
    else current = candidate;
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

function assetSvg(place: Placement, dataUri: string | null, tint: string): string {
  const cx = place.x + place.w / 2;
  const cy = place.y + place.h / 2;
  // Page frame — always render even if the image fetch failed, so the
  // layout stays balanced. A subtle white paper with faint fill hint.
  const frame = `
    <g transform="rotate(${place.rot} ${cx} ${cy})">
      <rect x="${place.x}" y="${place.y}" width="${place.w}" height="${place.h}"
            fill="#ffffff" stroke="${tint}" stroke-width="2"
            filter="url(#assetShadow)"/>
      ${dataUri ? `<image x="${place.x}" y="${place.y}" width="${place.w}" height="${place.h}"
                     preserveAspectRatio="xMidYMid slice" href="${dataUri}"/>` : ""}
    </g>`;
  return frame;
}

async function composeMarketingCard(
  coverUri: string | null,
  pageUris: (string | null)[],
  headline: string,
  agesLabel: string,
  variant: typeof STYLE_VARIANTS[number],
): Promise<Uint8Array> {
  await ensureWasm();
  const fonts = await loadFonts();
  const layout = variant.layout;

  // Draw fanned pages BEHIND the cover (back-to-front so the last one is
  // closest to the cover).
  const pagesSvg = layout.pages.map((p, i) => assetSvg(p, pageUris[i] ?? null, variant.pillText)).join("\n");
  const coverSvg = assetSvg(layout.cover, coverUri, variant.pillText);

  const lines = wrapHeadline(headline, 22);
  const singleLine = lines.length === 1;
  const headlineFontSize = singleLine
    ? fitFontSize(lines[0], CANVAS - 140, 110, 66)
    : fitFontSize(lines.reduce((a, b) => a.length > b.length ? a : b), CANVAS - 140, 92, 56);
  const lineHeight = Math.round(headlineFontSize * 1.05);
  const headlineTopY = 60;
  const strokePx = Math.max(6, Math.round(headlineFontSize * 0.11));

  const agesFontSize = 34;
  const pillTextW = agesLabel.length * (agesFontSize * 0.58);
  const pillW = Math.round(pillTextW + 60);
  const pillH = 64;
  const pillX = CANVAS - pillW - 36;
  const pillY = CANVAS - pillH - 36;

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
    <radialGradient id="bg" cx="50%" cy="55%" r="70%">
      <stop offset="0%"   stop-color="${variant.bgAccent}"/>
      <stop offset="100%" stop-color="${variant.bg}"/>
    </radialGradient>
    <filter id="assetShadow" x="-15%" y="-15%" width="130%" height="130%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="8"/>
      <feOffset dx="0" dy="10" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.32"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="headlineShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="4"/>
      <feOffset dx="0" dy="4" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.35"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" fill="url(#bg)"/>
  ${pagesSvg}
  ${coverSvg}
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
      .select("id, book_type, title, cover_url, thumbnail_url, preview_page_urls, blocker_reason, metadata")
      .eq("id", ebook_id).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: "not_found" }, 404);
    if (row.book_type !== "coloring_book") return json({ error: "wrong_lane" }, 400);
    if (!row.cover_url) return json({ error: "no_cover_url" }, 422);

    const meta = (row.metadata ?? {}) as Record<string, any>;
    const existing = meta.marketing_thumbnail_meta;
    if (!force && existing?.version === "etsy_marketing_thumb_v3" && row.thumbnail_url) {
      return json({ ok: true, skipped: "already_generated", thumbnail_url: row.thumbnail_url });
    }

    // Gather interior page URLs (up to 3) — prefer preview_page_urls, else
    // pull first three rendered pages from ebook_assets.
    let interiorRefs: string[] = Array.isArray(row.preview_page_urls) ? row.preview_page_urls.slice(0, 3) : [];
    if (interiorRefs.length < 3) {
      const { data: pages } = await db.from("ebook_assets")
        .select("url").eq("ebook_id", ebook_id).eq("kind", "coloring_page")
        .order("created_at", { ascending: true }).limit(3);
      if (Array.isArray(pages)) interiorRefs = pages.map((p: any) => p.url).filter(Boolean).slice(0, 3);
    }

    const pageCount = Number(meta.coloring_page_count ?? meta.page_count ?? interiorRefs.length ?? 32) || 32;
    const variant = pickVariant(String(ebook_id));
    const cat = categoryWord(row);
    const ages = ageBand(row);
    const headline = `${pageCount} Cute ${cat} Coloring Pages`;
    const agesLabel = `Ages ${ages}`;

    // Fetch real assets as data URIs so resvg embeds them (signed-URL safe).
    const [coverUri, ...pageUris] = await Promise.all([
      fetchAsDataUri(row.cover_url),
      ...interiorRefs.slice(0, 3).map(fetchAsDataUri),
    ]);

    // Compose card entirely via SVG → PNG. No AI calls, no spelling risk.
    const composed = await composeMarketingCard(coverUri, pageUris, headline, agesLabel, variant);

    const hash = await sha16(composed);
    const path = `kids/${ebook_id}/coloring/marketing-thumb-${Date.now()}-${hash}.png`;
    const up = await uploadAndSignImage(db, "ebook-covers", path, composed, { contentType: "image/png" });

    const nextMeta = {
      ...meta,
      marketing_thumbnail_meta: {
        version: "etsy_marketing_thumb_v3",
        text_rendering: "code_svg_overlay",
        composition: "code_svg_composite_no_ai",
        canvas: { width: CANVAS, height: CANVAS },
        style_variant: variant.name,
        headline,
        ages: agesLabel,
        page_count: pageCount,
        spelling_pass: true,
        spelling_reason: "code_rendered_svg_overlay_guarantees_correct_spelling",
        cover_embedded: Boolean(coverUri),
        page_thumbs_embedded: pageUris.filter(Boolean).length,
        source_hash: hash,
        storage_path: up.path,
        signed_url: up.signedUrl,
        cost_usd: 0,
        rendered_at: new Date().toISOString(),
      },
    };

    const updates: Record<string, any> = {
      thumbnail_url: up.signedUrl,
      metadata: nextMeta,
    };
    // Clear stale marketing spelling blocker.
    if (typeof (row as any).blocker_reason === "string" &&
        String((row as any).blocker_reason).startsWith("marketing_thumbnail_spelling")) {
      updates.blocker_reason = null;
    }
    await db.from("ebooks_kids").update(updates).eq("id", ebook_id);

    return json({
      ok: true, thumbnail_url: up.signedUrl, spelling_pass: true,
      text_rendering: "code_svg_overlay",
      composition: "code_svg_composite_no_ai",
      style_variant: variant.name, headline, ages: agesLabel,
      cost_usd: 0,
    });
  } catch (e: any) {
    console.error("[coloring-marketing-thumbnail] fatal", e?.message);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
