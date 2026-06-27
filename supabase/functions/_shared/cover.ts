// Cover composition helpers: build SVG with text overlay and rasterize to PNG.
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
function wrap(text: string, maxChars: number): string[] {
  const words = (text ?? "").split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (t.length > maxChars && line) { lines.push(line); line = w; }
    else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Build an SVG of the full cover (2:3) by embedding the background PNG as a data URL
 * and overlaying readable title/subtitle/brand/badge text. Returns the SVG string.
 */
export function buildCoverSVG(spec: CoverSpec, bgPng: Uint8Array): string {
  const W = 1600, H = 2400;
  const palette = (spec.color_palette ?? []).filter(Boolean);
  const overlay = palette[0] ?? "#000000";
  const titleColor = palette[1] ?? "#ffffff";
  const accent = palette[2] ?? "#f5c518";
  const layout = (spec.layout_direction || "bottom").toLowerCase();

  // base64 encode bg
  let b64 = "";
  const chunk = 0x8000;
  for (let i = 0; i < bgPng.length; i += chunk) {
    b64 += String.fromCharCode(...bgPng.subarray(i, i + chunk));
  }
  const bgData = `data:image/png;base64,${btoa(b64)}`;

  const titleLines = wrap(spec.title_text || "", 14).slice(0, 4);
  const subLines = wrap(spec.subtitle_text || "", 38).slice(0, 3);
  const titleSize = titleLines.length >= 3 ? 130 : titleLines.length === 2 ? 160 : 180;
  const subSize = 52;
  const brandSize = 38;
  const badgeSize = 36;

  const titleLineH = titleSize * 1.05;
  const subLineH = subSize * 1.25;

  // Compute block heights
  const blockH = titleLines.length * titleLineH + (subLines.length ? 40 + subLines.length * subLineH : 0) + 80;
  // panel position
  let panelY: number, panelH: number, textTopY: number;
  if (layout === "top") {
    panelY = 0; panelH = Math.max(blockH + 160, 700);
    textTopY = 220;
  } else if (layout === "center") {
    panelH = Math.max(blockH + 160, 800);
    panelY = (H - panelH) / 2;
    textTopY = panelY + 140;
  } else {
    panelH = Math.max(blockH + 200, 900);
    panelY = H - panelH;
    textTopY = panelY + 160;
  }

  const titleX = 120;
  let y = textTopY;
  const titleTSpans = titleLines.map((ln, i) => {
    const ty = y + (i + 1) * titleLineH - 30;
    return `<text x="${titleX}" y="${ty}" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="900" font-size="${titleSize}" fill="${titleColor}" letter-spacing="-3">${esc(ln.toUpperCase())}</text>`;
  }).join("");
  y += titleLines.length * titleLineH + 30;

  const subTSpans = subLines.map((ln, i) => {
    const ty = y + (i + 1) * subLineH;
    return `<text x="${titleX}" y="${ty}" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="500" font-size="${subSize}" fill="${titleColor}" opacity="0.92">${esc(ln)}</text>`;
  }).join("");

  // Badge (top)
  const badge = spec.badge_text
    ? `<g>
        <rect x="120" y="120" width="${Math.min(120 + spec.badge_text.length * 22, 900)}" height="80" rx="40" fill="${accent}" />
        <text x="160" y="175" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="700" font-size="${badgeSize}" fill="#0b0b0b">${esc(spec.badge_text.toUpperCase())}</text>
       </g>`
    : "";

  const brand = `<text x="120" y="${H - 100}" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="700" font-size="${brandSize}" fill="${titleColor}" opacity="0.85" letter-spacing="4">${esc((spec.brand_text || "SECRET PDF").toUpperCase())}</text>`;

  const accentBar = `<rect x="120" y="${textTopY - 60}" width="120" height="10" fill="${accent}" />`;

  // overlay gradient for legibility
  const gradStops = layout === "top"
    ? `<stop offset="0" stop-color="${overlay}" stop-opacity="0.85"/><stop offset="1" stop-color="${overlay}" stop-opacity="0"/>`
    : layout === "center"
    ? `<stop offset="0" stop-color="${overlay}" stop-opacity="0"/><stop offset="0.5" stop-color="${overlay}" stop-opacity="0.7"/><stop offset="1" stop-color="${overlay}" stop-opacity="0"/>`
    : `<stop offset="0" stop-color="${overlay}" stop-opacity="0"/><stop offset="1" stop-color="${overlay}" stop-opacity="0.92"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="${panelY}" x2="0" y2="${panelY + panelH}" gradientUnits="userSpaceOnUse">${gradStops}</linearGradient>
  </defs>
  <image href="${bgData}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" />
  <rect x="0" y="${panelY}" width="${W}" height="${panelH}" fill="url(#g)" />
  ${badge}
  ${accentBar}
  ${titleTSpans}
  ${subTSpans}
  ${brand}
  <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="${accent}" stroke-width="6" opacity="0.5"/>
</svg>`;
}

export async function rasterizeSVG(svg: string, width = 1600): Promise<Uint8Array> {
  await ensureWasm();
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  return resvg.render().asPng();
}
