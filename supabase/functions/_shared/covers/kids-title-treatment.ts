// Kids picture-book illustrated title treatment.
//
// Deterministic SVG title-art layer composited over the textless AI cover
// master. Produces a "designed storybook logo" feel — hand-lettered rounded
// letters with layered stroke/shadow/highlight/texture, per-letter jitter,
// and themed decorations pulled from a lightweight keyword classifier.
//
// Guarantees:
// - Exact title/subtitle text (comes from ebook.title, never AI).
// - Metadata returned so QC can prove spelling.
// - Never a plain typed font: even the "safe" font is wrapped in per-letter
//   rotation, dual strokes, drop shadow, highlight and texture.
//
// Non-goals:
// - True custom vector letterforms per book (out of scope for one pass).
// - OCR verification (spelling is verified from source text against metadata).

import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import { KIDS_BRAND_ASSETS, KIDS_BRAND_FOOTER_DIMS } from "../kids-branding-policy.ts";

// ---------- WASM + font loading (shared with kids-cover-render) ----------
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

const KIDS_FONT_URLS: Record<string, string> = {
  fredokaHeavy: "https://cdn.jsdelivr.net/npm/@fontsource/fredoka@5.0.15/files/fredoka-latin-700-normal.woff2",
  fredokaBold: "https://cdn.jsdelivr.net/npm/@fontsource/fredoka@5.0.15/files/fredoka-latin-600-normal.woff2",
  balooExtra: "https://cdn.jsdelivr.net/npm/@fontsource/baloo-2@5.0.20/files/baloo-2-latin-800-normal.woff2",
  balooBold: "https://cdn.jsdelivr.net/npm/@fontsource/baloo-2@5.0.20/files/baloo-2-latin-700-normal.woff2",
};
let fontsCache: Uint8Array[] | null = null;
async function loadFonts(): Promise<Uint8Array[]> {
  if (fontsCache) return fontsCache;
  const bufs: Uint8Array[] = [];
  for (const [name, url] of Object.entries(KIDS_FONT_URLS)) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(String(r.status));
      bufs.push(new Uint8Array(await r.arrayBuffer()));
    } catch (e) {
      console.warn(`kids-title-treatment font ${name} failed: ${(e as Error).message}`);
    }
  }
  fontsCache = bufs;
  return bufs;
}

// ---------- Theme classification ----------

export type TitleTheme =
  | "invention" // gears, screws, dotted motion lines
  | "laundry"   // sock stripes, buttons, sneeze puffs, laundry pins
  | "food"      // crumbs, cheese corners, tomato dots
  | "forest"    // leaves, berries, mushrooms, vines
  | "bedtime"   // moons, stars, sparkles, clouds
  | "adventure" // motion dashes, sparks, arrows
  | "animal"    // leaves + paws + hearts
  | "generic";  // sparkles, dots, small stars

export interface ThemeTraits {
  theme: TitleTheme;
  mood: "playful" | "cozy" | "bold" | "organic";
  jitter: number;      // per-letter rotation range degrees
  yBounce: number;     // per-letter vertical bounce px
  tilt: number;        // whole-line tilt degrees
  extraStroke: boolean;
}

const KEYWORDS: Array<{ theme: TitleTheme; words: RegExp }> = [
  { theme: "invention", words: /\b(invent|gizmo|gadget|machine|robot|sorter|sneeze|button|contraption|science|stem|lab|engineer)\b/i },
  { theme: "laundry",   words: /\b(sock|socks|laundry|clothes|basket|wash|dryer)\b/i },
  { theme: "food",      words: /\b(cook|kitchen|pizza|sandwich|cheese|tomato|pickle|snack|bakery|cake|cookie|soup)\b/i },
  { theme: "forest",    words: /\b(forest|woods|leaf|leaves|berry|berries|mushroom|vine|meadow|tree|garden|barnaby|wobbly)\b/i },
  { theme: "bedtime",   words: /\b(moon|star|night|sleep|dream|bedtime|pillow|blanket|cozy|hush|lullab)\b/i },
  { theme: "adventure", words: /\b(adventure|quest|journey|voyage|explore|pirate|dragon|treasure|wild|racing)\b/i },
  { theme: "animal",    words: /\b(bear|fox|cat|dog|bunny|rabbit|owl|mouse|puppy|kitten|cub|otter|frog|duck)\b/i },
];

