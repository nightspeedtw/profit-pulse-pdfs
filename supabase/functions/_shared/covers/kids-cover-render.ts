// Kids picture-book cover renderer.
// Full-bleed hero illustration (from the visual bible) + storybook title overlay.
// Deliberately does NOT include any adult chrome: no black field, no EBOOK chip,
// no hairline rules, no feature chips, no condensed uppercase sans.

import type { KidsVisualBible } from "../kids-visual-bible.ts";

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
  const titleY0 = 220;  // baseline of first line
  const lineGap = 170;
  const titleFontSize = lines.some((l) => l.length > 14) ? 140 : 168;

  const titleTspans = lines
    .map((line, i) => `<text x="${W / 2}" y="${titleY0 + i * lineGap}" class="kids-title">${esc(line)}</text>`)
    .join("\n");

  const subtitleY = titleY0 + lines.length * lineGap + 20;
  const subtitleEl = subtitle && subtitle.trim().length > 0
    ? `<text x="${W / 2}" y="${subtitleY}" class="kids-subtitle">${esc(subtitle.trim())}</text>`
    : "";

  const ageBadgeEl = ageBadge
    ? `
      <g transform="translate(${W - 260}, ${H - 130})">
        <rect x="0" y="0" width="200" height="76" rx="38" ry="38" fill="${accent}" opacity="0.92"/>
        <text x="100" y="50" text-anchor="middle" font-family="'Fredoka One','Baloo 2','Nunito',sans-serif"
              font-weight="700" font-size="34" fill="#2A1A0A" letter-spacing="1.5">
          ${esc(ageBadge)}
        </text>
      </g>`
    : "";

  // Soft gradient scrim behind title so text is legible on any illustration.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="#000000" stop-opacity="0.45"/>
      <stop offset="55%" stop-color="#000000" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <filter id="titleShadow" x="-10%" y="-10%" width="120%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#1a0e04" flood-opacity="0.55"/>
    </filter>
    <style><![CDATA[
      .kids-title {
        font-family: 'Fredoka One', 'Baloo 2', 'Comic Neue', 'Nunito', 'Segoe UI', sans-serif;
        font-weight: 800;
        font-size: ${titleFontSize}px;
        fill: ${fill};
        stroke: ${stroke};
        stroke-width: 6;
        paint-order: stroke fill;
        text-anchor: middle;
        letter-spacing: 1px;
        filter: url(#titleShadow);
      }
      .kids-subtitle {
        font-family: 'Baloo 2', 'Nunito', 'Segoe UI', sans-serif;
        font-weight: 700;
        font-size: 54px;
        fill: ${fill};
        stroke: ${stroke};
        stroke-width: 3;
        paint-order: stroke fill;
        text-anchor: middle;
        letter-spacing: 2px;
      }
    ]]></style>
  </defs>

  <!-- Full-bleed illustration -->
  <image href="data:image/png;base64,${bgB64}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>

  <!-- Soft scrim behind top-third title zone -->
  <rect x="0" y="0" width="${W}" height="${Math.floor(H * 0.42)}" fill="url(#topScrim)"/>

  <!-- Title lines -->
  ${titleTspans}
  ${subtitleEl}
  ${ageBadgeEl}
</svg>`;
}
