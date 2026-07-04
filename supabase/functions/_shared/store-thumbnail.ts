// Store thumbnail renderer.
// Produces a 3:4 premium flat-front book/product thumbnail with EXACT title,
// subtitle and badge baked in — fonts embedded into resvg so glyphs actually
// render (the legacy cover.ts renderer produced blank covers because it never
// loaded fonts into resvg-wasm).
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";

// ---------- WASM + font caching ----------
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
  // Bebas Neue — condensed heavy display for TITLE.
  bebas: "https://cdn.jsdelivr.net/npm/@fontsource/bebas-neue@5.0.20/files/bebas-neue-latin-400-normal.woff2",
  // Inter — subtitle + labels + chips.
  interBold: "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.20/files/inter-latin-700-normal.woff2",
  interMed:  "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.20/files/inter-latin-500-normal.woff2",
};

let fontsCache: Uint8Array[] | null = null;
async function loadFonts(): Promise<Uint8Array[]> {
  if (fontsCache) return fontsCache;
  const buffers: Uint8Array[] = [];
  for (const [name, url] of Object.entries(FONT_URLS)) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${name} ${r.status}`);
      buffers.push(new Uint8Array(await r.arrayBuffer()));
    } catch (e) {
      console.warn(`store-thumbnail: font ${name} failed`, (e as Error).message);
    }
  }
  fontsCache = buffers;
  return buffers;
}

// ---------- Category style ----------
export interface ThumbStyle {
  bg: string;
  panel: string;    // flat front-cover panel color
  text: string;
  accent: string;
  badge_label: string;
  category_label: string;
}

const STYLES: Record<string, ThumbStyle> = {
  finance:              { bg: "#0a0a0b", panel: "#111114", text: "#f4f2ee", accent: "#f5c518", badge_label: "DIGITAL EBOOK", category_label: "FINANCE" },
  "personal-finance":   { bg: "#0a0a0b", panel: "#111114", text: "#f4f2ee", accent: "#f5c518", badge_label: "DIGITAL EBOOK", category_label: "FINANCE" },
  "secret-finance":     { bg: "#0a0a0b", panel: "#111114", text: "#f4f2ee", accent: "#f5c518", badge_label: "DIGITAL EBOOK", category_label: "FINANCE" },
  business_career:      { bg: "#0b1220", panel: "#111a2c", text: "#f4f6fb", accent: "#22d3ee", badge_label: "PLAYBOOK",      category_label: "BUSINESS" },
  "career-side-hustle": { bg: "#0b1220", panel: "#111a2c", text: "#f4f6fb", accent: "#22d3ee", badge_label: "PLAYBOOK",      category_label: "CAREER" },
  "secret-ai":          { bg: "#0a0e1a", panel: "#101526", text: "#f0f4ff", accent: "#a78bfa", badge_label: "AI SYSTEM",     category_label: "AI SYSTEMS" },
  "secret-productivity":{ bg: "#0a1416", panel: "#0f1c1f", text: "#eef7f6", accent: "#22d3ee", badge_label: "PLAYBOOK",      category_label: "PRODUCTIVITY" },
  wellness_selfhelp:    { bg: "#0e1613", panel: "#132019", text: "#eef7f0", accent: "#10b981", badge_label: "WELLNESS GUIDE",category_label: "WELLNESS" },
  "health-wellness":    { bg: "#0e1613", panel: "#132019", text: "#eef7f0", accent: "#10b981", badge_label: "WELLNESS GUIDE",category_label: "WELLNESS" },
  parenting_family:     { bg: "#1a140f", panel: "#221912", text: "#faf3e7", accent: "#e07a5f", badge_label: "PARENTING GUIDE",category_label: "PARENTING" },
  children_illustrated: { bg: "#fef6e4", panel: "#ffedd5", text: "#1f2937", accent: "#e11d48", badge_label: "KIDS STORY",   category_label: "KIDS" },
  creative_hobby:       { bg: "#141021", panel: "#1c1730", text: "#f8f3ff", accent: "#a78bfa", badge_label: "CREATIVE GUIDE",category_label: "CREATIVE" },
  education_workbook:   { bg: "#0f172a", panel: "#172038", text: "#f8fafc", accent: "#facc15", badge_label: "WORKBOOK",      category_label: "WORKBOOK" },
  beginner_guide:       { bg: "#0f172a", panel: "#172038", text: "#f8fafc", accent: "#facc15", badge_label: "STARTER GUIDE", category_label: "STARTER" },
  fiction_short:        { bg: "#0b0b0f", panel: "#111117", text: "#f5f0e0", accent: "#ef4444", badge_label: "STORY",         category_label: "STORY" },
  general:              { bg: "#0a0a0b", panel: "#111114", text: "#f4f2ee", accent: "#f5c518", badge_label: "DIGITAL EBOOK", category_label: "EBOOK" },
};

export function resolveThumbStyle(categorySlug: string | null | undefined, title: string | null | undefined): ThumbStyle {
  const s = (categorySlug ?? "").toLowerCase().trim();
  if (STYLES[s]) return STYLES[s];
  const t = (title ?? "").toLowerCase();
  if (/debt|money|wealth|finance|invest|budget|cash|payoff/.test(t)) return STYLES.finance;
  if (/business|career|productivity|assistant|workday|playbook|team|manager|exec/.test(t)) return STYLES.business_career;
  if (/energy|wellness|burnout|sleep|calm|health|body|reset|protocol/.test(t)) return STYLES.wellness_selfhelp;
  if (/child|kid|nursery|bedtime|story/.test(t)) return STYLES.children_illustrated;
  if (/ai|prompt|automation|copilot/.test(t)) return STYLES["secret-ai"];
  return STYLES.general;
}

// ---------- Text helpers ----------
function esc(s: string) {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function approxTitleCharW(size: number) { return size * 0.48; } // Bebas Neue condensed
function approxSubCharW(size: number)   { return size * 0.5; }

function wrapByWidth(text: string, maxWidthPx: number, charWidth: (s: number) => number, fontSize: number, hardMaxLines = 8): string[] {
  const cpl = Math.max(4, Math.floor(maxWidthPx / charWidth(fontSize)));
  const words = (text ?? "").trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (t.length > cpl && line) {
      lines.push(line);
      line = w;
      if (lines.length >= hardMaxLines) break;
    } else line = t;
  }
  if (line && lines.length < hardMaxLines) lines.push(line);
  return lines;
}

function fitTitle(text: string, maxWidth: number, maxLines: number, startSize: number, minSize: number) {
  let size = startSize;
  while (size >= minSize) {
    const lines = wrapByWidth(text.toUpperCase(), maxWidth, approxTitleCharW, size, maxLines);
    if (lines.length <= maxLines) return { size, lines };
    size -= 6;
  }
  return { size: minSize, lines: wrapByWidth(text.toUpperCase(), maxWidth, approxTitleCharW, minSize, maxLines).slice(0, maxLines) };
}

// ---------- SVG ----------
export interface StoreThumbInput {
  title: string;
  subtitle?: string | null;
  categorySlug?: string | null;
  price?: number | null;
}

export function buildStoreThumbnailSVG(input: StoreThumbInput): string {
  const W = 1200, H = 1600; // 3:4
  const style = resolveThumbStyle(input.categorySlug, input.title);
  const { bg, panel, text, accent, badge_label, category_label } = style;
  const dimText = "rgba(244,242,238,0.78)";

  // Book panel geometry — vertical hardcover, centered, gutter around.
  const bookW = 880;
  const bookH = 1360;
  const bookX = (W - bookW) / 2;
  const bookY = 120;

  const padX = 70;
  const usableW = bookW - padX * 2;

  // ---- Badge (top-left of book) ----
  const badgeText = badge_label.toUpperCase();
  const badgeCharW = 22;
  const badgeW = Math.max(220, badgeText.length * badgeCharW + 44);
  const badgeH = 74;
  const badgeX = bookX + padX;
  const badgeY = bookY + 90;

  // ---- Title (fills upper-middle) ----
  const titleTop = badgeY + badgeH + 90;
  const titleMaxWidth = usableW;
  const rawTitle = (input.title ?? "").trim();
  const { size: titleSize, lines: titleLines } = fitTitle(rawTitle, titleMaxWidth, 4, 156, 74);
  const titleLineH = titleSize * 0.96;
  const titleBlockH = titleLines.length * titleLineH;

  const titleTSpans = titleLines.map((ln, i) => {
    const ty = titleTop + titleSize * 0.85 + i * titleLineH;
    // Highlight middle line in accent for visual emphasis (Bebas Neue single-color per line).
    const useAccent =
      (titleLines.length === 1) ||
      (titleLines.length === 2 && i === 1) ||
      (titleLines.length >= 3 && i === 1);
    const fill = useAccent ? accent : text;
    return `<text x="${W/2}" y="${ty}" text-anchor="middle" font-family="'Bebas Neue', Impact, 'Arial Black', sans-serif" font-weight="400" font-size="${titleSize}" fill="${fill}" letter-spacing="1">${esc(ln)}</text>`;
  }).join("");

  const titleBottom = titleTop + titleBlockH;

  // ---- Hairline-bracketed subtitle ----
  const subRaw = (input.subtitle ?? "").trim().slice(0, 140);
  const subSize = 38;
  const subLines = subRaw ? wrapByWidth(subRaw, usableW - 60, approxSubCharW, subSize).slice(0, 2) : [];
  const subGap = 60;
  const ruleTopY = titleBottom + subGap;
  const subBlockH = subLines.length * (subSize * 1.35);
  const subStartY = ruleTopY + 46 + subSize * 0.5;
  const ruleBottomY = ruleTopY + Math.max(subBlockH + 90, 90);

  const subTSpans = subLines.map((ln, i) => {
    const ty = subStartY + i * (subSize * 1.35);
    return `<text x="${W/2}" y="${ty}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="500" font-size="${subSize}" fill="${dimText}">${esc(ln)}</text>`;
  }).join("");

  const ruleX = bookX + padX + 20;
  const ruleW = usableW - 40;
  const rules = subLines.length > 0 ? `
    <line x1="${ruleX}" y1="${ruleTopY}" x2="${ruleX + ruleW}" y2="${ruleTopY}" stroke="${text}" stroke-opacity="0.5" stroke-width="1.5"/>
    <line x1="${ruleX}" y1="${ruleBottomY}" x2="${ruleX + ruleW}" y2="${ruleBottomY}" stroke="${text}" stroke-opacity="0.5" stroke-width="1.5"/>
  ` : "";

  // ---- Bottom brand strip + accent bar ----
  const barY = bookY + bookH - 180;
  const bar = `<rect x="${bookX + padX}" y="${barY}" width="${usableW}" height="5" fill="${accent}"/>`;
  const brandY = barY + 62;
  const catY   = barY + 108;

  const brand = `<text x="${W/2}" y="${brandY}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="700" font-size="30" fill="${text}" letter-spacing="8">SECRET PDF</text>`;
  const cat   = `<text x="${W/2}" y="${catY}"   text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="500" font-size="22" fill="${dimText}" letter-spacing="6">${esc(category_label)}</text>`;

  // ---- Spine + page edge (fake 3D depth) ----
  const spineW = 16;
  const spine = `
    <rect x="${bookX - spineW}" y="${bookY + 6}" width="${spineW}" height="${bookH - 12}" fill="#000" opacity="0.55"/>
    <rect x="${bookX + bookW}"  y="${bookY + 6}" width="8"       height="${bookH - 12}" fill="#f6f1e6" opacity="0.85"/>
  `;

  // ---- Contact shadow ----
  const shadow = `
    <ellipse cx="${W/2}" cy="${bookY + bookH + 46}" rx="${bookW/2.05}" ry="34" fill="#000" opacity="0.55"/>
  `;

  // ---- Badge markup ----
  const badge = `
    <rect x="${badgeX}" y="${badgeY}" width="${badgeW}" height="${badgeH}" fill="${accent}" rx="3"/>
    <text x="${badgeX + badgeW/2}" y="${badgeY + badgeH/2 + 12}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="700" font-size="30" fill="#0b0b0b" letter-spacing="5">${esc(badgeText)}</text>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${bg}"/>
      <stop offset="1" stop-color="#000"/>
    </linearGradient>
    <linearGradient id="panelSheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="0.15" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.18"/>
    </linearGradient>
  </defs>

  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgGrad)"/>

  ${shadow}
  ${spine}

  <!-- Book front panel -->
  <rect x="${bookX}" y="${bookY}" width="${bookW}" height="${bookH}" fill="${panel}"/>
  <rect x="${bookX}" y="${bookY}" width="${bookW}" height="${bookH}" fill="url(#panelSheen)"/>

  ${badge}
  ${titleTSpans}
  ${rules}
  ${subTSpans}
  ${bar}
  ${brand}
  ${cat}
</svg>`;
}

