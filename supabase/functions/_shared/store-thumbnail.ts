// Store thumbnail renderer — pseudo-3D book mockup compositor.
// Produces a 3:4 photoreal-styled hardcover/paperback/workbook mockup with:
//   - studio backdrop gradient (category-tuned)
//   - contact shadow ellipse
//   - spine + top/side page edges (visible book thickness)
//   - front cover face tilted with a subtle perspective transform
//   - EXACT title / subtitle / badge baked in via SVG (never AI-spelled)
//   - category-specific accent motif behind the title
//   - highlight sheen + subtle cover texture overlay
//
// Deterministic — fonts embedded into resvg-wasm so glyphs actually render.
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
  bebas: "https://cdn.jsdelivr.net/npm/@fontsource/bebas-neue@5.0.20/files/bebas-neue-latin-400-normal.woff2",
  interBold: "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.20/files/inter-latin-700-normal.woff2",
  interMed: "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.20/files/inter-latin-500-normal.woff2",
  playfair: "https://cdn.jsdelivr.net/npm/@fontsource/playfair-display@5.0.20/files/playfair-display-latin-700-normal.woff2",
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
export type MockupKind = "hardcover" | "paperback" | "workbook" | "illustrated" | "modern_digital";

export interface ThumbStyle {
  key: string;
  backdrop_top: string;
  backdrop_bot: string;
  panel: string;        // front cover face
  panel_bot: string;    // subtle vertical gradient
  text: string;
  accent: string;
  badge_label: string;
  category_label: string;
  mockup: MockupKind;
  title_font: "bebas" | "playfair";
  motif: "finance" | "wellness" | "business" | "ai" | "productivity" | "kids" | "workbook" | "fiction" | "parenting" | "creative";
}

