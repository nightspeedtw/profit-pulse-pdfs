// coloring-marketing-thumbnail — v4 (cover-first Etsy card + gallery).
//
// Owner directive (2026-07-18): the storefront card's primary image is the
// BOOK COVER ITSELF, full-bleed in a 1024×1024 square (Etsy "Spooky House"
// pattern). The prior collage / bubble-headline card moves DOWN the funnel:
// it becomes gallery image #2 on the product page, not the card.
//
// Composition (all deterministic, no AI — zero spelling risk):
//   1. Square thumbnail (thumbnail_url):
//        • Background: the same cover art, blurred + slightly darkened,
//          fills the entire square (Instagram-Reels style edge-bleed).
//        • Foreground: the cover art, sharp, fit-contained centered.
//      Result reads as "the cover, full-bleed, on-brand" and preserves the
//      baked title exactly as approved by the cover spelling gate.
//   2. Gallery collage (storefront_meta.gallery_urls[1]):
//        • The v3 SVG marketing card (cover tile + fanned pages +
//          bubble headline + Ages pill) — moved from thumbnail to gallery
//          slot #2 so shoppers who scroll see the "what's inside" pitch.
//   3. Gallery order:
//        [square_cover, collage, ...interior_page_urls (up to 4)]
//      stored on storefront_meta.gallery_urls for ColoringProduct.tsx.
//
// The book cover art itself still uses AI baked typography per the
// baked-title-only law. That's already gated by publish-contract's v3
// spelling gate, so the square derivative here inherits the pass.
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

// ── Collage style variants (used for gallery image #2) ───────────────
type Placement = { x: number; y: number; w: number; h: number; rot: number };
type Layout = { cover: Placement; pages: Placement[] };