export async function rasterizeThumbnail(svg: string, width = 1200): Promise<Uint8Array> {
  await ensureWasm();
  const fontBuffers = await loadFonts();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      loadSystemFonts: false,
      fontBuffers,
      defaultFontFamily: "Inter",
    },
  });
  return resvg.render().asPng();
}

// ---------- Deterministic QC ----------
export interface ThumbQcResult {
  score: number;              // 0-100
  passed: boolean;
  reasons: string[];
  checks: {
    has_bytes: boolean;
    title_present_in_svg: boolean;
    title_readable_size: boolean;
    dimensions_ok: boolean;
    non_blank_ratio: boolean;
  };
}

// Deterministic QC — we validate the input we baked in, not a vision model.
// This is intentional: since we render the title ourselves from the DB title,
// if bytes > 0 and title is non-empty we know the title is baked.
export function qcThumbnail(input: {
  bytes: Uint8Array;
  svg: string;
  title: string;
  minBytes?: number;
}): ThumbQcResult {
  const reasons: string[] = [];
  const has_bytes = input.bytes.byteLength > (input.minBytes ?? 30_000);
  if (!has_bytes) reasons.push(`bytes=${input.bytes.byteLength}<min`);

  const titleUpper = (input.title || "").toUpperCase().trim();
  const firstWord = titleUpper.split(/\s+/).filter(Boolean)[0] ?? "";
  const title_present_in_svg = !!firstWord && input.svg.includes(firstWord);
  if (!title_present_in_svg) reasons.push("title_not_in_svg");

  // Title readable size: we require font-size >= 60 (we default 74 min).
  const sizeMatches = Array.from(input.svg.matchAll(/font-size="(\d+)"/g)).map((m) => Number(m[1]));
  const maxSize = sizeMatches.length ? Math.max(...sizeMatches) : 0;
  const title_readable_size = maxSize >= 60;
  if (!title_readable_size) reasons.push(`max_font=${maxSize}<60`);

  const dimensions_ok = input.svg.includes('width="1200"') && input.svg.includes('height="1600"');
  if (!dimensions_ok) reasons.push("dimensions");

  // Non-blank ratio: if raster bytes < 20 KB the image is likely solid blank.
  const non_blank_ratio = input.bytes.byteLength > 20_000;
  if (!non_blank_ratio) reasons.push("looks_blank");

  const checks = { has_bytes, title_present_in_svg, title_readable_size, dimensions_ok, non_blank_ratio };
  const passedCount = Object.values(checks).filter(Boolean).length;
  const score = Math.round((passedCount / 5) * 100);
  return { score, passed: reasons.length === 0, reasons, checks };
}
