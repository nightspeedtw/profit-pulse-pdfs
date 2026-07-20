// Premium cover overlay — deterministic typography layer.
//
// OWNER LAW `no_popups_v5` (2026-07-21):
//   ZERO text is ever composited on top of a coloring-book cover in the
//   normal (title-only) path. The Ideogram bake owns the title; the storefront
//   HTML owns the age chip, sale badge, and any promotional label. This
//   module intentionally draws NOTHING when a title-bake succeeded.
//
//   The only exception is the TEXTLESS FALLBACK path — used when 3 Ideogram
//   title-bake attempts all shipped gibberish. In that case the overlay
//   draws the title (and only the title) as a clean bold display font, which
//   never misspells. No chip, no banner, no ribbon, no age pill, ever.
//
// SCOPE: coloring books only (book_type='coloring_book'). Picture-book /
// adult-PDF lanes MUST NOT import this module.
//
// @ts-nocheck  Deno edge runtime

/** Frozen contract. Any cover asset whose meta.overlay !== this value is
 *  considered LEGACY and eligible for the autopilot legacy-cover sweep. */
export const COVER_OVERLAY_CONTRACT = "premium_cover_overlay_v5_no_text_ever" as const;

export function overlayIsCurrent(meta: Record<string, any> | null | undefined): boolean {
  return !!meta && meta.overlay === COVER_OVERLAY_CONTRACT;
}

import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";

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

const FONT_URL = "https://cdn.jsdelivr.net/npm/@fontsource/fredoka@5.0.15/files/fredoka-latin-700-normal.woff2";
let fontCache: Uint8Array | null = null;
async function loadFont(): Promise<Uint8Array | null> {
  if (fontCache) return fontCache;
  try {
    const r = await fetch(FONT_URL);
    if (!r.ok) return null;
    fontCache = new Uint8Array(await r.arrayBuffer());
    return fontCache;
  } catch { return null; }
}

function esc(s: string) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Rough char-count wrapping — good enough for cover-scale display copy. */
function wrapLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxCharsPerLine && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // Truncate with ellipsis if we ran out of room
  if (lines.length === maxLines) {
    const consumed = lines.join(" ").split(/\s+/).length;
    if (consumed < words.length) {
      const last = lines[maxLines - 1];
      lines[maxLines - 1] = last.length > maxCharsPerLine - 1
        ? last.slice(0, maxCharsPerLine - 1) + "…"
        : last + "…";
    }
  }
  return lines;
}

export interface PremiumOverlayInput {
  width: number;
  height: number;
  ageBadge: string;             // e.g. "AGES 4-6"
  ribbonText?: string;          // default "SALE"
  showRibbon?: boolean;
  /** OWNER LAW v2: top chip that identifies category. Default "COLORING BOOK". */
  topLabel?: string;
  /** OWNER LAW v2: subtitle on the bottom banner. Empty = no banner line. */
  subtitle?: string;
  /** OWNER LAW v2: 1-line blurb on the bottom banner. Empty = skipped. */
  blurb?: string;
  /** OWNER LAW v2: when the art is textless (Ideogram bake failed 3x), the
   *  overlay draws the title too. Empty = art already has baked title. */
  fallbackTitle?: string;
}

export async function renderPremiumCoverOverlayPng(input: PremiumOverlayInput): Promise<Uint8Array> {
  await ensureWasm();
  const font = await loadFont();
  const W = input.width, H = input.height;
  const ageText = (input.ageBadge || "").toUpperCase().trim() || "AGES 4-6";
  const fallbackTitle = (input.fallbackTitle ?? "").trim();

  // OWNER LAW `no_popups_v5` (2026-07-21):
  //   Title-only mode ⇒ overlay draws ABSOLUTELY NOTHING. No age mark,
  //   no chip, no banner, no ribbon, no pill. The Ideogram bake owns the
  //   title; the storefront HTML owns every other visible label.
  //   Textless-fallback mode ⇒ overlay draws ONLY the title, as a clean
  //   bold display font (spelling-guaranteed).
  //
  // ribbonText / showRibbon / topLabel / subtitle / blurb / ageBadge inputs
  // are accepted for API back-compat but intentionally IGNORED.
  void ageText; // referenced only for lint

  // Fallback title (only when Ideogram was asked for textless art).
  let fallbackTitleEl = "";
  if (fallbackTitle) {
    const lines = wrapLines(fallbackTitle, 14, 3);
    const boxH = Math.round(H * (lines.length === 1 ? 0.18 : lines.length === 2 ? 0.26 : 0.32));
    const boxY = Math.round(H * 0.09);
    const fontSize = Math.round(boxH / (lines.length + 0.5));
    let cy = boxY + Math.round(fontSize * 0.95);
    const lineEls = lines.map((ln) => {
      const el = `<text x="${W / 2}" y="${cy}" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="${fontSize}" fill="#FFFFFF" stroke="#0F172A" stroke-width="${Math.max(4, Math.round(fontSize * 0.08))}" paint-order="stroke fill">${esc(ln)}</text>`;
      cy += Math.round(fontSize * 1.05);
      return el;
    }).join("");
    fallbackTitleEl = `<g>${lineEls}</g>`;
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${fallbackTitleEl}
  <!-- ${COVER_OVERLAY_CONTRACT}: NO chip, NO banner, NO ribbon, NO pill, NO age mark. -->
</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
    font: font ? { fontBuffers: [font], loadSystemFonts: false, defaultFontFamily: "Fredoka" } : { loadSystemFonts: false, defaultFontFamily: "sans-serif" },
    background: "rgba(0,0,0,0)",
  });
  return resvg.render().asPng();
}

// Regression guard: if a future edit reintroduces chip/banner/ribbon/pill SVG,
// this self-check throws at module load time, and the coloring-v2-cover step
// will fail loudly rather than ship a text-popped cover.
(function assertNoPopupSvg() {
  const src = renderPremiumCoverOverlayPng.toString();
  const banned = [/rect[^>]*fill="#F/i, /rgb\(255,\s*221/i, /ribbon/i, /banner/i, /chip/i];
  for (const re of banned) {
    if (re.test(src)) {
      throw new Error(`premium-cover-overlay regression: ${COVER_OVERLAY_CONTRACT} must never draw popup elements (matched ${re})`);
    }
  }
})();

/** Alpha-composite an overlay PNG on top of the base JPEG/PNG bytes. Returns JPEG bytes (q=92). */
export async function compositeOverlayOntoArt(
  artBytes: Uint8Array,
  overlayPng: Uint8Array,
): Promise<Uint8Array> {
  const { Image } = await import("https://deno.land/x/imagescript@1.2.17/mod.ts");
  const base = await Image.decode(artBytes);
  const ov = await Image.decode(overlayPng);
  const scaled = ov.width === base.width && ov.height === base.height
    ? ov
    : (ov as any).resize(base.width, base.height);
  (base as any).composite(scaled, 0, 0);
  return await (base as any).encodeJPEG(92);
}