export function classifyTitleTheme(input: {
  title: string;
  subtitle?: string | null;
  description?: string | null;
}): ThemeTraits {
  const hay = [input.title, input.subtitle ?? "", input.description ?? ""].join(" ").toLowerCase();
  let theme: TitleTheme = "generic";
  for (const k of KEYWORDS) if (k.words.test(hay)) { theme = k.theme; break; }
  switch (theme) {
    case "invention": return { theme, mood: "playful", jitter: 4.5, yBounce: 10, tilt: -1.5, extraStroke: true };
    case "laundry":   return { theme, mood: "playful", jitter: 5, yBounce: 12, tilt: 0, extraStroke: true };
    case "food":      return { theme, mood: "playful", jitter: 4, yBounce: 8, tilt: 0, extraStroke: true };
    case "forest":    return { theme, mood: "organic", jitter: 3.5, yBounce: 6, tilt: -1, extraStroke: false };
    case "bedtime":   return { theme, mood: "cozy", jitter: 2.5, yBounce: 4, tilt: 0, extraStroke: false };
    case "adventure": return { theme, mood: "bold", jitter: 6, yBounce: 12, tilt: -3, extraStroke: true };
    case "animal":    return { theme, mood: "organic", jitter: 4, yBounce: 8, tilt: -1, extraStroke: false };
    default:          return { theme: "generic", mood: "playful", jitter: 3, yBounce: 6, tilt: 0, extraStroke: false };
  }
}

// ---------- Layout helpers ----------

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

let coverLogoB64Cache: string | null = null;
async function loadCoverLogoB64(): Promise<string | null> {
  if (coverLogoB64Cache) return coverLogoB64Cache;
  try {
    const url = `https://profit-pulse-pdfs.lovable.app${KIDS_BRAND_ASSETS.footer}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`logo_fetch_${r.status}`);
    coverLogoB64Cache = toB64(new Uint8Array(await r.arrayBuffer()));
    return coverLogoB64Cache;
  } catch (e) {
    console.warn(`kids-title-treatment cover logo failed: ${(e as Error).message}`);
    return null;
  }
}

/** Split title into ≤ maxLines balanced lines, favouring visual balance. */
export function splitTitleLines(title: string, maxLines = 3): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words.length ? [words[0]] : [""];
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

function pickTitleColors(palette: string[]): {
  fill: string; stroke: string; outerStroke: string; highlight: string; accent: string;
} {
  const cream = palette.find((c) => /^#(fff|ffe|fdf|fce|fbe|f6e|f0e|efe|f5e|f4e|fef)/i.test(c)) ?? "#FFF6E5";
  const dark = palette.find((c) => /^#(0|1|2)/i.test(c)) ?? "#2A1A0A";
  const warm = palette.find((c) => /^#(e|d|c)[89ab]/i.test(c)) ?? palette[2] ?? "#E9B44C";
  return {
    fill: cream,
    stroke: dark,
    outerStroke: "#FFFFFF",
    highlight: "#FFFFFF",
    accent: warm,
  };
}

// ---------- Decoration vectors (per theme) ----------
// Each returns an SVG snippet drawn at (x, y) with `size` in px.

function decoLeaf(x: number, y: number, size: number, fill: string, stroke: string): string {
  const s = size;
  return `<g transform="translate(${x},${y}) rotate(${(x * 13) % 40 - 20})">
    <path d="M0 0 C ${s * 0.6} -${s * 0.5}, ${s * 1.2} -${s * 0.3}, ${s * 1.4} ${s * 0.2}
             C ${s * 1.1} ${s * 0.5}, ${s * 0.5} ${s * 0.6}, 0 0 Z"
          fill="${fill}" stroke="${stroke}" stroke-width="${s * 0.08}" stroke-linejoin="round"/>
    <path d="M0 0 L ${s * 1.2} ${s * 0.05}" stroke="${stroke}" stroke-width="${s * 0.06}" fill="none"/>
  </g>`;
}

function decoBerry(x: number, y: number, size: number, fill: string, stroke: string): string {
  const r = size * 0.45;
  return `<g transform="translate(${x},${y})">
    <circle cx="0" cy="0" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${r * 0.18}"/>
    <circle cx="${-r * 0.35}" cy="${-r * 0.35}" r="${r * 0.22}" fill="#FFFFFF" opacity="0.65"/>
  </g>`;
}

function decoStar(x: number, y: number, size: number, fill: string, stroke: string): string {
  const s = size * 0.6;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? s : s * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`);
  }
  return `<g transform="translate(${x},${y})">
    <polygon points="${pts.join(" ")}" fill="${fill}" stroke="${stroke}"
             stroke-width="${s * 0.14}" stroke-linejoin="round"/>
  </g>`;
}

