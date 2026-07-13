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
  fredoka: "https://cdn.jsdelivr.net/npm/@fontsource/fredoka-one@5.0.13/files/fredoka-one-latin-400-normal.woff",
  baloo: "https://cdn.jsdelivr.net/npm/@fontsource/baloo-2@5.0.20/files/baloo-2-latin-800-normal.woff",
  baloobold: "https://cdn.jsdelivr.net/npm/@fontsource/baloo-2@5.0.20/files/baloo-2-latin-700-normal.woff",
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
      defaultFontFamily: "Fredoka One",
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

/** Break the title on natural word boundaries into ≤3 balanced lines. */
function wrapTitle(title: string, maxLines = 3): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  if (words.length === 1) return [words[0]];
  const target = Math.ceil(words.length / Math.min(maxLines, Math.ceil(words.length / 2)));
  const lines: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.join(" ").length >= 16 || cur.length >= target) {
      lines.push(cur.join(" "));
      cur = [];
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (cur.length) lines.push(cur.join(" "));
  return lines.slice(0, maxLines);
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

export function buildKidsCoverSVG(input: KidsCoverInputs): string {
  const { bibleBg, title, subtitle, ageBadge, bible } = input;
  const palette = (bible.palette && bible.palette.length ? bible.palette : ["#FFF6E5", "#2A1A0A", "#E9B44C"]);
  const { fill, stroke } = pickTitleColor(palette);
  const accent = palette[2] ?? palette[1] ?? "#E9B44C";

  const bgB64 = toB64(bibleBg);

  // Title layout — up to 3 lines, centered in top third reserved zone.
  const lines = wrapTitle(title, 3);
  const titleY0 = 260;  // baseline of first line
  const lineGap = 170;
  const longestLine = Math.max(...lines.map((l) => l.length));
  const titleFontSize = longestLine > 14 ? 130 : longestLine > 10 ? 156 : 180;

  // Inline attributes only — resvg-wasm CSS class parsing on <text> is unreliable.
  // Use widely-available fallback fonts (Arial Black stack) that resvg ships with,
  // and rely on the thick stroke + drop shadow for the storybook feel.
  const titleFontFamily = "'Arial Black', 'Helvetica Neue', Impact, sans-serif";
  const titleTspans = lines
    .map((line, i) => `<text x="${W / 2}" y="${titleY0 + i * lineGap}" text-anchor="middle"
      font-family="${titleFontFamily}" font-weight="900" font-size="${titleFontSize}"
      fill="${fill}" stroke="${stroke}" stroke-width="8" paint-order="stroke fill"
      letter-spacing="1" filter="url(#titleShadow)">${esc(line)}</text>`)
    .join("\n");

  const subtitleY = titleY0 + lines.length * lineGap + 40;
  const subtitleEl = subtitle && subtitle.trim().length > 0
    ? `<text x="${W / 2}" y="${subtitleY}" text-anchor="middle"
        font-family="'Arial Black', Helvetica, sans-serif" font-weight="700" font-size="54"
        fill="${fill}" stroke="${stroke}" stroke-width="3" paint-order="stroke fill"
        letter-spacing="2">${esc(subtitle.trim())}</text>`
    : "";

  const ageBadgeEl = ageBadge
    ? `
      <g transform="translate(${W - 320}, ${H - 140})">
        <rect x="0" y="0" width="260" height="86" rx="43" ry="43" fill="${accent}" opacity="0.95" stroke="${stroke}" stroke-width="4"/>
        <text x="130" y="58" text-anchor="middle" font-family="'Arial Black', Helvetica, sans-serif"
              font-weight="900" font-size="38" fill="${stroke}" letter-spacing="2">
          ${esc(ageBadge)}
        </text>
      </g>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="#000000" stop-opacity="0.55"/>
      <stop offset="55%" stop-color="#000000" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <filter id="titleShadow" x="-10%" y="-10%" width="120%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#1a0e04" flood-opacity="0.60"/>
    </filter>
  </defs>

  <!-- Full-bleed illustration -->
  <image href="data:image/png;base64,${bgB64}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>

  <!-- Soft scrim behind top-third title zone -->
  <rect x="0" y="0" width="${W}" height="${Math.floor(H * 0.48)}" fill="url(#topScrim)"/>

  ${titleTspans}
  ${subtitleEl}
  ${ageBadgeEl}
</svg>`;
}
