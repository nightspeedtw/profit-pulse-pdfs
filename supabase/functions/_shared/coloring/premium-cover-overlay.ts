// Premium cover overlay — deterministic typography layer.
//
// OWNER LAW `cover_text_overlay_only_v2` (2026-07-20):
//   Ideogram bakes AT MOST the big title. Every other piece of cover text is
//   drawn here as vector SVG with correct fonts and guaranteed correct
//   spelling. The overlay renders (all optional):
//     • top "Coloring Book" (or custom label) chip
//     • bottom banner strip with subtitle + short blurb
//     • bottom-left AGES pill
//     • top-right SALE ribbon
//     • fallback TITLE (when the art was rendered textless because 3
//       Ideogram title-bake attempts all shipped gibberish extras)
//
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
  const ribbonText = (input.ribbonText || "SALE").toUpperCase().trim();
  const showRibbon = input.showRibbon !== false;
  const topLabel = (input.topLabel ?? "COLORING BOOK").toUpperCase().trim();
  const subtitle = (input.subtitle ?? "").trim();
  const blurb = (input.blurb ?? "").trim();
  const fallbackTitle = (input.fallbackTitle ?? "").trim();

  // OWNER ORDER 2026-07-20 (v3): AGES no longer rendered as a separate
  // floating pill — it's merged into the top "COLORING BOOK" chip below.

  // SALE ribbon: top-right diagonal banner.
  const rW = Math.round(W * 0.34);
  const rH = Math.round(H * 0.075);
  const rFontSize = Math.round(rH * 0.55);
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

  // Top "COLORING BOOK" chip.
  let topChipEl = "";
  if (topLabel) {
    const chipH = Math.round(H * 0.052);
    const chipFont = Math.round(chipH * 0.5);
    const chipW = Math.max(Math.round(W * 0.36), Math.round(topLabel.length * chipFont * 0.7));
    const chipX = Math.round((W - chipW) / 2);
    const chipY = Math.round(H * 0.028);
    topChipEl = `
      <g>
        <rect x="${chipX}" y="${chipY}" width="${chipW}" height="${chipH}" rx="${chipH / 2}"
              fill="#0F172A" opacity="0.85" stroke="#FFD635" stroke-width="3"/>
        <text x="${chipX + chipW / 2}" y="${chipY + chipH * 0.68}" text-anchor="middle"
              font-family="Fredoka" font-weight="700" font-size="${chipFont}"
              fill="#FFD635" letter-spacing="3">${esc(topLabel)}</text>
      </g>`;
  }

  // Bottom banner (subtitle + blurb) — only drawn if there's content.
  let bottomBannerEl = "";
  if (subtitle || blurb) {
    const bandH = Math.round(H * (blurb && subtitle ? 0.16 : 0.11));
    const bandY = H - bandH - Math.round(H * 0.015);
    const bandX = Math.round(W * 0.055);
    const bandW = W - bandX * 2;
    const subFont = Math.round(H * 0.032);
    const blurbFont = Math.round(H * 0.022);
    const subLines = subtitle ? wrapLines(subtitle, 42, 1) : [];
    const blurbLines = blurb ? wrapLines(blurb, 60, 2) : [];
    let cursorY = bandY + Math.round(bandH * 0.32);
    const subEls = subLines.map((ln) => {
      const el = `<text x="${W / 2}" y="${cursorY}" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="${subFont}" fill="#FFFFFF" stroke="#0F172A" stroke-width="0.8">${esc(ln)}</text>`;
      cursorY += Math.round(subFont * 1.1);
      return el;
    }).join("");
    cursorY += Math.round(blurbFont * 0.4);
    const blurbEls = blurbLines.map((ln) => {
      const el = `<text x="${W / 2}" y="${cursorY}" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="${blurbFont}" fill="#FFF7E6">${esc(ln)}</text>`;
      cursorY += Math.round(blurbFont * 1.15);
      return el;
    }).join("");
    bottomBannerEl = `
      <g>
        <rect x="${bandX}" y="${bandY}" width="${bandW}" height="${bandH}" rx="${Math.round(bandH * 0.18)}"
              fill="#0F172A" opacity="0.78" stroke="#FFD635" stroke-width="2"/>
        ${subEls}
        ${blurbEls}
      </g>`;
  }

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
  <defs>
    <radialGradient id="pillGrad" cx="35%" cy="35%" r="75%">
      <stop offset="0%" stop-color="#FFF7A8"/>
      <stop offset="70%" stop-color="#FFD635"/>
      <stop offset="100%" stop-color="#E9A400"/>
    </radialGradient>
  </defs>
  ${topChipEl}
  ${fallbackTitleEl}
  ${bottomBannerEl}
  <!-- OWNER ORDER 2026-07-20: yellow AGES pill removed — was covering artwork. -->

  ${ribbonEl}
</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
    font: font ? { fontBuffers: [font], loadSystemFonts: false, defaultFontFamily: "Fredoka" } : { loadSystemFonts: false, defaultFontFamily: "sans-serif" },
    background: "rgba(0,0,0,0)",
  });
  return resvg.render().asPng();
}

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