function decoSock(x: number, y: number, size: number, fill: string, stroke: string): string {
  const s = size;
  return `<g transform="translate(${x},${y}) rotate(${(x * 17) % 30 - 15})">
    <path d="M0 0 L ${s * 0.55} 0 L ${s * 0.55} ${s * 0.75} L ${s * 0.95} ${s * 0.9}
             L ${s * 0.95} ${s * 1.2} L ${s * 0.05} ${s * 1.2} L 0 ${s * 0.9} Z"
          fill="${fill}" stroke="${stroke}" stroke-width="${s * 0.09}" stroke-linejoin="round"/>
    <path d="M0 ${s * 0.4} L ${s * 0.55} ${s * 0.4} M0 ${s * 0.55} L ${s * 0.55} ${s * 0.55}"
          stroke="${stroke}" stroke-width="${s * 0.07}" fill="none"/>
  </g>`;
}

function decoGear(x: number, y: number, size: number, fill: string, stroke: string): string {
  const s = size * 0.55;
  const teeth: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    const x1 = Math.cos(a) * s;
    const y1 = Math.sin(a) * s;
    const x2 = Math.cos(a) * (s * 1.35);
    const y2 = Math.sin(a) * (s * 1.35);
    teeth.push(`<rect x="${x2 - s * 0.18}" y="${y2 - s * 0.18}" width="${s * 0.36}" height="${s * 0.36}"
                       transform="rotate(${(a * 180) / Math.PI} ${x2} ${y2})"
                       fill="${fill}" stroke="${stroke}" stroke-width="${s * 0.12}"/>`);
    teeth.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${s * 0.14}"/>`);
  }
  return `<g transform="translate(${x},${y}) rotate(${(x * 7) % 30})">
    ${teeth.join("")}
    <circle cx="0" cy="0" r="${s}" fill="${fill}" stroke="${stroke}" stroke-width="${s * 0.18}"/>
    <circle cx="0" cy="0" r="${s * 0.35}" fill="${stroke}"/>
  </g>`;
}

function decoSparkle(x: number, y: number, size: number, fill: string): string {
  const s = size * 0.5;
  return `<g transform="translate(${x},${y}) rotate(${(x * 11) % 45})">
    <path d="M0 -${s} L ${s * 0.28} -${s * 0.28} L ${s} 0 L ${s * 0.28} ${s * 0.28}
             L 0 ${s} L -${s * 0.28} ${s * 0.28} L -${s} 0 L -${s * 0.28} -${s * 0.28} Z"
          fill="${fill}"/>
  </g>`;
}

function decoDot(x: number, y: number, size: number, fill: string): string {
  return `<circle cx="${x}" cy="${y}" r="${size * 0.28}" fill="${fill}"/>`;
}

