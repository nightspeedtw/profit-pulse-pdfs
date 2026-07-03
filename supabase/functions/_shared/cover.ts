// Reference-style premium hardcover template (dark field, condensed title with
// accent-highlighted keyword, hairline-ruled subtitle, hero image zone, 4
// icon+label chips). Text is rendered by code — the AI background provides only
// a textless hero illustration that fits the reserved central zone.
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

export interface CoverSpec {
  cover_strategy: string;
  visual_sales_angle: string;
  cover_size: string;
  background_image_prompt_no_text: string;
  title_text: string;
  subtitle_text: string;
  badge_text: string;
  brand_text: string;
  layout_direction: "top" | "bottom" | "center" | string;
  color_palette: string[]; // [bg, title, accent]
  typography_style: string;
  thumbnail_readability_notes: string;
  why_this_cover_sells: string;
  cover_qc_checklist: string[];
  target_buyer?: string;
  buyer_pain?: string;
  desired_transformation?: string;
  emotional_trigger?: string;
  category?: string;
  product_format?: string;
  creative_direction?: string;
  visual_metaphor?: string;
  composition_strategy?: string;
  typography_strategy?: string;
  thumbnail_strategy?: string;
  anti_ai_design_notes?: string;
  layout_instructions?: string;
  title_treatment?: string;
  subtitle_treatment?: string;
  badge_treatment?: string;
  brand_treatment?: string;
  // Reference-style extensions
  feature_chips?: string[];       // up to 4 short labels e.g. ["Clear Plan","6-Month Framework","Build Momentum","Financial Freedom"]
  accent_key?: string;            // "gold"|"cyan"|"emerald"|"magenta"|"crimson"|"ivory"
  highlight_word?: string;        // word or short phrase within title_text to highlight in accent color
}

