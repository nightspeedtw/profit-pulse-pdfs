// Kids picture-book cover renderer.
// Full-bleed hero illustration (from the visual bible) + storybook title overlay.
// Deliberately does NOT include any adult chrome: no black field, no EBOOK chip,
// no hairline rules, no feature chips, no condensed uppercase sans.

import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import type { KidsVisualBible } from "../kids-visual-bible.ts";

// ---------- WASM + storybook font caching ----------
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

// Storybook display + friendly body. Fredoka is round, warm, immediately reads
// as a children's book. Baloo 2 is a friendly companion. Both are free/open.
const KIDS_FONT_URLS: Record<string, string> = {
  fredokaHeavy: "https://cdn.jsdelivr.net/npm/@fontsource/fredoka@5.0.15/files/fredoka-latin-700-normal.woff2",
  fredokaBold: "https://cdn.jsdelivr.net/npm/@fontsource/fredoka@5.0.15/files/fredoka-latin-600-normal.woff2",
  balooExtra: "https://cdn.jsdelivr.net/npm/@fontsource/baloo-2@5.0.20/files/baloo-2-latin-800-normal.woff2",
  balooBold: "https://cdn.jsdelivr.net/npm/@fontsource/baloo-2@5.0.20/files/baloo-2-latin-700-normal.woff2",
};
let kidsFontsCache: Uint8Array[] | null = null;
async function loadKidsFonts(): Promise<Uint8Array[]> {
  if (kidsFontsCache) return kidsFontsCache;
  const buffers: Uint8Array[] = [];
  for (const [name, url] of Object.entries(KIDS_FONT_URLS)) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${name} ${r.status}`);
      buffers.push(new Uint8Array(await r.arrayBuffer()));
    } catch (e) {
      console.warn(`kids-cover: font ${name} failed`, (e as Error).message);
    }
  }
  kidsFontsCache = buffers;
  return buffers;
}

export async function rasterizeKidsSVG(svg: string, width = 1200): Promise<Uint8Array> {
  await ensureWasm();
  const fontBuffers = await loadKidsFonts();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      loadSystemFonts: false,
      fontBuffers,
      defaultFontFamily: "Fredoka",
    },
  });
  return new Uint8Array(resvg.render().asPng());
}

const W = 1600;
const H = 1600;

function esc(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toB64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

/** Distribute words into ≤ maxLines balanced lines. */
function wrapTitle(title: string, maxLines = 3): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  if (words.length === 1) return [words[0]];
  // Number of lines: enough to keep each line ≤ ~14 chars.
  const totalLen = title.length;
  const wantLines = Math.min(maxLines, Math.max(1, Math.ceil(totalLen / 14)));
  const wordsPerLine = Math.ceil(words.length / wantLines);
  const lines: string[] = [];
  for (let i = 0; i < wantLines; i++) {
    const slice = words.slice(i * wordsPerLine, (i + 1) * wordsPerLine);
    if (slice.length) lines.push(slice.join(" "));
  }
  return lines;
}

/** Pick a warm cream / off-white title colour if palette doesn't offer one. */
function pickTitleColor(palette: string[]): { fill: string; stroke: string } {
  // Prefer a warm cream if available, else default.
  const cream = palette.find((c) => /^#(fff|ffe|fdf|fce|fbe|f6e|f0e|efe|f5e|f4e)/i.test(c));
  return {
    fill: cream ?? "#FFF6E5",
    stroke: "#2A1A0A",
  };
}

export interface KidsCoverInputs {
  bibleBg: Uint8Array;         // full-bleed illustration bytes (PNG)
  title: string;
  subtitle?: string | null;    // e.g. "Ages 4–6" (optional)
  ageBadge?: string | null;    // e.g. "AGES 4-6" small pill bottom-right
  bible: KidsVisualBible;
}

export interface KidsCoverBuildResult {
  svg: string;
  titleTopFraction: number;
  titleBlockFraction: number;
  minTitleFontPx: number;
  lineCount: number;
}

export function buildKidsCoverSVG(input: KidsCoverInputs): string {
  return buildKidsCoverSVGWithMetrics(input).svg;
}

export function buildKidsCoverSVGWithMetrics(input: KidsCoverInputs): KidsCoverBuildResult {
  const { bibleBg, title, subtitle, ageBadge, bible } = input;
  const palette = (bible.palette && bible.palette.length ? bible.palette : ["#FFF6E5", "#2A1A0A", "#E9B44C"]);
  const { fill, stroke } = pickTitleColor(palette);
  const accent = palette[2] ?? palette[1] ?? "#E9B44C";

  const bgB64 = toB64(bibleBg);

  // Conversion rule: title occupies 40-60% of cover HEIGHT, placed in the
  // UPPER THIRD. At H=1600 → title block target ~640-720px, top edge starts
  // at ~120px so title block finishes well inside the top 48% of the cover.
  const lines = wrapTitle(title, 3);
  const lineCount = lines.length;
  const titleTop = 120;               // ~7.5% from top
  const longestLine = Math.max(...lines.map((l) => l.length));
  // Scale font aggressively so 1-3 lines together fill ~44% of cover height.
  const targetPx = 1400;              // give the widest line more room
  const approxCharWidth = 0.60;
  let titleFontSize = Math.floor(targetPx / (longestLine * approxCharWidth));
  // Floors + caps keep even 1-line titles chunky and 3-line titles legible.
  const minFont = lineCount === 1 ? 220 : lineCount === 2 ? 180 : 150;
  const maxFont = lineCount === 1 ? 320 : lineCount === 2 ? 260 : 220;
  titleFontSize = Math.max(minFont, Math.min(titleFontSize, maxFont));
  const lineGap = Math.round(titleFontSize * 1.05);
  const titleBlockPx = lineCount === 1 ? titleFontSize : (lineCount - 1) * lineGap + titleFontSize;
  const titleTopFraction = titleTop / H;
  const titleBlockFraction = titleBlockPx / H;

  // Only render subtitle if short enough to fit one line comfortably.
  const trimmedSubtitle = (subtitle ?? "").trim();
  const showSubtitle = trimmedSubtitle.length > 0 && trimmedSubtitle.length <= 32;

  const titleFontFamily = "Fredoka";
  const bodyFontFamily = "Baloo 2";
  const titleTspans = lines
    .map((line, i) => {
      const yBase = titleTop + titleFontSize + i * lineGap;
      return `<text x="${W / 2}" y="${yBase}" text-anchor="middle"
      font-family="${titleFontFamily}" font-weight="700" font-size="${titleFontSize}"
      fill="${fill}" stroke="${stroke}" stroke-width="${Math.max(8, Math.round(titleFontSize * 0.07))}" paint-order="stroke fill"
      letter-spacing="1" filter="url(#titleShadow)">${esc(line)}</text>`;
    })
    .join("\n");

  const subtitleY = titleTop + titleBlockPx + 96;
  const subtitleEl = showSubtitle
    ? `<text x="${W / 2}" y="${subtitleY}" text-anchor="middle"
        font-family="${bodyFontFamily}" font-weight="800" font-size="52"
        fill="${fill}" stroke="${stroke}" stroke-width="3" paint-order="stroke fill"
        letter-spacing="2">${esc(trimmedSubtitle)}</text>`
    : "";

  const ageBadgeEl = ageBadge
    ? `
      <g transform="translate(${W - 320}, ${H - 140})">
        <rect x="0" y="0" width="260" height="86" rx="43" ry="43" fill="${accent}" opacity="0.95" stroke="${stroke}" stroke-width="5"/>
        <text x="130" y="60" text-anchor="middle" font-family="${bodyFontFamily}"
              font-weight="800" font-size="40" fill="${stroke}" letter-spacing="3">
          ${esc(ageBadge)}
        </text>
      </g>`
    : "";

  // Scrim covers the whole top zone that contains the title (title bottom + subtitle padding)
  const scrimH = Math.max(Math.floor(H * 0.5), titleTop + titleBlockPx + 200);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="#000000" stop-opacity="0.60"/>
      <stop offset="60%" stop-color="#000000" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <filter id="titleShadow" x="-10%" y="-10%" width="120%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#1a0e04" flood-opacity="0.65"/>
    </filter>
  </defs>

  <!-- Full-bleed illustration -->
  <image href="data:image/png;base64,${bgB64}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>

  <!-- Soft scrim behind top-third title zone -->
  <rect x="0" y="0" width="${W}" height="${scrimH}" fill="url(#topScrim)"/>

  ${titleTspans}
  ${subtitleEl}
  ${ageBadgeEl}
</svg>`;

  return {
    svg,
    titleTopFraction,
    titleBlockFraction,
    minTitleFontPx: titleFontSize,
    lineCount,
  };
}