function decorateTheme(
  theme: TitleTheme,
  bounds: { x: number; y: number; w: number; h: number },
  colors: { fill: string; stroke: string; accent: string; highlight: string },
): string {
  // Deterministic scatter: pick positions using bounds + fixed offsets.
  const anchors: Array<{ x: number; y: number; s: number }> = [
    { x: bounds.x - 30, y: bounds.y + 20, s: 60 },
    { x: bounds.x + bounds.w + 20, y: bounds.y + 30, s: 66 },
    { x: bounds.x + 40, y: bounds.y - 40, s: 50 },
    { x: bounds.x + bounds.w - 90, y: bounds.y - 30, s: 54 },
    { x: bounds.x + bounds.w * 0.5, y: bounds.y + bounds.h + 24, s: 48 },
    { x: bounds.x - 60, y: bounds.y + bounds.h - 40, s: 46 },
    { x: bounds.x + bounds.w + 40, y: bounds.y + bounds.h - 30, s: 52 },
  ];
  const parts: string[] = [];
  const add = (fn: (x: number, y: number, s: number) => string, i: number) => {
    const a = anchors[i % anchors.length];
    parts.push(fn(a.x, a.y, a.s));
  };
  switch (theme) {
    case "invention":
      add((x, y, s) => decoGear(x, y, s, colors.accent, colors.stroke), 0);
      add((x, y, s) => decoGear(x, y, s * 0.75, colors.fill, colors.stroke), 1);
      add((x, y, s) => decoDot(x, y, s, colors.stroke), 2);
      add((x, y, s) => decoSparkle(x, y, s, colors.accent), 3);
      add((x, y, s) => decoDot(x + 20, y, s * 0.6, colors.stroke), 4);
      add((x, y, s) => decoGear(x, y, s * 0.6, colors.accent, colors.stroke), 5);
      break;
    case "laundry":
      add((x, y, s) => decoSock(x, y, s, colors.accent, colors.stroke), 0);
      add((x, y, s) => decoSock(x, y, s * 0.9, colors.fill, colors.stroke), 1);
      add((x, y, s) => decoSparkle(x, y, s * 0.8, colors.highlight), 2);
      add((x, y, s) => decoDot(x, y, s * 0.7, colors.stroke), 3);
      add((x, y, s) => decoSock(x, y, s * 0.7, colors.accent, colors.stroke), 4);
      add((x, y, s) => decoSparkle(x, y, s * 0.7, colors.highlight), 5);
      break;
    case "food":
      add((x, y, s) => decoBerry(x, y, s, colors.accent, colors.stroke), 0);
      add((x, y, s) => decoBerry(x, y, s * 0.8, colors.accent, colors.stroke), 1);
      add((x, y, s) => decoDot(x, y, s, colors.stroke), 2);
      add((x, y, s) => decoDot(x + 20, y, s * 0.7, colors.accent), 3);
      add((x, y, s) => decoSparkle(x, y, s * 0.7, colors.highlight), 4);
      break;
    case "forest":
      add((x, y, s) => decoLeaf(x, y, s, colors.accent, colors.stroke), 0);
      add((x, y, s) => decoLeaf(x, y, s * 0.9, colors.fill, colors.stroke), 1);
      add((x, y, s) => decoBerry(x, y, s * 0.7, colors.accent, colors.stroke), 2);
      add((x, y, s) => decoLeaf(x, y, s * 0.8, colors.accent, colors.stroke), 3);
      add((x, y, s) => decoBerry(x, y, s * 0.6, colors.accent, colors.stroke), 4);
      add((x, y, s) => decoLeaf(x, y, s * 0.7, colors.fill, colors.stroke), 5);
      break;
    case "bedtime":
      add((x, y, s) => decoStar(x, y, s, colors.accent, colors.stroke), 0);
      add((x, y, s) => decoSparkle(x, y, s, colors.highlight), 1);
      add((x, y, s) => decoStar(x, y, s * 0.7, colors.fill, colors.stroke), 2);
      add((x, y, s) => decoSparkle(x, y, s * 0.9, colors.highlight), 3);
      add((x, y, s) => decoDot(x, y, s * 0.6, colors.highlight), 4);
      break;
    case "adventure":
      add((x, y, s) => decoSparkle(x, y, s, colors.accent), 0);
      add((x, y, s) => decoStar(x, y, s * 0.7, colors.accent, colors.stroke), 1);
      add((x, y, s) => decoDot(x, y, s * 0.6, colors.stroke), 2);
      add((x, y, s) => decoSparkle(x, y, s * 0.9, colors.highlight), 3);
      break;
    case "animal":
      add((x, y, s) => decoLeaf(x, y, s * 0.9, colors.accent, colors.stroke), 0);
      add((x, y, s) => decoBerry(x, y, s * 0.7, colors.accent, colors.stroke), 1);
      add((x, y, s) => decoSparkle(x, y, s * 0.7, colors.highlight), 2);
      add((x, y, s) => decoLeaf(x, y, s * 0.8, colors.fill, colors.stroke), 3);
      break;
    default:
      add((x, y, s) => decoSparkle(x, y, s, colors.accent), 0);
      add((x, y, s) => decoStar(x, y, s * 0.7, colors.accent, colors.stroke), 1);
      add((x, y, s) => decoDot(x, y, s * 0.6, colors.stroke), 2);
      add((x, y, s) => decoSparkle(x, y, s * 0.8, colors.highlight), 3);
  }
  return parts.join("\n");
}

