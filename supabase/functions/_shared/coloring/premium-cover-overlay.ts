// Premium cover overlay — draws ONLY the deterministic chrome (SALE ribbon
// + AGES pill) on a transparent PNG the same size as the Ideogram art, so
// the caller can alpha-composite it over the raw art without touching the
// baked title/subtitle.
//
// Owner law (2026-07-20, `coloring_v2_cover_overlay_v1`):
//   Ideogram is only trusted to bake the TITLE (and optional subtitle).
//   Age badges and SALE ribbons produced badge/ribbon gibberish
//   ("COLONG ADVENTURE") and must be drawn deterministically.
// @ts-nocheck  Deno edge runtime

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

export interface PremiumOverlayInput {
  width: number;
  height: number;
  ageBadge: string;   // e.g. "AGES 4-6"
  ribbonText?: string; // default "SALE"
  showRibbon?: boolean;
}

export async function renderPremiumCoverOverlayPng(input: PremiumOverlayInput): Promise<Uint8Array> {
  await ensureWasm();
  const font = await loadFont();
  const W = input.width, H = input.height;
  const ageText = (input.ageBadge || "").toUpperCase().trim() || "AGES 4-6";
  const ribbonText = (input.ribbonText || "SALE").toUpperCase().trim();
  const showRibbon = input.showRibbon !== false;

  // Age pill: bottom-left circular badge.
  const pillR = Math.round(Math.min(W, H) * 0.11);
  const pillCX = Math.round(W * 0.11);
  const pillCY = Math.round(H * 0.885);
  const pillFontSize = Math.round(pillR * 0.42);

  // SALE ribbon: top-right diagonal banner.
  const rW = Math.round(W * 0.34);
  const rH = Math.round(H * 0.075);
  const rFontSize = Math.round(rH * 0.55);
  // ribbon rotated 45° pinned to top-right corner
  const rCX = W - Math.round(rW * 0.35);
  const rCY = Math.round(rH * 0.9);

  const ribbonEl = showRibbon
    ? `
      <g transform="translate(${rCX} ${rCY}) rotate(45)">
        <rect x="${-rW / 2}" y="${-rH / 2}" width="${rW}" height="${rH}"
              fill="#E11D2E" stroke="#7A0E19" stroke-width="4" />
        <rect x="${-rW / 2 + 6}" y="${-rH / 2 + 6}" width="${rW - 12}" height="${rH - 12}"
              fill="none" stroke="#FFFFFF" stroke-width="2" stroke-dasharray="6 5" opacity="0.85" />
        <text x="0" y="${Math.round(rFontSize * 0.35)}" text-anchor="middle"
              font-family="Fredoka" font-weight="700"
              font-size="${rFontSize}" fill="#FFFFFF"
              letter-spacing="6"
              stroke="#7A0E19" stroke-width="1.2">${esc(ribbonText)}</text>
      </g>`
    : "";

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="pillGrad" cx="35%" cy="35%" r="75%">
      <stop offset="0%" stop-color="#FFF7A8"/>
      <stop offset="70%" stop-color="#FFD635"/>
      <stop offset="100%" stop-color="#E9A400"/>
    </radialGradient>
  </defs>
  <g>
    <circle cx="${pillCX}" cy="${pillCY}" r="${pillR + 6}" fill="#0F172A" opacity="0.28"/>
    <circle cx="${pillCX}" cy="${pillCY}" r="${pillR}" fill="url(#pillGrad)"
            stroke="#0F172A" stroke-width="5"/>
    <text x="${pillCX}" y="${pillCY + pillFontSize * 0.36}" text-anchor="middle"
          font-family="Fredoka" font-weight="700"
          font-size="${pillFontSize}" fill="#0F172A"
          letter-spacing="1.2">${esc(ageText)}</text>
  </g>
  ${ribbonEl}
</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
    font: font ? { fontBuffers: [font], loadSystemFonts: false, defaultFontFamily: "Fredoka" } : { loadSystemFonts: false, defaultFontFamily: "sans-serif" },
    background: "rgba(0,0,0,0)",
  });
  return resvg.render().asPng();
}

/** Alpha-composite an overlay PNG on top of the base JPEG/PNG bytes.
 *  Returns JPEG bytes (quality 92). */
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