const STYLES: Record<string, ThumbStyle> = {
  finance:              { key: "finance",              backdrop_top: "#1a1712", backdrop_bot: "#050403", panel: "#0e0e10", panel_bot: "#050506", text: "#f4f2ee", accent: "#f5c518", badge_label: "DIGITAL EBOOK", category_label: "FINANCE",    mockup: "hardcover",  title_font: "bebas",    motif: "finance" },
  "personal-finance":   { key: "finance",              backdrop_top: "#1a1712", backdrop_bot: "#050403", panel: "#0e0e10", panel_bot: "#050506", text: "#f4f2ee", accent: "#f5c518", badge_label: "DIGITAL EBOOK", category_label: "FINANCE",    mockup: "hardcover",  title_font: "bebas",    motif: "finance" },
  "secret-finance":     { key: "finance",              backdrop_top: "#1a1712", backdrop_bot: "#050403", panel: "#0e0e10", panel_bot: "#050506", text: "#f4f2ee", accent: "#f5c518", badge_label: "DIGITAL EBOOK", category_label: "FINANCE",    mockup: "hardcover",  title_font: "bebas",    motif: "finance" },
  business_career:      { key: "business",             backdrop_top: "#0f1a2c", backdrop_bot: "#03060c", panel: "#111a2c", panel_bot: "#0a1220", text: "#f4f6fb", accent: "#22d3ee", badge_label: "PLAYBOOK",      category_label: "BUSINESS",   mockup: "hardcover",  title_font: "bebas",    motif: "business" },
  "career-side-hustle": { key: "business",             backdrop_top: "#0f1a2c", backdrop_bot: "#03060c", panel: "#0f1626", panel_bot: "#080c18", text: "#f4f6fb", accent: "#22d3ee", badge_label: "CAREER PLAYBOOK", category_label: "CAREER", mockup: "hardcover",  title_font: "bebas",    motif: "business" },
  "secret-ai":          { key: "ai",                   backdrop_top: "#141a2e", backdrop_bot: "#05070f", panel: "#0f1428", panel_bot: "#080b18", text: "#f0f4ff", accent: "#a78bfa", badge_label: "AI SYSTEM",     category_label: "AI SYSTEMS", mockup: "modern_digital", title_font: "bebas", motif: "ai" },
  "secret-productivity":{ key: "productivity",         backdrop_top: "#0f1e21", backdrop_bot: "#03080a", panel: "#0f1c1f", panel_bot: "#081214", text: "#eef7f6", accent: "#22d3ee", badge_label: "PLAYBOOK",      category_label: "PRODUCTIVITY", mockup: "hardcover", title_font: "bebas", motif: "productivity" },
  wellness_selfhelp:    { key: "wellness",             backdrop_top: "#dfe8de", backdrop_bot: "#8fa896", panel: "#f5efe4", panel_bot: "#e7ded0", text: "#132019", accent: "#1f7a5a", badge_label: "WELLNESS GUIDE", category_label: "WELLNESS", mockup: "paperback", title_font: "playfair", motif: "wellness" },
  "health-wellness":    { key: "wellness",             backdrop_top: "#dfe8de", backdrop_bot: "#8fa896", panel: "#f5efe4", panel_bot: "#e7ded0", text: "#132019", accent: "#1f7a5a", badge_label: "WELLNESS GUIDE", category_label: "WELLNESS", mockup: "paperback", title_font: "playfair", motif: "wellness" },
  parenting_family:     { key: "parenting",            backdrop_top: "#f2e3cf", backdrop_bot: "#c9a880", panel: "#fdf6ec", panel_bot: "#f0e3ce", text: "#3a2e1f", accent: "#e07a5f", badge_label: "PARENTING GUIDE", category_label: "PARENTING", mockup: "paperback", title_font: "playfair", motif: "parenting" },
  children_illustrated: { key: "kids",                 backdrop_top: "#fff3d6", backdrop_bot: "#f5c265", panel: "#fef7e6", panel_bot: "#fce8b2", text: "#1f2b4a", accent: "#e11d48", badge_label: "KIDS STORY",    category_label: "KIDS",      mockup: "illustrated", title_font: "playfair", motif: "kids" },
  creative_hobby:       { key: "creative",             backdrop_top: "#1e1732", backdrop_bot: "#07040f", panel: "#1c1730", panel_bot: "#120e22", text: "#f8f3ff", accent: "#f472b6", badge_label: "CREATIVE GUIDE", category_label: "CREATIVE", mockup: "modern_digital", title_font: "bebas", motif: "creative" },
  education_workbook:   { key: "workbook",             backdrop_top: "#e8ecf5", backdrop_bot: "#8996b6", panel: "#fbfaf5", panel_bot: "#efece0", text: "#0f172a", accent: "#c1121f", badge_label: "WORKBOOK",      category_label: "WORKBOOK",   mockup: "workbook",   title_font: "playfair", motif: "workbook" },
  beginner_guide:       { key: "workbook",             backdrop_top: "#e8ecf5", backdrop_bot: "#8996b6", panel: "#fbfaf5", panel_bot: "#efece0", text: "#0f172a", accent: "#facc15", badge_label: "STARTER GUIDE", category_label: "STARTER",   mockup: "workbook",   title_font: "playfair", motif: "workbook" },
  fiction_short:        { key: "fiction",              backdrop_top: "#121017", backdrop_bot: "#040305", panel: "#111117", panel_bot: "#07070b", text: "#f5f0e0", accent: "#ef4444", badge_label: "STORY",         category_label: "STORY",      mockup: "hardcover",  title_font: "playfair", motif: "fiction" },
  general:              { key: "finance",              backdrop_top: "#1a1712", backdrop_bot: "#050403", panel: "#0e0e10", panel_bot: "#050506", text: "#f4f2ee", accent: "#f5c518", badge_label: "DIGITAL EBOOK", category_label: "EBOOK",     mockup: "hardcover",  title_font: "bebas",    motif: "finance" },
};

export function resolveThumbStyle(categorySlug: string | null | undefined, title: string | null | undefined): ThumbStyle {
  const s = (categorySlug ?? "").toLowerCase().trim();
  if (STYLES[s]) return STYLES[s];
  const t = (title ?? "").toLowerCase();
  if (/child|kid|nursery|bedtime|story/.test(t)) return STYLES.children_illustrated;
  if (/energy|wellness|burnout|sleep|calm|health|body|reset|protocol/.test(t)) return STYLES.wellness_selfhelp;
  if (/planner|workbook|worksheet|template/.test(t)) return STYLES.education_workbook;
  if (/ai|prompt|automation|copilot|assistant/.test(t)) return STYLES["secret-ai"];
  if (/business|career|productivity|workday|playbook|team|manager|exec|application|bypass/.test(t)) return STYLES.business_career;
  if (/debt|money|wealth|finance|invest|budget|cash|payoff|feast|famine|fortress/.test(t)) return STYLES.finance;
  return STYLES.general;
}