function esc(s: string) {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Accent palette by lever/category. Defaults to gold (reference).
const ACCENT_BY_KEY: Record<string, string> = {
  gold:     "#f5c518",
  cyan:     "#22d3ee",
  emerald:  "#10b981",
  magenta:  "#ec4899",
  crimson:  "#ef4444",
  ivory:    "#f5f0e0",
  amber:    "#f59e0b",
  violet:   "#a78bfa",
};

function resolveAccent(spec: CoverSpec): string {
  const key = (spec.accent_key || "").toLowerCase().trim();
  if (key && ACCENT_BY_KEY[key]) return ACCENT_BY_KEY[key];
  const cat = (spec.category || "").toLowerCase();
  if (/finance|debt|money|wealth|budget/.test(cat)) return ACCENT_BY_KEY.gold;
  if (/business|productivity|ai|market|career|exec/.test(cat)) return ACCENT_BY_KEY.cyan;
  if (/health|burnout|wellness|energy|fitness|sleep/.test(cat)) return ACCENT_BY_KEY.emerald;
  if (/relation|self|mindset|emotion|dating|love/.test(cat)) return ACCENT_BY_KEY.magenta;
  const p2 = spec.color_palette?.[2];
  return (p2 && /^#[0-9a-f]{3,8}$/i.test(p2)) ? p2 : ACCENT_BY_KEY.gold;
}

function approxTitleCharW(size: number) { return size * 0.52; } // Impact/condensed
function approxSubCharW(size: number)   { return size * 0.5; }

function wrapByWidth(text: string, maxWidthPx: number, charWidth: (s: number) => number, fontSize: number): string[] {
  const cpl = Math.max(4, Math.floor(maxWidthPx / charWidth(fontSize)));
  const words = (text ?? "").trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (t.length > cpl && line) { lines.push(line); line = w; }
    else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function fitTitle(text: string, maxWidth: number, maxLines: number, startSize: number, minSize: number) {
  let size = startSize;
  while (size >= minSize) {
    const lines = wrapByWidth(text.toUpperCase(), maxWidth, approxTitleCharW, size);
    if (lines.length <= maxLines) return { size, lines };
    size -= 6;
  }
  const lines = wrapByWidth(text.toUpperCase(), maxWidth, approxTitleCharW, minSize).slice(0, maxLines);
  return { size: minSize, lines };
}

// Icon paths for the 4 feature chips (Lucide-style, drawn in 48x48 viewport).
const CHIP_ICONS: string[] = [
  // target / crosshair
  `<circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="3" fill="none"/><circle cx="24" cy="24" r="9" stroke="currentColor" stroke-width="3" fill="none"/><line x1="24" y1="2" x2="24" y2="10" stroke="currentColor" stroke-width="3"/><line x1="24" y1="38" x2="24" y2="46" stroke="currentColor" stroke-width="3"/><line x1="2" y1="24" x2="10" y2="24" stroke="currentColor" stroke-width="3"/><line x1="38" y1="24" x2="46" y2="24" stroke="currentColor" stroke-width="3"/>`,
  // calendar
  `<rect x="6" y="10" width="36" height="32" rx="3" stroke="currentColor" stroke-width="3" fill="none"/><line x1="6" y1="20" x2="42" y2="20" stroke="currentColor" stroke-width="3"/><line x1="16" y1="4" x2="16" y2="14" stroke="currentColor" stroke-width="3"/><line x1="32" y1="4" x2="32" y2="14" stroke="currentColor" stroke-width="3"/>`,
  // trending up / bar chart
  `<polyline points="6,36 18,24 26,30 42,12" stroke="currentColor" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/><polyline points="30,12 42,12 42,24" stroke="currentColor" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`,
  // shield
  `<path d="M24 4 L42 12 V26 C42 36 34 42 24 44 C14 42 6 36 6 26 V12 Z" stroke="currentColor" stroke-width="3" fill="none" stroke-linejoin="round"/>`,
];

export function buildCoverSVG(spec: CoverSpec, bgPng: Uint8Array): string {
  const W = 1600, H = 2400;
  const palette = (spec.color_palette ?? []).filter(Boolean);
  const bgFill = palette[0] ?? "#0b0b0b";
  const titleColor = palette[1] ?? "#f4f2ee";
  const accent = resolveAccent(spec);
  const dimText = "rgba(244,242,238,0.78)";

  // base64 bg (used as subtle hero illustration inside the reserved zone)
  let b64 = "";
  const chunk = 0x8000;
  for (let i = 0; i < bgPng.length; i += chunk) {
    b64 += String.fromCharCode(...bgPng.subarray(i, i + chunk));
  }
  const bgData = `data:image/png;base64,${btoa(b64)}`;

  const PAD_X = 130;
  const usableW = W - PAD_X * 2;

  // ---- EBOOK badge (top-left) ----
  const badgeText = (spec.badge_text || "EBOOK").trim().slice(0, 12).toUpperCase();
  const badgeH = 90;
  const badgeW = Math.max(180, badgeText.length * 40 + 60);
  const badgeY = 140;

  // ---- Auto-fit title (up to 4 lines, uppercase, condensed) ----
  const titleRaw = (spec.title_text || "").trim().slice(0, 70);
  const { size: titleSize, lines: titleLines } = fitTitle(titleRaw, usableW, 4, 260, 130);
  const titleLineH = titleSize * 1.0;

  // Determine which line(s) to highlight in accent.
  // Preference: explicit highlight_word matches → those tokens on their lines get accent.
  // Fallback: single middle line, or the last-line for 2-line titles.
  const highlight = (spec.highlight_word || "").trim().toUpperCase();
  const highlightLineIndex: Set<number> = new Set();
  if (highlight) {
    titleLines.forEach((ln, i) => {
      if (ln.toUpperCase().includes(highlight)) highlightLineIndex.add(i);
    });
  }
  if (highlightLineIndex.size === 0) {
    if (titleLines.length >= 3) highlightLineIndex.add(1);
    else if (titleLines.length === 2) highlightLineIndex.add(1);
  }

  // Title block placement — start below badge
  const titleTop = badgeY + badgeH + 120;
  const titleStartY = titleTop + titleSize * 0.85;

  const titleTSpans = titleLines.map((ln, i) => {
    const ty = titleStartY + i * titleLineH;
    const fill = highlightLineIndex.has(i) ? accent : titleColor;
    // center align via text-anchor middle
    return `<text x="${W/2}" y="${ty}" text-anchor="middle" font-family="Impact, 'Arial Black', 'Helvetica Neue', Arial, sans-serif" font-weight="900" font-size="${titleSize}" fill="${fill}" letter-spacing="-2">${esc(ln)}</text>`;
  }).join("");

  const titleBlockH = titleLines.length * titleLineH;
  const titleBottomY = titleTop + titleBlockH;

  // ---- Subtitle bracketed by hairline rules ----
  const subRaw = (spec.subtitle_text || "").trim().slice(0, 140);
  const subSize = 46;
  const subLines = wrapByWidth(subRaw, usableW - 120, approxSubCharW, subSize).slice(0, 2);
  const subLineH = subSize * 1.35;
  const subBlockH = subLines.length * subLineH;

  const subGap = 70;
  const ruleTopY = titleBottomY + subGap;
  const ruleBottomY = ruleTopY + subBlockH + 90;
  const subStartY = ruleTopY + 60 + subSize * 0.6;

  const subTSpans = subLines.map((ln, i) => {
    const ty = subStartY + i * subLineH;
    return `<text x="${W/2}" y="${ty}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="400" font-size="${subSize}" fill="${dimText}">${esc(ln)}</text>`;
  }).join("");

  const ruleW = usableW - 40;
  const ruleX = (W - ruleW) / 2;
  const rules = `
    <line x1="${ruleX}" y1="${ruleTopY}" x2="${ruleX + ruleW}" y2="${ruleTopY}" stroke="${titleColor}" stroke-opacity="0.55" stroke-width="2"/>
    <line x1="${ruleX}" y1="${ruleBottomY}" x2="${ruleX + ruleW}" y2="${ruleBottomY}" stroke="${titleColor}" stroke-opacity="0.55" stroke-width="2"/>
  `;

  // ---- Hero illustration zone (uses AI textless bg) ----
  const heroTop = ruleBottomY + 80;
  const chipRowH = 300;
  const bottomAccentH = 6;
  const heroBottom = H - chipRowH - 80;
  const heroH = Math.max(300, heroBottom - heroTop);
  const heroW = usableW - 100;
  const heroX = (W - heroW) / 2;

  // Framed hero image, clipped
  const heroClip = `
    <clipPath id="heroClip">
      <rect x="${heroX}" y="${heroTop}" width="${heroW}" height="${heroH}"/>
    </clipPath>
  `;
  const hero = `<g clip-path="url(#heroClip)">
    <image href="${bgData}" x="${heroX - 40}" y="${heroTop - 40}" width="${heroW + 80}" height="${heroH + 80}" preserveAspectRatio="xMidYMid slice"/>
    <rect x="${heroX}" y="${heroTop}" width="${heroW}" height="${heroH}" fill="url(#heroFade)"/>
  </g>`;

  // ---- Bottom accent bar + 4 feature chips ----
  const barY = H - chipRowH - 40;
  const bar = `<rect x="${PAD_X}" y="${barY}" width="${usableW}" height="${bottomAccentH}" fill="${accent}"/>`;

  const rawChips = (spec.feature_chips && spec.feature_chips.length
    ? spec.feature_chips
    : ["Clear Plan", "Framework", "Build Momentum", "Freedom"]
  ).slice(0, 4);
  while (rawChips.length < 4) rawChips.push("");
  const chipY = barY + 60;
  const chipSpan = usableW / 4;
  const chips = rawChips.map((label, i) => {
    const cx = PAD_X + chipSpan * i + chipSpan / 2;
    const iconTop = chipY;
    const labelY = iconTop + 110;
    const words = label.split(/\s+/);
    const lineA = words.slice(0, Math.ceil(words.length / 2)).join(" ").toUpperCase();
    const lineB = words.slice(Math.ceil(words.length / 2)).join(" ").toUpperCase();
    const iconSvg = CHIP_ICONS[i % CHIP_ICONS.length];
    return `
      <g transform="translate(${cx - 32}, ${iconTop})" color="${titleColor}">
        <g transform="scale(1.4)">${iconSvg}</g>
      </g>
      <text x="${cx}" y="${labelY}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="26" fill="${titleColor}" letter-spacing="2">${esc(lineA)}</text>
      ${lineB ? `<text x="${cx}" y="${labelY + 34}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="26" fill="${titleColor}" letter-spacing="2">${esc(lineB)}</text>` : ""}
    `;
  }).join("");

  // ---- Badge markup ----
  const badge = `<g>
    <rect x="${PAD_X}" y="${badgeY}" width="${badgeW}" height="${badgeH}" fill="${accent}" rx="4"/>
    <text x="${PAD_X + badgeW/2}" y="${badgeY + badgeH/2 + 18}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="900" font-size="46" fill="#0b0b0b" letter-spacing="4">${esc(badgeText)}</text>
  </g>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    ${heroClip}
    <linearGradient id="heroFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${bgFill}" stop-opacity="0"/>
      <stop offset="0.55" stop-color="${bgFill}" stop-opacity="0"/>
      <stop offset="1" stop-color="${bgFill}" stop-opacity="0.85"/>
    </linearGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.4" r="0.8">
      <stop offset="0.55" stop-color="${bgFill}" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.55"/>
    </radialGradient>
  </defs>

  <!-- solid dark field -->
  <rect x="0" y="0" width="${W}" height="${H}" fill="${bgFill}"/>

  <!-- hero illustration inside reserved zone -->
  ${hero}

  <!-- subtle vignette over the whole cover -->
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#vignette)"/>

  <!-- badge + title + rules + subtitle -->
  ${badge}
  ${titleTSpans}
  ${rules}
  ${subTSpans}

  <!-- bottom accent bar + feature chips -->
  ${bar}
  ${chips}
</svg>`;
}

export async function rasterizeSVG(svg: string, width = 1600): Promise<Uint8Array> {
  await ensureWasm();
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  return resvg.render().asPng();
}
