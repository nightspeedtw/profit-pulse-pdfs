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
  const fallbackTitle = (input.fallbackTitle ?? "").trim();

  // OWNER ORDER 2026-07-20 (v4 — NO POPUPS): every floating overlay element
  // is gone — no top chip, no bottom banner, no SALE ribbon, no age pill.
  // The only things the overlay can still draw are:
  //   1. A tasteful integrated AGES mark (small caps, hairline underline,
  //      NO background — reads as part of the cover, not a sticker).
  //   2. The fallback title, ONLY when Ideogram was asked for textless art.
  // ribbonText / showRibbon / topLabel / subtitle / blurb inputs are still
  // accepted for API compatibility but intentionally IGNORED.

  // Integrated AGES mark: small caps, bottom-center, hairline rule.
  let ageEl = "";
  if (ageText) {
    const ageFont = Math.round(H * 0.026);
    const ageY = H - Math.round(H * 0.035);
    const ruleY = ageY + Math.round(ageFont * 0.35);
    const ruleW = Math.round(ageText.length * ageFont * 0.7);
    ageEl = `
      <g>
        <text x="${W / 2}" y="${ageY}" text-anchor="middle"
              font-family="Fredoka" font-weight="700" font-size="${ageFont}"
              fill="#FFFFFF" letter-spacing="6"
              stroke="#0F172A" stroke-width="${Math.max(2, Math.round(ageFont * 0.12))}"
              paint-order="stroke fill">${esc(ageText)}</text>
        <line x1="${(W - ruleW) / 2}" y1="${ruleY}" x2="${(W + ruleW) / 2}" y2="${ruleY}"
              stroke="#FFFFFF" stroke-width="1.5" opacity="0.9"/>
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
  ${fallbackTitleEl}
  ${ageEl}
  <!-- OWNER ORDER 2026-07-20 v4: NO POPUPS. No chip, no banner, no ribbon, no pill. -->
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