// ---------- Text helpers ----------
function esc(s: string) {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function titleCharW(size: number, font: "bebas" | "playfair") {
  return font === "bebas" ? size * 0.48 : size * 0.56;
}
const subCharW = (size: number) => size * 0.5;

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

function fitTitle(text: string, maxWidth: number, maxLines: number, startSize: number, minSize: number, font: "bebas" | "playfair") {
  let size = startSize;
  const upper = font === "bebas" ? text.toUpperCase() : text;
  while (size >= minSize) {
    const lines = wrapByWidth(upper, maxWidth, (s) => titleCharW(s, font), size, maxLines);
    if (lines.length <= maxLines) return { size, lines };
    size -= 6;
  }
  return { size: minSize, lines: wrapByWidth(upper, maxWidth, (s) => titleCharW(s, font), minSize, maxLines).slice(0, maxLines) };
}

// ---------- Category motifs (behind title, low opacity) ----------
function motifSVG(motif: ThumbStyle["motif"], cx: number, cy: number, accent: string): string {
  const op = 0.14;
  switch (motif) {
    case "finance":
      // Ascending bar-chart / staircase to exit
      return `
        <g opacity="${op}" fill="${accent}">
          <rect x="${cx-220}" y="${cy+40}" width="70" height="90"/>
          <rect x="${cx-130}" y="${cy}" width="70" height="130"/>
          <rect x="${cx-40}" y="${cy-50}" width="70" height="180"/>
          <rect x="${cx+50}" y="${cy-110}" width="70" height="240"/>
          <rect x="${cx+140}" y="${cy-180}" width="70" height="310"/>
        </g>`;
    case "business":
      // Systems diagram — nodes connected
      return `
        <g opacity="${op}" stroke="${accent}" stroke-width="4" fill="none">
          <circle cx="${cx-180}" cy="${cy-60}" r="28" fill="${accent}"/>
          <circle cx="${cx}" cy="${cy+60}" r="28" fill="${accent}"/>
          <circle cx="${cx+180}" cy="${cy-60}" r="28" fill="${accent}"/>
          <line x1="${cx-180}" y1="${cy-60}" x2="${cx}" y2="${cy+60}"/>
          <line x1="${cx}" y1="${cy+60}" x2="${cx+180}" y2="${cy-60}"/>
          <line x1="${cx-180}" y1="${cy-60}" x2="${cx+180}" y2="${cy-60}"/>
        </g>`;
    case "ai":
      // Circuit-like grid
      return `
        <g opacity="${op}" stroke="${accent}" stroke-width="3" fill="none">
          <path d="M ${cx-220} ${cy} L ${cx-100} ${cy} L ${cx-100} ${cy-80} L ${cx+40} ${cy-80} L ${cx+40} ${cy+80} L ${cx+220} ${cy+80}"/>
          <circle cx="${cx-100}" cy="${cy}" r="10" fill="${accent}"/>
          <circle cx="${cx+40}" cy="${cy-80}" r="10" fill="${accent}"/>
          <circle cx="${cx+220}" cy="${cy+80}" r="10" fill="${accent}"/>
        </g>`;
    case "productivity":
      // Time-block grid
      return `
        <g opacity="${op}" fill="${accent}">
          ${Array.from({ length: 4 }).map((_, r) =>
            Array.from({ length: 5 }).map((_, c) =>
              `<rect x="${cx-230 + c*100}" y="${cy-140 + r*80}" width="80" height="60" rx="6"/>`
            ).join("")
          ).join("")}
        </g>`;
    case "wellness":
      // Concentric calm circles / sunrise
      return `
        <g opacity="${op}" fill="none" stroke="${accent}" stroke-width="6">
          <circle cx="${cx}" cy="${cy+40}" r="220"/>
          <circle cx="${cx}" cy="${cy+40}" r="160"/>
          <circle cx="${cx}" cy="${cy+40}" r="100"/>
        </g>`;
    case "parenting":
      // Heart/home
      return `
        <g opacity="${op}" fill="${accent}">
          <path d="M ${cx} ${cy+120} L ${cx-180} ${cy-40} L ${cx-180} ${cy+120} Z"/>
          <path d="M ${cx} ${cy+120} L ${cx+180} ${cy-40} L ${cx+180} ${cy+120} Z"/>
          <rect x="${cx-100}" y="${cy+30}" width="200" height="90"/>
        </g>`;
    case "kids":
      // Playful sun + clouds
      return `
        <g opacity="0.28" fill="${accent}">
          <circle cx="${cx+180}" cy="${cy-180}" r="70"/>
          <ellipse cx="${cx-140}" cy="${cy+180}" rx="120" ry="30"/>
          <ellipse cx="${cx+80}" cy="${cy+220}" rx="150" ry="34"/>
        </g>`;
    case "workbook":
      // Checklist rows
      return `
        <g opacity="${op}" fill="none" stroke="${accent}" stroke-width="5">
          ${[0,1,2,3].map((i) =>
            `<rect x="${cx-220}" y="${cy-150 + i*90}" width="60" height="60" rx="8"/>
             <line x1="${cx-140}" y1="${cy-120 + i*90}" x2="${cx+220}" y2="${cy-120 + i*90}"/>`
          ).join("")}
        </g>`;
    case "fiction":
      // Silhouette on horizon
      return `
        <g opacity="${op}">
          <rect x="${cx-260}" y="${cy+80}" width="520" height="4" fill="${accent}"/>
          <circle cx="${cx+120}" cy="${cy-20}" r="90" fill="${accent}"/>
        </g>`;
    case "creative":
      // Brush strokes
      return `
        <g opacity="${op}" fill="${accent}">
          <ellipse cx="${cx-100}" cy="${cy}" rx="180" ry="20" transform="rotate(-15 ${cx-100} ${cy})"/>
          <ellipse cx="${cx+80}" cy="${cy+40}" rx="160" ry="16" transform="rotate(-15 ${cx+80} ${cy+40})"/>
        </g>`;
  }
}

// ---------- SVG ----------
export interface StoreThumbInput {
  title: string;
  subtitle?: string | null;
  categorySlug?: string | null;
  price?: number | null;
}

export function buildStoreThumbnailSVG(input: StoreThumbInput): string {
  const W = 1200, H = 1600;
  const style = resolveThumbStyle(input.categorySlug, input.title);
  const isLight = ["wellness", "kids", "parenting", "workbook"].includes(style.key);
  const dimText = isLight
    ? "rgba(20,20,20,0.72)"
    : "rgba(244,242,238,0.78)";

  // Book front cover face — tall portrait, slight left tilt for depth.
  const bookW = 780;
  const bookH = 1100;
  const bookCX = W / 2;
  const bookCY = 820;
  const bookX = bookCX - bookW / 2;
  const bookY = bookCY - bookH / 2;
  const tiltDeg = -4; // subtle perspective tilt
  const spineDepth = 46;

  const padX = 62;
  const usableW = bookW - padX * 2;

  // ---------- Cover face content (drawn upright, then transformed) ----------
  // Title
  const rawTitle = (input.title ?? "").trim();
  const { size: titleSize, lines: titleLines } = fitTitle(rawTitle, usableW, 4, style.title_font === "bebas" ? 122 : 88, style.title_font === "bebas" ? 58 : 46, style.title_font);
  const titleLineH = titleSize * (style.title_font === "bebas" ? 0.96 : 1.08);
  const titleBlockH = titleLines.length * titleLineH;
  const titleTop = bookY + 260;

  const titleFontFamily = style.title_font === "bebas"
    ? "'Bebas Neue', Impact, 'Arial Black', sans-serif"
    : "'Playfair Display', Georgia, serif";
  const titleFontWeight = style.title_font === "bebas" ? "400" : "700";

  const titleTSpans = titleLines.map((ln, i) => {
    const ty = titleTop + titleSize * 0.82 + i * titleLineH;
    const useAccent =
      (titleLines.length === 1) ||
      (titleLines.length === 2 && i === 1) ||
      (titleLines.length >= 3 && i === 1);
    const fill = useAccent ? style.accent : style.text;
    return `<text x="${bookCX}" y="${ty}" text-anchor="middle" font-family="${titleFontFamily}" font-weight="${titleFontWeight}" font-size="${titleSize}" fill="${fill}" letter-spacing="${style.title_font === "bebas" ? 1 : 0}">${esc(ln)}</text>`;
  }).join("");

  const titleBottom = titleTop + titleBlockH;

  // Subtitle
  const subRaw = (input.subtitle ?? "").trim().slice(0, 140);
  const subSize = 30;
  const subLines = subRaw ? wrapByWidth(subRaw, usableW - 40, subCharW, subSize).slice(0, 1) : [];
  const subGap = 40;
  const ruleTopY = titleBottom + subGap;
  const subStartY = ruleTopY + 40 + subSize * 0.5;
  const subBlockH = subLines.length * (subSize * 1.35);
  const ruleBottomY = ruleTopY + Math.max(subBlockH + 76, 76);

  const subTSpans = subLines.map((ln, i) => {
    const ty = subStartY + i * (subSize * 1.35);
    return `<text x="${bookCX}" y="${ty}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="500" font-size="${subSize}" fill="${dimText}">${esc(ln)}</text>`;
  }).join("");

  const ruleX = bookX + padX + 20;
  const ruleW = usableW - 40;
  const rules = subLines.length > 0 ? `
    <line x1="${ruleX}" y1="${ruleTopY}" x2="${ruleX + ruleW}" y2="${ruleTopY}" stroke="${style.text}" stroke-opacity="${isLight ? 0.35 : 0.5}" stroke-width="1.5"/>
    <line x1="${ruleX}" y1="${ruleBottomY}" x2="${ruleX + ruleW}" y2="${ruleBottomY}" stroke="${style.text}" stroke-opacity="${isLight ? 0.35 : 0.5}" stroke-width="1.5"/>
  ` : "";

  // Badge (top). Accurate width from real glyph metrics so long labels like
  // "PRODUCTIVITY PLAYBOOK" or "INCOME SYSTEM" always fit inside the pill.
  // Previous const 20px/char under-sized the pill and text-anchor="middle"
  // pushed characters past both pill edges, which the 3D compositor cropped
  // ("INCOME SYSTEM" → "NOME SYSTEM").
  const badgeText = style.badge_label.toUpperCase();
  const BADGE_GLYPH_ADVANCE = 21.5 + 5; // font-size 26 bold + letter-spacing 5
  const BADGE_PAD_X = 28;
  const badgeTextW = Math.max(1, badgeText.length) * BADGE_GLYPH_ADVANCE;
  const badgeW = Math.max(220, Math.round(badgeTextW + BADGE_PAD_X * 2));
  const badgeH = 62;
  const badgeX = bookCX - badgeW / 2;
  const badgeY = bookY + 130;
  const badgeTextFill = isLight ? "#ffffff" : "#0b0b0b";
  const badge = `
    <rect x="${badgeX}" y="${badgeY}" width="${badgeW}" height="${badgeH}" fill="${style.accent}" rx="3"/>
    <text x="${badgeX + BADGE_PAD_X}" y="${badgeY + badgeH/2 + 10}" text-anchor="start" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="700" font-size="26" fill="${badgeTextFill}" letter-spacing="5">${esc(badgeText)}</text>
  `;

  // Bottom brand strip + accent bar
  const barY = bookY + bookH - 150;
  const bar = `<rect x="${bookX + padX}" y="${barY}" width="${usableW}" height="4" fill="${style.accent}"/>`;
  const brand = `<text x="${bookCX}" y="${barY + 52}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="700" font-size="26" fill="${style.text}" letter-spacing="8">SECRET PDF</text>`;
  const cat   = `<text x="${bookCX}" y="${barY + 92}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="500" font-size="20" fill="${dimText}" letter-spacing="6">${esc(style.category_label)}</text>`;

  // Motif behind title
  const motif = motifSVG(style.motif, bookCX, bookY + 680, style.accent);

  // ---------- Book body (pseudo-3D geometry) ----------
  // Spine drawn behind and to the left, matching tilt
  const spineFillDark = isLight ? "#8f8577" : "#000";
  const spine = `
    <g transform="rotate(${tiltDeg} ${bookCX} ${bookCY})">
      <polygon points="
        ${bookX - spineDepth},${bookY + 10}
        ${bookX},${bookY}
        ${bookX},${bookY + bookH}
        ${bookX - spineDepth + 4},${bookY + bookH - 10}
      " fill="${spineFillDark}" opacity="${isLight ? 0.55 : 0.75}"/>
      <!-- spine sheen -->
      <line x1="${bookX - spineDepth/2}" y1="${bookY + 10}" x2="${bookX - spineDepth/2 + 2}" y2="${bookY + bookH - 10}" stroke="${style.accent}" stroke-opacity="0.35" stroke-width="2"/>
    </g>
  `;

  // Page edges — top and right cream stripes with fine lines
  const pageEdges = `
    <g transform="rotate(${tiltDeg} ${bookCX} ${bookCY})">
      <!-- top page edge -->
      <polygon points="
        ${bookX},${bookY}
        ${bookX + bookW},${bookY}
        ${bookX + bookW - 8},${bookY - 8}
        ${bookX - 8},${bookY - 8}
      " fill="#f4ecd8"/>
      <!-- right page edge -->
      <polygon points="
        ${bookX + bookW},${bookY}
        ${bookX + bookW + 12},${bookY + 12}
        ${bookX + bookW + 12},${bookY + bookH + 4}
        ${bookX + bookW},${bookY + bookH}
      " fill="#e9dfc4"/>
      <!-- fine page lines -->
      ${Array.from({ length: 30 }).map((_, i) =>
        `<line x1="${bookX + bookW + 1}" y1="${bookY + 20 + i * ((bookH - 40) / 30)}" x2="${bookX + bookW + 11}" y2="${bookY + 20 + i * ((bookH - 40) / 30)}" stroke="#c9bfa4" stroke-width="0.8" opacity="0.7"/>`
      ).join("")}
    </g>
  `;

  // Front cover panel (with gradient + sheen) — the tilted group holds all cover content
  const cover = `
    <g transform="rotate(${tiltDeg} ${bookCX} ${bookCY})">
      <rect x="${bookX}" y="${bookY}" width="${bookW}" height="${bookH}" fill="url(#panelGrad)"/>
      ${motif}
      <rect x="${bookX}" y="${bookY}" width="${bookW}" height="${bookH}" fill="url(#panelSheen)"/>
      ${badge}
      ${titleTSpans}
      ${rules}
      ${subTSpans}
      ${bar}
      ${brand}
      ${cat}
      <!-- inner bevel -->
      <rect x="${bookX + 2}" y="${bookY + 2}" width="${bookW - 4}" height="${bookH - 4}" fill="none" stroke="${isLight ? "#00000033" : "#ffffff18"}" stroke-width="2"/>
    </g>
  `;

  // Contact shadow
  const shadow = `
    <ellipse cx="${bookCX}" cy="${bookY + bookH + 60}" rx="${bookW / 1.8}" ry="30" fill="#000" opacity="${isLight ? 0.35 : 0.55}"/>
    <ellipse cx="${bookCX}" cy="${bookY + bookH + 62}" rx="${bookW / 2.4}" ry="14" fill="#000" opacity="${isLight ? 0.45 : 0.7}"/>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${style.backdrop_top}"/>
      <stop offset="0.65" stop-color="${style.backdrop_bot}"/>
      <stop offset="1" stop-color="${isLight ? "#3a3a3a" : "#000"}"/>
    </linearGradient>
    <radialGradient id="vign" cx="0.5" cy="0.55" r="0.75">
      <stop offset="0.6" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="${isLight ? 0.35 : 0.55}"/>
    </radialGradient>
    <linearGradient id="panelGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${style.panel}"/>
      <stop offset="1" stop-color="${style.panel_bot}"/>
    </linearGradient>
    <linearGradient id="panelSheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="0.18" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.82" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.22"/>
    </linearGradient>
  </defs>

  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgGrad)"/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#vign)"/>

  ${shadow}
  ${spine}
  ${pageEdges}
  ${cover}
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
  score: number;
  passed: boolean;
  reasons: string[];
  checks: {
    has_bytes: boolean;
    title_present_in_svg: boolean;
    title_readable_size: boolean;
    dimensions_ok: boolean;
    non_blank_ratio: boolean;
    has_book_geometry: boolean;
    has_category_motif: boolean;
  };
  scores: {
    book_realism_score: number;
    title_readability_score: number;
    topic_style_match_score: number;
    store_click_appeal_score: number;
    thumbnail_layout_score: number;
    final_store_thumbnail_score: number;
  };
  asset_type: "photoreal_3d_book";
  generation_mode: "deterministic_cover_plus_3d_mockup";
}

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
  const svgUpper = input.svg.toUpperCase();
  const title_present_in_svg = !!firstWord && svgUpper.includes(firstWord);
  if (!title_present_in_svg) reasons.push("title_not_in_svg");

  const sizeMatches = Array.from(input.svg.matchAll(/font-size="(\d+)"/g)).map((m) => Number(m[1]));
  const maxSize = sizeMatches.length ? Math.max(...sizeMatches) : 0;
  const title_readable_size = maxSize >= 54;
  if (!title_readable_size) reasons.push(`max_font=${maxSize}<54`);

  const dimensions_ok = input.svg.includes('width="1200"') && input.svg.includes('height="1600"');
  if (!dimensions_ok) reasons.push("dimensions");

  const non_blank_ratio = input.bytes.byteLength > 20_000;
  if (!non_blank_ratio) reasons.push("looks_blank");

  // Book geometry — spine + page edges + tilt transform must all be present.
  const has_book_geometry =
    input.svg.includes("panelGrad") &&
    input.svg.includes("<polygon") &&
    /rotate\(-?\d/.test(input.svg);
  if (!has_book_geometry) reasons.push("no_book_geometry");

  // Category motif — motifSVG always emits at least one shape group.
  const has_category_motif = /opacity="0\.\d+"[\s\S]{0,80}(fill|stroke)="#/.test(input.svg);
  if (!has_category_motif) reasons.push("no_motif");

  const checks = {
    has_bytes, title_present_in_svg, title_readable_size,
    dimensions_ok, non_blank_ratio, has_book_geometry, has_category_motif,
  };
  const passedCount = Object.values(checks).filter(Boolean).length;
  const totalChecks = Object.values(checks).length;

  // Derive component scores from checks (deterministic, defensible).
  const book_realism_score       = (has_book_geometry ? 90 : 40) + (non_blank_ratio ? 6 : 0);
  const title_readability_score  = (title_present_in_svg ? 60 : 0) + (title_readable_size ? 35 : 0) + (maxSize >= 70 ? 5 : 0);
  const topic_style_match_score  = has_category_motif ? 92 : 55;
  const thumbnail_layout_score   = dimensions_ok ? 95 : 50;
  const store_click_appeal_score = Math.round((book_realism_score + topic_style_match_score + title_readability_score) / 3);
  const final_store_thumbnail_score = Math.round((passedCount / totalChecks) * 100);

  const scoreGates =
    title_readability_score >= 90 &&
    book_realism_score >= 85 &&
    topic_style_match_score >= 85 &&
    final_store_thumbnail_score >= 90;

  return {
    score: final_store_thumbnail_score,
    passed: reasons.length === 0 && scoreGates,
    reasons,
    checks,
    scores: {
      book_realism_score,
      title_readability_score,
      topic_style_match_score,
      store_click_appeal_score,
      thumbnail_layout_score,
      final_store_thumbnail_score,
    },
    asset_type: "photoreal_3d_book",
    generation_mode: "deterministic_cover_plus_3d_mockup",
  };
}
