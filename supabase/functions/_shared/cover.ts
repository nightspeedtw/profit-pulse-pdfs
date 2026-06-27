// Premium cover composition: build SVG with bulletproof text overlay and rasterize to PNG.
// All text is rendered by code on top of a text-free AI background.
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
  color_palette: string[]; // [bg_overlay, primary_text, accent]
  typography_style: string;
  thumbnail_readability_notes: string;
  why_this_cover_sells: string;
  cover_qc_checklist: string[];
}

function esc(s: string) {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Approx char width per font-size (Inter Black ~0.55em uppercase)
function approxTitleCharW(size: number) { return size * 0.56; }
function approxSubCharW(size: number) { return size * 0.5; }

function wrapByWidth(text: string, maxWidthPx: number, charWidth: (s: number) => number, fontSize: number): string[] {
  const cpl = Math.max(6, Math.floor(maxWidthPx / charWidth(fontSize)));
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

// Auto-fit: shrink font until title fits in maxLines and panel width
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

export function buildCoverSVG(spec: CoverSpec, bgPng: Uint8Array): string {
  const W = 1600, H = 2400;
  const palette = (spec.color_palette ?? []).filter(Boolean);
  const overlay = palette[0] ?? "#0b1a2b";
  const titleColor = palette[1] ?? "#ffffff";
  const accent = palette[2] ?? "#f5c518";
  const layout = (spec.layout_direction || "bottom").toLowerCase();

  // base64 bg
  let b64 = "";
  const chunk = 0x8000;
  for (let i = 0; i < bgPng.length; i += chunk) {
    b64 += String.fromCharCode(...bgPng.subarray(i, i + chunk));
  }
  const bgData = `data:image/png;base64,${btoa(b64)}`;

  const PAD_X = 130;
  const usableW = W - PAD_X * 2;

  // ---- Auto-fit title ----
  const titleRaw = (spec.title_text || "").trim().slice(0, 60);
  const { size: titleSize, lines: titleLines } = fitTitle(titleRaw, usableW, 3, 220, 110);
  const titleLineH = titleSize * 1.02;

  // ---- Subtitle ----
  const subRaw = (spec.subtitle_text || "").trim().slice(0, 120);
  const subSize = 46;
  const subLines = wrapByWidth(subRaw, usableW, approxSubCharW, subSize).slice(0, 3);
  const subLineH = subSize * 1.3;

  // ---- Brand / badge ----
  const brandSize = 34;
  const badgeSize = 32;
  const badgeText = (spec.badge_text || "").trim().slice(0, 36).toUpperCase();
  const brandText = (spec.brand_text || "SECRET PDF").trim().toUpperCase();

  // ---- Block heights ----
  const accentBarH = 14;
  const gapAfterAccent = 50;
  const gapTitleSub = 60;
  const titleBlockH = titleLines.length * titleLineH;
  const subBlockH = subLines.length ? subLines.length * subLineH : 0;
  const blockH = accentBarH + gapAfterAccent + titleBlockH + (subLines.length ? gapTitleSub + subBlockH : 0);

  // ---- Panel placement ----
  const panelPad = 180;
  let panelY: number, panelH: number, contentTopY: number;
  if (layout === "top") {
    panelH = blockH + panelPad * 1.4;
    panelY = 0;
    contentTopY = 280;
  } else if (layout === "center") {
    panelH = blockH + panelPad;
    panelY = (H - panelH) / 2;
    contentTopY = panelY + panelPad / 2;
  } else {
    panelH = blockH + panelPad + 120; // reserve brand area
    panelY = H - panelH;
    contentTopY = panelY + panelPad / 2;
  }

  // ---- Draw title ----
  let y = contentTopY;
  const accentBar = `<rect x="${PAD_X}" y="${y}" width="140" height="${accentBarH}" fill="${accent}" rx="2"/>`;
  y += accentBarH + gapAfterAccent;
  const titleStartY = y + titleSize * 0.85;
  const titleTSpans = titleLines.map((ln, i) => {
    const ty = titleStartY + i * titleLineH;
    return `<text x="${PAD_X}" y="${ty}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-weight="900" font-size="${titleSize}" fill="${titleColor}" letter-spacing="-3">${esc(ln)}</text>`;
  }).join("");
  y += titleBlockH;

  // ---- Subtitle ----
  let subTSpans = "";
  if (subLines.length) {
    y += gapTitleSub;
    const subStartY = y + subSize * 0.85;
    subTSpans = subLines.map((ln, i) => {
      const ty = subStartY + i * subLineH;
      return `<text x="${PAD_X}" y="${ty}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-weight="400" font-size="${subSize}" fill="${titleColor}" opacity="0.92">${esc(ln)}</text>`;
    }).join("");
  }

  // ---- Brand pinned to bottom of panel ----
  const brandY = panelY + panelH - 60;
  const brand = `<text x="${PAD_X}" y="${brandY}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-weight="700" font-size="${brandSize}" fill="${titleColor}" opacity="0.85" letter-spacing="6">${esc(brandText)}</text>`;
  // small accent dot before brand
  const brandDot = `<circle cx="${PAD_X - 24}" cy="${brandY - 10}" r="6" fill="${accent}"/>`;

  // ---- Badge at top ----
  const badge = badgeText
    ? (() => {
        const padX = 32;
        const bw = Math.min(badgeText.length * 18 + padX * 2, 1000);
        const bh = 70;
        const bx = PAD_X, by = 140;
        return `<g>
          <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${bh/2}" fill="${accent}"/>
          <text x="${bx + padX}" y="${by + bh/2 + badgeSize/3}" font-family="Inter, Arial, sans-serif" font-weight="800" font-size="${badgeSize}" fill="#0b0b0b" letter-spacing="2">${esc(badgeText)}</text>
        </g>`;
      })()
    : "";

  // ---- Legibility gradient over background, stronger near panel ----
  const gradStops = layout === "top"
    ? `<stop offset="0" stop-color="${overlay}" stop-opacity="0.92"/><stop offset="0.5" stop-color="${overlay}" stop-opacity="0.55"/><stop offset="1" stop-color="${overlay}" stop-opacity="0"/>`
    : layout === "center"
    ? `<stop offset="0" stop-color="${overlay}" stop-opacity="0"/><stop offset="0.5" stop-color="${overlay}" stop-opacity="0.85"/><stop offset="1" stop-color="${overlay}" stop-opacity="0"/>`
    : `<stop offset="0" stop-color="${overlay}" stop-opacity="0"/><stop offset="0.35" stop-color="${overlay}" stop-opacity="0.4"/><stop offset="1" stop-color="${overlay}" stop-opacity="0.96"/>`;

  // Subtle inner border
  const border = `<rect x="20" y="20" width="${W-40}" height="${H-40}" fill="none" stroke="${accent}" stroke-width="3" opacity="0.35"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="${panelY}" x2="0" y2="${panelY + panelH}" gradientUnits="userSpaceOnUse">${gradStops}</linearGradient>
    <filter id="ts" x="-5%" y="-5%" width="110%" height="110%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="4"/>
      <feOffset dx="0" dy="3"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.6"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <image href="${bgData}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
  <rect x="0" y="${panelY}" width="${W}" height="${panelH}" fill="url(#g)"/>
  ${badge}
  <g filter="url(#ts)">
    ${accentBar}
    ${titleTSpans}
    ${subTSpans}
    ${brandDot}
    ${brand}
  </g>
  ${border}
</svg>`;
}

export async function rasterizeSVG(svg: string, width = 1600): Promise<Uint8Array> {
  await ensureWasm();
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  return resvg.render().asPng();
}