const LAYOUT_A: Layout = {
  cover: { x: 60,  y: 300, w: 380, h: 490, rot: -7 },
  pages: [
    { x: 380, y: 340, w: 300, h: 388, rot: 8 },
    { x: 520, y: 320, w: 300, h: 388, rot: 14 },
    { x: 650, y: 300, w: 300, h: 388, rot: 20 },
  ],
};
const LAYOUT_B: Layout = {
  cover: { x: 300, y: 280, w: 420, h: 540, rot: 0 },
  pages: [
    { x: 60,  y: 340, w: 300, h: 388, rot: -14 },
    { x: 175, y: 320, w: 300, h: 388, rot: -7 },
    { x: 640, y: 320, w: 300, h: 388, rot: 7 },
  ],
};
const LAYOUT_C: Layout = {
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

// ── Composition 1: SQUARE full-bleed cover thumbnail ────────────────
// The cover art (portrait ~0.7727) is rendered twice inside a 1024²:
//   • cover-fill background, Gaussian-blurred, slight dark scrim → the
//     bleed area matches the cover palette without letterbox bars.
//   • fit-contained centered foreground → sharp cover with baked title.
async function composeSquareCoverThumbnail(coverUri: string, size = CANVAS): Promise<Uint8Array> {
  await ensureWasm();
  const fonts = await loadFonts();
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <filter id="coverBlur" x="-15%" y="-15%" width="130%" height="130%">
      <feGaussianBlur stdDeviation="34"/>
    </filter>
    <filter id="coverShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="10"/>
      <feOffset dx="0" dy="8" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.35"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g filter="url(#coverBlur)">
    <image href="${coverUri}" x="-60" y="-60" width="${size + 120}" height="${size + 120}"
           preserveAspectRatio="xMidYMid slice"/>
  </g>
  <rect x="0" y="0" width="${size}" height="${size}" fill="#000" opacity="0.10"/>
  <g filter="url(#coverShadow)">
    <image href="${coverUri}" x="0" y="0" width="${size}" height="${size}"
           preserveAspectRatio="xMidYMid meet"/>
  </g>
</svg>`;
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: "Fredoka" },
  });
  return new Uint8Array(resvg.render().asPng());
}

// ── Composition 2: GALLERY collage (formerly the thumbnail) ─────────
function assetSvg(place: Placement, dataUri: string | null, tint: string): string {
  const cx = place.x + place.w / 2;
  const cy = place.y + place.h / 2;
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

async function composeGalleryCollage(
  coverUri: string | null,
  pageUris: (string | null)[],
  headline: string,
  agesLabel: string,
  variant: typeof STYLE_VARIANTS[number],
): Promise<Uint8Array> {
  await ensureWasm();
  const fonts = await loadFonts();
  const layout = variant.layout;

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
      .select("id, book_type, title, cover_url, thumbnail_url, preview_page_urls, blocker_reason, metadata, storefront_meta")
      .eq("id", ebook_id).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: "not_found" }, 404);
    if (row.book_type !== "coloring_book") return json({ error: "wrong_lane" }, 400);
    if (!row.cover_url) return json({ error: "no_cover_url" }, 422);

    const meta = (row.metadata ?? {}) as Record<string, any>;
    const sf = (row.storefront_meta ?? {}) as Record<string, any>;
    const existing = meta.marketing_thumbnail_meta;
    if (!force && existing?.version === "cover_first_gallery_v4"
        && row.thumbnail_url
        && Array.isArray(sf.gallery_urls) && sf.gallery_urls.length >= 2) {
      return json({ ok: true, skipped: "already_generated", thumbnail_url: row.thumbnail_url, gallery_urls: sf.gallery_urls });
    }

    // Gather interior page URLs (up to 4) — prefer preview_page_urls, else
    // pull first four rendered pages from ebook_assets.
    let interiorRefs: string[] = Array.isArray(row.preview_page_urls) ? row.preview_page_urls.slice(0, 4) : [];
    if (interiorRefs.length < 4) {
      const { data: pages } = await db.from("ebook_assets")
        .select("url").eq("ebook_id", ebook_id).eq("kind", "coloring_page")
        .order("created_at", { ascending: true }).limit(4);
      if (Array.isArray(pages)) interiorRefs = pages.map((p: any) => p.url).filter(Boolean).slice(0, 4);
    }

    const coverUri = await fetchAsDataUri(row.cover_url);
    if (!coverUri) return json({ error: "cover_fetch_failed" }, 502);

    // ─── 1. Square full-bleed cover thumbnail ─────────────────────
    const squareBytes = await composeSquareCoverThumbnail(coverUri, CANVAS);
    const squareHash = await sha16(squareBytes);
    const squarePath = `kids/${ebook_id}/coloring/thumb-square-${Date.now()}-${squareHash}.png`;
    const squareUp = await uploadAndSignImage(db, "ebook-covers", squarePath, squareBytes, { contentType: "image/png" });

    // ─── 2. Gallery collage (image #2) ────────────────────────────
    const pageUris = await Promise.all(interiorRefs.slice(0, 3).map(fetchAsDataUri));
    const pageCount = Number(meta.coloring_page_count ?? meta.page_count ?? interiorRefs.length ?? 32) || 32;
    const variant = pickVariant(String(ebook_id));
    const cat = categoryWord(row);
    const ages = ageBand(row);
    const headline = `${pageCount} Cute ${cat} Coloring Pages`;
    const agesLabel = `Ages ${ages}`;
    const collageBytes = await composeGalleryCollage(coverUri, pageUris, headline, agesLabel, variant);
    const collageHash = await sha16(collageBytes);
    const collagePath = `kids/${ebook_id}/coloring/gallery-collage-${Date.now()}-${collageHash}.png`;
    const collageUp = await uploadAndSignImage(db, "ebook-covers", collagePath, collageBytes, { contentType: "image/png" });

    // ─── 3. Gallery order: [square, collage, ...interior pages] ───
    const gallery_urls: string[] = [
      squareUp.signedUrl,
      collageUp.signedUrl,
      ...interiorRefs.slice(0, 4),
    ];

    const nextMeta = {
      ...meta,
      marketing_thumbnail_meta: {
        version: "cover_first_gallery_v4",
        composition: "square_cover_blur_bleed + code_svg_collage",
        canvas: { width: CANVAS, height: CANVAS },
        style_variant: variant.name,
        headline,
        ages: agesLabel,
        page_count: pageCount,
        spelling_pass: true,
        spelling_reason: "square_thumb_reuses_gated_cover_art_verbatim",
        gallery_slot_count: gallery_urls.length,
        square_storage_path: squareUp.path,
        collage_storage_path: collageUp.path,
        source_cover_url: row.cover_url,
        cost_usd: 0,
        rendered_at: new Date().toISOString(),
      },
    };
    const nextSf = {
      ...sf,
      gallery_urls,
      gallery_version: "cover_first_v4",
      collage_url: collageUp.signedUrl,
    };

    const updates: Record<string, any> = {
      thumbnail_url: squareUp.signedUrl,
      metadata: nextMeta,
      storefront_meta: nextSf,
    };
    if (typeof (row as any).blocker_reason === "string" &&
        String((row as any).blocker_reason).startsWith("marketing_thumbnail_spelling")) {
      updates.blocker_reason = null;
    }
    await db.from("ebooks_kids").update(updates).eq("id", ebook_id);

    return json({
      ok: true,
      thumbnail_url: squareUp.signedUrl,
      gallery_urls,
      composition: "square_cover_blur_bleed + code_svg_collage",
      version: "cover_first_gallery_v4",
      style_variant: variant.name,
      cost_usd: 0,
    });
  } catch (e: any) {
    console.error("[coloring-marketing-thumbnail] fatal", e?.message);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