/**
 * Lettering-mode cover: the AI illustration already contains the hand-lettered
 * title. We just wrap it full-bleed at 1600×1600 and optionally add the small
 * bottom-right age badge. NO scrim, NO SVG title overlay — that would clash
 * with the painted lettering.
 */
export function buildKidsCoverSVGLetteringOnly(input: {
  bibleBg: Uint8Array;
  ageBadge?: string | null;
  bible: KidsVisualBible;
}): { svg: string } {
  const { bibleBg, ageBadge, bible } = input;
  const palette = (bible.palette && bible.palette.length ? bible.palette : ["#FFF6E5", "#2A1A0A", "#E9B44C"]);
  const accent = palette[2] ?? palette[1] ?? "#E9B44C";
  const stroke = "#2A1A0A";
  const bodyFontFamily = "Baloo 2";
  const bgB64 = toB64(bibleBg);

  const ageBadgeEl = ageBadge
    ? `
      <g transform="translate(${W - 320}, ${H - 140})">
        <rect x="0" y="0" width="260" height="86" rx="43" ry="43" fill="${accent}" opacity="0.95" stroke="${stroke}" stroke-width="5"/>
        <text x="130" y="60" text-anchor="middle" font-family="${bodyFontFamily}"
              font-weight="800" font-size="40" fill="${stroke}" letter-spacing="3">
          ${esc(ageBadge)}
        </text>
      </g>`
    : "";

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <image href="data:image/png;base64,${bgB64}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
  ${ageBadgeEl}
</svg>`;

  return { svg };
}