// ---------- Per-letter title art ----------

// Deterministic pseudo-random from a string seed, so identical titles render
// identically every run (needed for repair-only-title verification).
function seedFrom(s: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

function renderLineLetters(input: {
  line: string;
  cx: number;      // center x
  y: number;       // baseline y
  fontSize: number;
  fontFamily: string;
  colors: { fill: string; stroke: string; outerStroke: string; highlight: string };
  traits: ThemeTraits;
  rand: () => number;
  extraStroke: boolean;
}): string {
  const { line, cx, y, fontSize, fontFamily, colors, traits, rand, extraStroke } = input;
  // Approximate glyph width for Fredoka-like round display face.
  const glyphWidth = fontSize * 0.62;
  const spaceWidth = fontSize * 0.32;
  const chars = [...line];
  let totalWidth = 0;
  for (const ch of chars) totalWidth += ch === " " ? spaceWidth : glyphWidth;
  const startX = cx - totalWidth / 2;

  const strokeW = Math.max(6, Math.round(fontSize * 0.09));
  const outerStrokeW = strokeW + Math.max(4, Math.round(fontSize * 0.05));

  let x = startX;
  const layerShadow: string[] = [];
  const layerOuter: string[] = [];
  const layerStroke: string[] = [];
  const layerFill: string[] = [];
  const layerHighlight: string[] = [];

  for (const ch of chars) {
    const w = ch === " " ? spaceWidth : glyphWidth;
    if (ch !== " ") {
      const jitter = (rand() - 0.5) * 2 * traits.jitter;
      const bounce = (rand() - 0.5) * 2 * traits.yBounce;
      const gx = x + w / 2;
      const gy = y + bounce;
      const transform = `rotate(${jitter.toFixed(2)} ${gx.toFixed(1)} ${gy.toFixed(1)})`;
      const common = `x="${gx.toFixed(1)}" y="${gy.toFixed(1)}" text-anchor="middle" font-family="${fontFamily}" font-weight="700" font-size="${fontSize}" transform="${transform}"`;
      // Order back-to-front: shadow → outer white → dark stroke → cream fill → highlight.
      layerShadow.push(`<text ${common} fill="#1a0e04" opacity="0.55" style="filter:url(#kt-shadow)">${esc(ch)}</text>`);
      if (extraStroke) {
        layerOuter.push(`<text ${common} fill="none" stroke="${colors.outerStroke}" stroke-width="${outerStrokeW}" paint-order="stroke" stroke-linejoin="round">${esc(ch)}</text>`);
      }
      layerStroke.push(`<text ${common} fill="none" stroke="${colors.stroke}" stroke-width="${strokeW}" paint-order="stroke" stroke-linejoin="round">${esc(ch)}</text>`);
      layerFill.push(`<text ${common} fill="${colors.fill}">${esc(ch)}</text>`);
      // Highlight stroke on top edge only (approx via slight y offset white text with mask alpha).
      layerHighlight.push(`<text ${common} fill="none" stroke="${colors.highlight}" stroke-width="${Math.max(1.5, fontSize * 0.014)}" opacity="0.65" dy="-${fontSize * 0.18}">${esc(ch)}</text>`);
    }
    x += w;
  }
  return [
    layerShadow.join("\n"),
    layerOuter.join("\n"),
    layerStroke.join("\n"),
    layerFill.join("\n"),
    layerHighlight.join("\n"),
  ].join("\n");
}

// ---------- Public API ----------

export interface TitleTreatmentInput {
  coverBg: Uint8Array;       // textless AI cover PNG bytes
  title: string;
  subtitle?: string | null;
  description?: string | null;
  palette?: string[];
  ageBadge?: string | null;
  width?: number;            // final png width, default 1600
  height?: number;           // final png height, default 1600
}

export interface TitleTreatmentMetadata {
  title: string;
  subtitle: string | null;
  lines: string[];
  theme: TitleTheme;
  mood: string;
  font_family: string;
  font_size: number;
  palette_used: string[];
  jitter_degrees: number;
  y_bounce_px: number;
  decorations_count: number;
  age_badge: string | null;
  logo_present: boolean;
  overlay_frame: {
    width: number;
    height: number;
    safe_margin: number;
    elements: Array<{ name: string; x: number; y: number; w: number; h: number }>;
  };
  renderer: "kids-title-treatment@1";
  rendered_at: string;
}

export interface TitleTreatmentResult {
  png: Uint8Array;
  svg: string;
  metadata: TitleTreatmentMetadata;
}

/**
 * Compose the illustrated title layer over the textless cover master. Returns
 * the composed PNG bytes plus deterministic metadata proving what text was
 * rendered (used by QC to verify spelling matches ebook.title).
 */
export async function renderKidsTitleTreatment(input: TitleTreatmentInput): Promise<TitleTreatmentResult> {
  const W = input.width ?? 1600;
  const H = input.height ?? 1600;
  const palette = (input.palette && input.palette.length ? input.palette : ["#FFF6E5", "#2A1A0A", "#E9B44C", "#6BAA75"]);
  const colors = pickTitleColors(palette);
  const traits = classifyTitleTheme({
    title: input.title,
    subtitle: input.subtitle ?? null,
    description: input.description ?? null,
  });
  const rand = seedFrom(input.title);

  const lines = splitTitleLines(input.title, 3);
  const longest = Math.max(...lines.map((l) => l.length));
  const titleY0 = Math.round(H * 0.16);
  const lineGap = Math.round(H * 0.10);
  // Fit longest line into ~68% of canvas width.
  const targetPx = W * 0.68;
  const approxChar = 0.62;
  let fontSize = Math.floor(targetPx / Math.max(6, longest * approxChar));
  fontSize = Math.max(80, Math.min(fontSize, 200));

  const trimmedSubtitle = (input.subtitle ?? "").trim();
  const showSubtitle = trimmedSubtitle.length > 0 && trimmedSubtitle.length <= 40;

  const titleFontFamily = "Fredoka";
  const subFontFamily = "Baloo 2";

  // Render each line's layered letter art.
  const linesSvg = lines
    .map((line, i) => renderLineLetters({
      line,
      cx: W / 2,
      y: titleY0 + i * lineGap,
      fontSize,
      fontFamily: titleFontFamily,
      colors,
      traits,
      rand,
      extraStroke: traits.extraStroke,
    }))
    .join("\n");

  // Title bounds for decoration placement.
  const titleBounds = {
    x: Math.round(W * 0.16),
    y: titleY0 - fontSize,
    w: Math.round(W * 0.68),
    h: (lines.length - 1) * lineGap + fontSize * 1.2,
  };
  const decorations = decorateTheme(traits.theme, titleBounds, colors);

  const subtitleY = titleY0 + (lines.length - 1) * lineGap + fontSize * 0.75 + 42;
  const subtitleEl = showSubtitle
    ? `<g transform="rotate(${traits.tilt} ${W / 2} ${subtitleY})">
        <text x="${W / 2}" y="${subtitleY}" text-anchor="middle"
              font-family="${subFontFamily}" font-weight="800" font-size="48"
              fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="3" paint-order="stroke"
              letter-spacing="2">${esc(trimmedSubtitle)}</text>
      </g>`
    : "";

  const ageBadge = (input.ageBadge ?? "").trim();
  // Safe-zone placement — scale pill to canvas so it never clips off-canvas.
  // (Owner defect: 280×90 pill anchored at translate(W-340, H-150) clipped
  // off the composited portrait 4:3 canvas.)
  const safe = Math.max(48, Math.round(W * 0.04));
  const pillW = Math.min(Math.max(180, Math.round(W * 0.19)), W - 2 * safe);
  const pillH = Math.max(60, Math.round(pillW * 0.32));
  const pillX = Math.max(safe, W - safe - pillW);
  const pillY = Math.max(safe, H - safe - pillH);
  const pillTextY = Math.round(pillH * 0.68);
  const pillFont = Math.max(24, Math.round(pillH * 0.46));
  const ageBadgeEl = ageBadge
    ? `<g transform="translate(${pillX}, ${pillY})">
        <rect x="0" y="0" width="${pillW}" height="${pillH}" rx="${Math.round(pillH / 2)}" ry="${Math.round(pillH / 2)}"
              fill="${colors.accent}" opacity="0.96"
              stroke="${colors.stroke}" stroke-width="5"/>
        <text x="${pillW / 2}" y="${pillTextY}" text-anchor="middle" font-family="${subFontFamily}"
              font-weight="800" font-size="${pillFont}" fill="${colors.stroke}" letter-spacing="3">
          ${esc(ageBadge)}
        </text>
      </g>`
    : "";

  // SecretPDF Kids logo on cover: deterministic uploaded asset, never AI.
  // 12% width, inside safe margin, bottom-left away from the title/badge.
  const logoB64 = await loadCoverLogoB64();
  const logoW = Math.round(W * 0.12);
  const logoH = Math.round(logoW * (KIDS_BRAND_FOOTER_DIMS.h / KIDS_BRAND_FOOTER_DIMS.w));
  const logoX = safe;
  const logoY = H - safe - logoH;
  const logoEl = logoB64
    ? `<g transform="translate(${logoX}, ${logoY})">
        <rect x="-14" y="-10" width="${logoW + 28}" height="${logoH + 20}" rx="18" ry="18" fill="#FFFFFF" opacity="0.74"/>
        <image href="data:image/png;base64,${logoB64}" x="0" y="0" width="${logoW}" height="${logoH}" preserveAspectRatio="xMidYMid meet" opacity="0.96"/>
      </g>`
    : "";

  const overlayElements = [
    { name: "title_cluster", x: titleBounds.x - 40, y: titleBounds.y - 20, w: titleBounds.w + 80, h: titleBounds.h + 40 },
    ...(showSubtitle ? [{ name: "subtitle", x: Math.round(W * 0.16), y: Math.round(subtitleY - 58), w: Math.round(W * 0.68), h: 72 }] : []),
    ...(ageBadge ? [{ name: "age_badge", x: pillX, y: pillY, w: pillW, h: pillH }] : []),
    ...(logoB64 ? [{ name: "secretpdf_kids_logo", x: logoX, y: logoY, w: logoW, h: logoH }] : []),
  ];

  const bgB64 = toB64(input.coverBg);

  // Whole title cluster tilt.
  const tiltGroup = `<g transform="rotate(${traits.tilt} ${W / 2} ${titleY0})">${linesSvg}</g>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="kt-scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="#000000" stop-opacity="0.55"/>
      <stop offset="55%" stop-color="#000000" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <filter id="kt-shadow" x="-20%" y="-20%" width="140%" height="160%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="6"/>
      <feOffset dx="0" dy="10"/>
    </filter>
    <filter id="kt-texture" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/>
      <feColorMatrix values="0 0 0 0 0.06
                             0 0 0 0 0.04
                             0 0 0 0 0.02
                             0 0 0 0.12 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
  </defs>

  <!-- Full-bleed textless illustration -->
  <image href="data:image/png;base64,${bgB64}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>

  <!-- Soft scrim behind top-third title zone -->
  <rect x="0" y="0" width="${W}" height="${Math.floor(H * 0.5)}" fill="url(#kt-scrim)"/>

  <!-- Decorations behind title -->
  ${decorations}

  <!-- Illustrated title cluster -->
  ${tiltGroup}

  <!-- Subtle paper/paint texture over the title zone -->
  <rect x="${titleBounds.x - 40}" y="${titleBounds.y - 20}"
        width="${titleBounds.w + 80}" height="${titleBounds.h + 40}"
        fill="#000000" opacity="0.05" filter="url(#kt-texture)" pointer-events="none"/>

  ${subtitleEl}
  ${ageBadgeEl}
  ${logoEl}
</svg>`;

  await ensureWasm();
  const fontBuffers = await loadFonts();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
    font: { loadSystemFonts: false, fontBuffers, defaultFontFamily: "Fredoka" },
  });
  const png = new Uint8Array(resvg.render().asPng());

  // Count decoration nodes emitted (rough).
  const decoCount = (decorations.match(/<(g|circle|polygon|path|rect|line)\s/g) ?? []).length;

  const metadata: TitleTreatmentMetadata = {
    title: input.title,
    subtitle: showSubtitle ? trimmedSubtitle : null,
    lines,
    theme: traits.theme,
    mood: traits.mood,
    font_family: titleFontFamily,
    font_size: fontSize,
    palette_used: palette.slice(0, 6),
    jitter_degrees: traits.jitter,
    y_bounce_px: traits.yBounce,
    decorations_count: decoCount,
    age_badge: ageBadge || null,
    logo_present: !!logoB64,
    overlay_frame: {
      width: W,
      height: H,
      safe_margin: safe,
      elements: overlayElements,
    },
    renderer: "kids-title-treatment@1",
    rendered_at: new Date().toISOString(),
  };

  return { png, svg, metadata };
}

/**
 * Compare stored title-treatment metadata to the canonical ebook.title.
 * Normalization: lowercase, unify curly quotes/apostrophes, strip all
 * non-alphanumeric characters, collapse whitespace. This makes the gate
 * robust to punctuation variants ('s vs ’s), hyphens, line breaks, and
 * casing while still catching real misspellings / missing words.
 * Accepts any renderer that persists a `title` — the composite renderer
 * ("kids-title-treatment@1") AND the baked-lettering repair path
 * ("baked-lettering@1") both qualify.
 */
export function verifyTitleSpelling(
  expectedTitle: string,
  metadata: TitleTreatmentMetadata | null | undefined,
): { pass: boolean; reason: string; expected: string; rendered: string | null } {
  const rendered = metadata?.title ?? null;
  if (!metadata) {
    return { pass: false, reason: "no title_treatment metadata", expected: expectedTitle, rendered: null };
  }
  const norm = (s: string) =>
    s
      .replace(/[\u2018\u2019\u02BC\u2032]/g, "'")
      .replace(/[\u201C\u201D\u2033]/g, '"')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  const exp = norm(expectedTitle);
  const got = norm(rendered ?? "");
  if (got !== exp) {
    return {
      pass: false,
      reason: `rendered title "${rendered}" does not match ebook.title "${expectedTitle}" (normalized: "${got}" vs "${exp}")`,
      expected: expectedTitle,
      rendered,
    };
  }
  // Line reassembly is best-effort: only fail if lines exist AND their normalized
  // join doesn't match the title. An empty/missing lines[] is OK.
  const lines = metadata.lines ?? [];
  if (lines.length > 0) {
    const joined = norm(lines.join(""));
    if (joined && joined !== exp) {
      return {
        pass: false,
        reason: `line reassembly "${lines.join(" ")}" does not match ebook.title "${expectedTitle}"`,
        expected: expectedTitle,
        rendered,
      };
    }
  }
  return { pass: true, reason: "exact match (normalized)", expected: expectedTitle, rendered };
}

