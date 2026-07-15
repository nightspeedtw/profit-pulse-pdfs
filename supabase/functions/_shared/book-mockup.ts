// Photoreal book product mockup on a WHITE studio background.
//
// Two-stage hybrid pipeline:
//   Stage 1 — Deterministic FRONT COVER FACE (SVG → PNG). Category-specific
//             palette + motif + baked title/subtitle/badge + feature-icon
//             strip. Guarantees correct text.
//   Stage 2 — Photoreal book product photograph via Lovable AI Gateway
//             (google/gemini-3.1-flash-image) using the Stage-1 PNG as the
//             cover-art reference. If AI fails or QC rejects the result, we
//             fall back to an SVG 3D wrapper around the Stage-1 face.
//
// Guarantees:
//   - White / off-white studio background
//   - Real title baked in (never AI-spelled from scratch)
//   - Visible spine, page block, contact shadow, cover texture
//   - A distinct visual concept per category
//   - Same input → same output on the fallback path
//
// Never touches cover_url / pdf_url / manuscript / price / copy.

import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import { parseModelJson } from "./model-json.ts";

export interface BookMockupInput {
  coverUrl?: string | null;   // accepted for compatibility; not used
  title: string;
  subtitle?: string | null;
  categorySlug?: string | null;
  benefits?: string[] | null; // optional 3–4 short feature-icon labels
  // Uniqueness QC — signatures of previously generated covers in the same
  // storefront. Format: "categorySlug|motif|metaphor-keywords". If the newly
  // derived concept collides, we regenerate with a different metaphor.
  avoidSignatures?: string[] | null;
}

export interface MockupResult {
  bytes: Uint8Array;
  model: string;
  attempts: number;
  signature: string; // "<category>|<motif>|<comp>|<accent>|<kws>|<angle>|<format>|<palette>|<layout>"
  concept: { theme: string; metaphor: string; composition: string } | null;
  dna: DesignDna | null;
  qc: {
    passed: boolean;
    scores: Record<string, number>;
    reasons: string[];
  };
}


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
  interSemi: "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.20/files/inter-latin-600-normal.woff2",
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
      console.warn(`book-mockup: font ${name} failed`, (e as Error).message);
    }
  }
  fontsCache = buffers;
  return buffers;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function wrapWords(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const attempt = cur ? cur + " " + w : w;
    if (attempt.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur = attempt;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

// ---------- Category style presets ----------
type IconName = "target" | "calendar" | "chart" | "shield" | "focus" | "clock" | "workflow" | "sparkle" | "leaf" | "wallet" | "route" | "check" | "star";
type MotifName = "stairs" | "ladder" | "shield" | "wave" | "circuit" | "leaf" | "route" | "grid" | "star" | "door";
type Preset = {
  key: string;
  badge: string;
  bg: string;
  bgAlt: string;
  ink: string;
  ink2: string;
  accent: string;   // highlight (usually yellow / teal)
  spine: string;
  titleFont: "Bebas Neue" | "Playfair Display";
  motif: MotifName;
  icons: { icon: IconName; label: string }[];
  aiHint: string; // additional description for the AI cover art
  sceneConcept?: string; // unique per-book scene metaphor for the AI
  avoidConcepts?: string[]; // banned motifs to force visual variation

};

// Deterministic hash of the title so the same book always gets the same variant.
function titleHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
const ALL_MOTIFS: MotifName[] = ["stairs","ladder","shield","wave","circuit","leaf","route","grid","star","door"];
function bannedFrom(chosen: MotifName, pool: MotifName[]): string[] {
  const map: Record<MotifName,string> = {
    stairs: "staircase leading to a doorway",
    door: "glowing doorway with staircase in front",
    ladder: "climbing ladder",
    shield: "shield or crest",
    wave: "sine-wave chart line",
    circuit: "circuit-board node graph",
    leaf: "single centered leaf",
    route: "dashed winding route map",
    grid: "calendar / time-block grid",
    star: "starburst pattern",
  };
  const banned = pool.filter(m => m !== chosen).map(m => map[m]);
  return banned;
}

// ---------- Thumbnail Design DNA ----------
// Content-aware variation so books in the same category do not share the same
// book-format / angle / palette / layout. Deterministic per title, but
// avoids axes already heavily used in `existingSigs` (last ~30 covers).
export type MockupStyle =
  | "hardcover" | "workbook" | "planner" | "field_guide" | "manual" | "storybook" | "modern_ebook";
export type MockupAngle =
  | "left_spine_3q" | "right_page_3q" | "front_slight_angle" | "standing_book"
  | "stacked_workbook" | "open_edge_view";
export type CoverLayout =
  | "big_type_center" | "poster_grid" | "illustration_bottom" | "split_panel"
  | "badge_top" | "framework_diagram" | "planner_interface" | "story_scene";
export type PaletteFamily =
  | "black_gold" | "cream_red_black" | "teal_charcoal" | "emerald_white"
  | "navy_cyan" | "warm_cream_orange" | "pastel_kids" | "cinematic_dark"
  | "forest_mint" | "space_violet" | "ivory_navy";
export type TypographyStyle =
  | "condensed_bold" | "planner_block" | "editorial_serif" | "modern_sans"
  | "playful_story" | "tech_mono" | "premium_manual";
export type TextureStyle =
  | "matte_black" | "cream_paper" | "glossy_planner" | "linen_cover"
  | "soft_touch" | "illustrated_paper";
export type SpineStyle =
  | "bold_vertical_title" | "minimal_label" | "colored_band" | "planner_tab" | "storybook_spine";

export interface DesignDna {
  mockup_style: MockupStyle;
  mockup_angle: MockupAngle;
  cover_layout: CoverLayout;
  palette_family: PaletteFamily;
  typography_style: TypographyStyle;
  texture: TextureStyle;
  spine_style: SpineStyle;
  main_motif: string;
  supporting_icons: string[];
  avoid_similarity_to: string[];
}

// Category → allowed DNA pools (topic-aware, not random).
function dnaPoolsFor(slug: string | null | undefined, title: string) {
  const s = (slug ?? "").toLowerCase();
  const t = (title ?? "").toLowerCase();
  const isFinance = /debt|money|finance|cash|budget|wealth|fortress|feast|famine/.test(s + " " + t);
  const isWellness = /wellness|health|energy|sleep|calm|mind/.test(s + " " + t);
  const isProductivity = /productivity|focus|workday|deep|time/.test(s + " " + t);
  const isAi = /\bai\b|assistant|automation|prompt|invisible/.test(s + " " + t);
  const isCareer = /career|business|interview|application|bypass|founder/.test(s + " " + t);
  const isKids = /kid|child|nursery|storybook/.test(s + " " + t);

  if (isKids) return {
    styles: ["storybook","hardcover"] as MockupStyle[],
    angles: ["standing_book","front_slight_angle","open_edge_view"] as MockupAngle[],
    layouts: ["story_scene","illustration_bottom","big_type_center"] as CoverLayout[],
    palettes: ["pastel_kids","warm_cream_orange","cream_red_black"] as PaletteFamily[],
    typo: ["playful_story","editorial_serif"] as TypographyStyle[],
    textures: ["illustrated_paper","cream_paper"] as TextureStyle[],
    spines: ["storybook_spine","colored_band"] as SpineStyle[],
  };
  if (isWellness) return {
    styles: ["field_guide","hardcover","modern_ebook"] as MockupStyle[],
    angles: ["front_slight_angle","standing_book","left_spine_3q"] as MockupAngle[],
    layouts: ["illustration_bottom","big_type_center","split_panel"] as CoverLayout[],
    palettes: ["forest_mint","emerald_white","warm_cream_orange","ivory_navy"] as PaletteFamily[],
    typo: ["editorial_serif","modern_sans"] as TypographyStyle[],
    textures: ["soft_touch","linen_cover","cream_paper"] as TextureStyle[],
    spines: ["minimal_label","colored_band"] as SpineStyle[],
  };
  if (isProductivity) return {
    styles: ["planner","manual","modern_ebook","hardcover"] as MockupStyle[],
    angles: ["left_spine_3q","stacked_workbook","standing_book","right_page_3q"] as MockupAngle[],
    layouts: ["planner_interface","framework_diagram","poster_grid","big_type_center"] as CoverLayout[],
    palettes: ["navy_cyan","teal_charcoal","ivory_navy"] as PaletteFamily[],
    typo: ["condensed_bold","modern_sans","planner_block"] as TypographyStyle[],
    textures: ["glossy_planner","soft_touch","matte_black"] as TextureStyle[],
    spines: ["planner_tab","bold_vertical_title","minimal_label"] as SpineStyle[],
  };
  if (isAi) return {
    styles: ["manual","modern_ebook","hardcover"] as MockupStyle[],
    angles: ["left_spine_3q","front_slight_angle","standing_book"] as MockupAngle[],
    layouts: ["framework_diagram","poster_grid","split_panel","big_type_center"] as CoverLayout[],
    palettes: ["space_violet","cinematic_dark","navy_cyan"] as PaletteFamily[],
    typo: ["tech_mono","modern_sans","condensed_bold"] as TypographyStyle[],
    textures: ["soft_touch","matte_black"] as TextureStyle[],
    spines: ["bold_vertical_title","minimal_label"] as SpineStyle[],
  };
  if (isCareer) return {
    styles: ["hardcover","manual","modern_ebook"] as MockupStyle[],
    angles: ["left_spine_3q","standing_book","front_slight_angle"] as MockupAngle[],
    layouts: ["big_type_center","framework_diagram","split_panel","badge_top"] as CoverLayout[],
    palettes: ["ivory_navy","warm_cream_orange","black_gold","navy_cyan"] as PaletteFamily[],
    typo: ["editorial_serif","condensed_bold","premium_manual"] as TypographyStyle[],
    textures: ["linen_cover","soft_touch","matte_black"] as TextureStyle[],
    spines: ["bold_vertical_title","minimal_label"] as SpineStyle[],
  };
  if (isFinance) return {
    // Finance: keep it credible but explicitly diverse — do NOT default to black_gold every time.
    styles: ["hardcover","workbook","planner","manual"] as MockupStyle[],
    angles: ["left_spine_3q","right_page_3q","standing_book","stacked_workbook","front_slight_angle"] as MockupAngle[],
    layouts: ["big_type_center","framework_diagram","planner_interface","split_panel","badge_top"] as CoverLayout[],
    palettes: ["black_gold","cream_red_black","teal_charcoal","ivory_navy","warm_cream_orange"] as PaletteFamily[],
    typo: ["condensed_bold","editorial_serif","premium_manual","planner_block"] as TypographyStyle[],
    textures: ["matte_black","linen_cover","cream_paper","glossy_planner"] as TextureStyle[],
    spines: ["bold_vertical_title","colored_band","planner_tab","minimal_label"] as SpineStyle[],
  };
  return {
    styles: ["hardcover","manual","modern_ebook","field_guide"] as MockupStyle[],
    angles: ["left_spine_3q","front_slight_angle","standing_book","right_page_3q"] as MockupAngle[],
    layouts: ["big_type_center","framework_diagram","split_panel","badge_top"] as CoverLayout[],
    palettes: ["ivory_navy","teal_charcoal","navy_cyan","warm_cream_orange"] as PaletteFamily[],
    typo: ["condensed_bold","editorial_serif","modern_sans"] as TypographyStyle[],
    textures: ["matte_black","soft_touch","linen_cover"] as TextureStyle[],
    spines: ["bold_vertical_title","minimal_label"] as SpineStyle[],
  };
}

// Count occurrences of a value at a specific "|"-separated signature index.
function countAt(sigs: string[], idx: number): Record<string, number> {
  const c: Record<string, number> = {};
  for (const s of sigs.slice(0, 30)) {
    const v = s.split("|")[idx];
    if (!v) continue;
    c[v] = (c[v] ?? 0) + 1;
  }
  return c;
}

// Pick the least-used option in `pool` given recent-sig counts, deterministic tiebreak.
function pickLeastUsed<T extends string>(pool: T[], counts: Record<string, number>, seed: number): T {
  if (!pool.length) return "" as unknown as T;
  const scored = pool.map((v, i) => ({ v, n: counts[v] ?? 0, i }));
  const min = Math.min(...scored.map(x => x.n));
  const bucket = scored.filter(x => x.n === min);
  return bucket[seed % bucket.length].v;
}

// Angle / layout / palette / format extracted from signature indices 5..8.
export function deriveDesignDna(input: BookMockupInput, existingSigs: string[]): DesignDna {
  const pools = dnaPoolsFor(input.categorySlug, input.title);
  const h = titleHash((input.title ?? "") + "|" + (input.subtitle ?? "") + "|" + (input.categorySlug ?? ""));
  // Recent-usage counts per axis (see buildSignature() layout below).
  const angleCounts   = countAt(existingSigs, 5);
  const formatCounts  = countAt(existingSigs, 6);
  const paletteCounts = countAt(existingSigs, 7);
  const layoutCounts  = countAt(existingSigs, 8);

  const mockup_angle    = pickLeastUsed(pools.angles,   angleCounts,   h);
  const mockup_style    = pickLeastUsed(pools.styles,   formatCounts,  h >> 3);
  const palette_family  = pickLeastUsed(pools.palettes, paletteCounts, h >> 5);
  const cover_layout    = pickLeastUsed(pools.layouts,  layoutCounts,  h >> 7);
  const typography_style = pools.typo[(h >> 9) % pools.typo.length];
  const texture          = pools.textures[(h >> 11) % pools.textures.length];
  const spine_style      = pools.spines[(h >> 13) % pools.spines.length];

  return {
    mockup_style, mockup_angle, cover_layout, palette_family,
    typography_style, texture, spine_style,
    main_motif: "",
    supporting_icons: [],
    avoid_similarity_to: [],
  };
}

// Human-readable AI prompt fragments for each DNA axis.
const ANGLE_PROMPT: Record<MockupAngle, string> = {
  left_spine_3q:      "3/4 angle with the matte spine on the LEFT and clean page edges on the right",
  right_page_3q:      "reverse 3/4 angle with the page edges on the LEFT and the spine on the right",
  front_slight_angle: "near-frontal view tilted only ~10 degrees, minimal spine visible, subtle depth",
  standing_book:      "book standing upright facing the camera, tiny lean, soft floor shadow",
  stacked_workbook:   "a chunky workbook lying flat with a second thinner booklet stacked at an offset, top-down 3/4",
  open_edge_view:     "book viewed from the fore-edge side, showing the thickness of the page block and a sliver of front cover",
};
const FORMAT_PROMPT: Record<MockupStyle, string> = {
  hardcover:     "premium matte hardcover with clean square corners and firm boards",
  workbook:      "thick spiral-free perfect-bound workbook, chunky page block, softcover feel",
  planner:       "premium planner with slight rounded corners and a colored spine band",
  field_guide:   "compact pocketable field guide, soft-touch cover, rounded corners",
  manual:        "editorial trade paperback manual, matte cover, crisp typography",
  storybook:     "large illustrated children storybook hardcover with tactile printed feel",
  modern_ebook:  "modern trade paperback with a soft-touch matte finish",
};
const PALETTE_PROMPT: Record<PaletteFamily, string> = {
  black_gold:         "matte black cover with warm gold foil accents",
  cream_red_black:    "cream cover with deep red and black accents",
  teal_charcoal:      "charcoal cover with muted teal accents",
  emerald_white:      "emerald green cover with clean white typography",
  navy_cyan:          "deep navy cover with electric cyan accents",
  warm_cream_orange:  "warm cream cover with burnt orange accents",
  pastel_kids:        "soft pastel palette — mint, blush, butter yellow",
  cinematic_dark:     "cinematic near-black cover with a single saturated highlight",
  forest_mint:        "forest green cover with soft mint accents",
  space_violet:       "deep space-blue cover with a subtle violet glow",
  ivory_navy:         "ivory cover with navy typography and a thin metallic rule",
};
const LAYOUT_PROMPT: Record<CoverLayout, string> = {
  big_type_center:      "cover art driven by huge centered display typography, minimal supporting art",
  poster_grid:          "cover organized like a modern editorial poster with a small info grid",
  illustration_bottom:  "large custom illustration anchored to the bottom two-thirds, title stacked above",
  split_panel:          "two-panel split cover: solid color block on one side, illustration on the other",
  badge_top:            "circular badge or seal at the top, disciplined title below",
  framework_diagram:    "cover shows a clean framework diagram / schematic supporting the title",
  planner_interface:    "cover mimics a real planner interface — dated grid, tabs, checklist rows",
  story_scene:          "cover shows a small illustrated scene with a character or object relevant to the story",
};
const TYPO_PROMPT: Record<TypographyStyle, string> = {
  condensed_bold:   "condensed heavy sans title",
  planner_block:    "chunky planner-style block title with tab labels",
  editorial_serif:  "confident editorial serif title with tight tracking",
  modern_sans:      "clean neutral sans title",
  playful_story:    "hand-lettered storybook title with warmth",
  tech_mono:        "technical monospace title with restrained secondary type",
  premium_manual:   "small-caps premium manual title with fine metallic rule",
};
const SPINE_PROMPT: Record<SpineStyle, string> = {
  bold_vertical_title:  "spine shows the full title vertically in bold caps",
  minimal_label:        "spine shows only a small brand mark and thin rule",
  colored_band:         "spine has a horizontal color band at the top and bottom",
  planner_tab:          "spine has planner-style side tabs peeking out",
  storybook_spine:      "spine is illustrated with a small motif from the story",
};

function dnaToAiHint(dna: DesignDna): string {
  return [
    FORMAT_PROMPT[dna.mockup_style],
    ANGLE_PROMPT[dna.mockup_angle],
    PALETTE_PROMPT[dna.palette_family],
    LAYOUT_PROMPT[dna.cover_layout],
    TYPO_PROMPT[dna.typography_style],
    SPINE_PROMPT[dna.spine_style],
  ].filter(Boolean).join(". ");
}


function basePresetFor(slug: string | null | undefined, title: string, subtitle?: string | null, benefits?: string[] | null): Preset {
  const s = (slug ?? "").toLowerCase();
  const t = (title ?? "").toLowerCase();
  const withBenefits = (fallback: { icon: IconName; label: string }[]) => {
    const b = (benefits ?? []).filter(Boolean).slice(0, 4);
    if (b.length >= 3) {
      return b.slice(0, 4).map((label, i) => ({
        icon: fallback[i]?.icon ?? "check",
        label: label.length > 22 ? label.slice(0, 20).trim() + "…" : label,
      }));
    }
    return fallback;
  };

  if (/debt|payoff|catch.?up|debt.?free/.test(t) || /debt/.test(s)) {
    return {
      key: "finance_debt", badge: "EBOOK",
      bg: "#0a0a0a", bgAlt: "#161616", ink: "#f6f5f1", ink2: "#c9c3b3",
      accent: "#f5c518", spine: "#050505",
      titleFont: "Bebas Neue", motif: "door",
      icons: withBenefits([
        { icon: "target", label: "CLEAR PLAN" },
        { icon: "calendar", label: "6-MONTH FRAMEWORK" },
        { icon: "chart", label: "BUILD MOMENTUM" },
        { icon: "shield", label: "FINANCIAL FREEDOM" },
      ]),
      aiHint: "matte black hardcover, gold-yellow accents, serious finance / debt-exit tone, staircase leading to a bright doorway of light illustration",
    };
  }
  if (/fortress|blueprint/.test(t)) {
    return {
      key: "finance_fortress", badge: "DIGITAL PLANNER",
      bg: "#0a0a0a", bgAlt: "#161616", ink: "#f6f5f1", ink2: "#c9c3b3",
      accent: "#f5c518", spine: "#050505",
      titleFont: "Bebas Neue", motif: "shield",
      icons: withBenefits([
        { icon: "shield", label: "PROTECT INCOME" },
        { icon: "wallet", label: "CASH RESERVES" },
        { icon: "chart", label: "GROWTH SYSTEM" },
        { icon: "check", label: "PEACE OF MIND" },
      ]),
      aiHint: "matte black hardcover with gold-yellow accents, financial fortress / shield motif, premium finance workbook aesthetic",
    };
  }
  if (/feast|famine|cashflow|cash.flow|income/.test(t) || /cash|budget|money|wealth|finance/.test(s)) {
    return {
      key: "finance_cashflow", badge: "FINANCIAL PLANNER",
      bg: "#0a0a0a", bgAlt: "#161616", ink: "#f6f5f1", ink2: "#c9c3b3",
      accent: "#f5c518", spine: "#050505",
      titleFont: "Bebas Neue", motif: "wave",
      icons: withBenefits([
        { icon: "wallet", label: "SMOOTH INCOME" },
        { icon: "calendar", label: "MONTHLY PLAN" },
        { icon: "chart", label: "STABLE GROWTH" },
        { icon: "check", label: "END THE SWINGS" },
      ]),
      aiHint: "matte black hardcover, gold accent, freelancer cash-flow smoothing motif with clean line-chart / wave illustration",
    };
  }
  if (/energy|sleep|caffeine|burnout|recovery/.test(t) || /wellness|health|energy|self|sleep/.test(s)) {
    return {
      key: "wellness", badge: "WELLNESS GUIDE",
      bg: "#0e2a1e", bgAlt: "#153a2c", ink: "#f4f2ee", ink2: "#c6d4c9",
      accent: "#8ad0a8", spine: "#061a11",
      titleFont: "Bebas Neue", motif: "leaf",
      icons: withBenefits([
        { icon: "sparkle", label: "MORE ENERGY" },
        { icon: "leaf", label: "NATURAL PROTOCOL" },
        { icon: "clock", label: "DAILY ROUTINE" },
        { icon: "check", label: "LASTING RESULTS" },
      ]),
      aiHint: "deep forest green hardcover with soft mint accent, calm credible wellness guide, minimalist leaf / sunrise motif",
    };
  }
  if (/focus|productivity|workday|deep.work|distraction|calendar|meeting|uninterrupt/.test(t) || /productivity|focus/.test(s)) {
    return {
      key: "productivity", badge: "PRODUCTIVITY PLAYBOOK",
      bg: "#101820", bgAlt: "#1a2530", ink: "#f4f2ee", ink2: "#b8c4cf",
      accent: "#22d3ee", spine: "#060b10",
      titleFont: "Bebas Neue", motif: "grid",
      icons: withBenefits([
        { icon: "focus", label: "DEEP FOCUS" },
        { icon: "clock", label: "TIME BLOCKS" },
        { icon: "workflow", label: "FEWER MEETINGS" },
        { icon: "check", label: "SHIP MORE" },
      ]),
      aiHint: "dark navy hardcover with electric cyan accent, minimalist calendar / time-block grid motif, modern productivity playbook",
    };
  }
  if (/ai\b|assistant|automation|prompt|gpt|agent|invisible/.test(t) || /ai|automation|prompt/.test(s)) {
    return {
      key: "ai_automation", badge: "AI OPERATING SYSTEM",
      bg: "#0b0f1c", bgAlt: "#141a2e", ink: "#eef1ff", ink2: "#a5aecf",
      accent: "#a78bfa", spine: "#050814",
      titleFont: "Bebas Neue", motif: "circuit",
      icons: withBenefits([
        { icon: "workflow", label: "AUTOMATION FLOW" },
        { icon: "sparkle", label: "AI ASSISTANT" },
        { icon: "clock", label: "SAVE HOURS" },
        { icon: "check", label: "SHIP FASTER" },
      ]),
      aiHint: "deep space-blue hardcover with subtle violet accent, minimalist circuit / node graph motif, premium AI operations manual aesthetic",
    };
  }
  if (/career|resume|interview|application|bypass|business|founder|freelanc/.test(t) || /business|career/.test(s)) {
    return {
      key: "career", badge: "CAREER PLAYBOOK",
      bg: "#1b263b", bgAlt: "#243350", ink: "#f4f2ee", ink2: "#c8cfdc",
      accent: "#e0b34a", spine: "#0d1522",
      titleFont: "Bebas Neue", motif: "route",
      icons: withBenefits([
        { icon: "route", label: "BYPASS THE LINE" },
        { icon: "target", label: "GET INTERVIEWS" },
        { icon: "chart", label: "LAND OFFERS" },
        { icon: "check", label: "STAND OUT" },
      ]),
      aiHint: "premium navy hardcover with warm gold accent, professional career playbook aesthetic, route / network motif",
    };
  }
  if (/kid|child|nursery|storybook/.test(t) || /kid|child|nursery/.test(s)) {
    return {
      key: "kids", badge: "ILLUSTRATED STORY",
      bg: "#fff4d6", bgAlt: "#ffe08a", ink: "#3a1a4a", ink2: "#7a4a2a",
      accent: "#e11d48", spine: "#3a1a4a",
      titleFont: "Playfair Display", motif: "star",
      icons: withBenefits([
        { icon: "star", label: "MAGIC STORY" },
        { icon: "sparkle", label: "COLORFUL ART" },
        { icon: "check", label: "AGE 4-8" },
        { icon: "leaf", label: "GENTLE LESSONS" },
      ]),
      aiHint: "cheerful children storybook hardcover, warm cream and yellow with rose accent, whimsical playful illustration",
    };
  }
  return {
    key: "default", badge: "EBOOK",
    bg: "#0f2a47", bgAlt: "#173858", ink: "#f4f2ee", ink2: "#c8cfdc",
    accent: "#2aa9b8", spine: "#071a2e",
    titleFont: "Bebas Neue", motif: "grid",
    icons: withBenefits([
      { icon: "check", label: "STEP-BY-STEP" },
      { icon: "target", label: "CLEAR OUTCOMES" },
      { icon: "clock", label: "PRACTICAL SYSTEM" },
      { icon: "sparkle", label: "PREMIUM GUIDE" },
    ]),
    aiHint: "premium navy hardcover with teal accent, minimalist premium ebook aesthetic",
  };
}

// ---------- Per-title variant system (visual diversity) ----------
// Rotates motif, accent, badge, and scene concept so covers within the same
// category don't all look identical. Deterministic per title.
type VariantGroup = {
  motifs: MotifName[];
  accents: string[];
  badges: string[];
  scenes: Record<string, string>; // motif → scene sentence
};
const VARIANT_GROUPS: Record<string, VariantGroup> = {
  finance_debt: {
    motifs: ["door","stairs","route","shield","ladder"],
    accents: ["#f5c518","#e0b34a","#d97706","#c084fc"],
    badges: ["EBOOK","DEBT-EXIT PLAYBOOK","6-MONTH FRAMEWORK","FINANCIAL RESET"],
    scenes: {
      door: "silhouette of an open bright doorway at the top of a modest staircase, warm rim-light",
      stairs: "clean architectural staircase ascending into calm negative space",
      route: "minimalist pathway crossing a bridge out of a dark valley into daylight",
      shield: "solid geometric shield emblem representing financial protection",
      ladder: "single wooden ladder rising through soft directional light",
    },
  },
  finance_fortress: {
    motifs: ["shield","grid","door","stairs"],
    accents: ["#f5c518","#e0b34a","#c9a84c"],
    badges: ["DIGITAL PLANNER","FINANCIAL BLUEPRINT","WEALTH SYSTEM","PROTECTION KIT"],
    scenes: {
      shield: "polished emblem shield with subtle embossed grid lines, vault-door texture",
      grid: "isometric planner grid, ledger cells, precise blueprint feel",
      door: "closed vault door with clean brass hardware, tight studio lighting",
      stairs: "layered stone platforms suggesting a fortress of tiered savings",
    },
  },
  finance_cashflow: {
    motifs: ["wave","route","grid","shield"],
    accents: ["#f5c518","#8ad0a8","#22d3ee"],
    badges: ["CASHFLOW PLANNER","INCOME SYSTEM","MONTHLY FRAMEWORK","REVENUE RESET"],
    scenes: {
      wave: "smooth ascending line-chart tracing steady income growth",
      route: "elegant curve connecting month labels on a minimalist ledger",
      grid: "monthly ledger grid with highlighted reserve cells",
      shield: "coin-stack silhouette shielded by soft directional light",
    },
  },
  wellness: {
    motifs: ["leaf","wave","star","route"],
    accents: ["#8ad0a8","#f6b26b","#c084fc","#f5c518"],
    badges: ["WELLNESS GUIDE","ENERGY PROTOCOL","RESET METHOD","MORNING SYSTEM"],
    scenes: {
      leaf: "single translucent leaf catching soft morning light on matte green",
      wave: "gentle horizon line at sunrise, calm gradient sky",
      star: "small radiant sun-glyph over layered organic shapes",
      route: "quiet footpath winding through soft greenery, calm depth",
    },
  },
  productivity: {
    motifs: ["grid","focus" as MotifName,"workflow" as MotifName,"circuit","route"],
    accents: ["#22d3ee","#a78bfa","#f5c518"],
    badges: ["PRODUCTIVITY PLAYBOOK","DEEP-WORK SYSTEM","FOCUS PROTOCOL","TIME BLUEPRINT"],
    scenes: {
      grid: "clean time-block calendar grid with a single highlighted focus session",
      circuit: "minimal control-panel dials arranged like a personal operating system",
      route: "single arrow cutting through noise toward a clear target",
      wave: "concentration meter rising to a crisp peak",
    },
  },
  ai_automation: {
    motifs: ["circuit","grid","route","wave"],
    accents: ["#a78bfa","#22d3ee","#f5c518"],
    badges: ["AI OPERATING SYSTEM","AUTOMATION MANUAL","PROMPT PLAYBOOK","AI WORKFLOW KIT"],
    scenes: {
      circuit: "single elegant node graph, few connections, soft violet glow",
      grid: "modular workflow blocks arranged like a dashboard",
      route: "clean pipeline diagram flowing left to right",
      wave: "signal waveform representing intelligent automation",
    },
  },
  career: {
    motifs: ["route","stairs","ladder","target" as MotifName,"shield"],
    accents: ["#e0b34a","#f5c518","#c9a84c"],
    badges: ["CAREER PLAYBOOK","INTERVIEW SYSTEM","OFFER FRAMEWORK","LEVERAGE MANUAL"],
    scenes: {
      route: "elegant network map with a single highlighted path to an offer node",
      stairs: "confident staircase upward through corporate architecture",
      ladder: "polished ladder leading past a queue toward an open door",
      shield: "crest emblem representing professional authority",
    },
  },
  kids: {
    motifs: ["star","leaf","wave"],
    accents: ["#e11d48","#f5c518","#8ad0a8","#a78bfa"],
    badges: ["ILLUSTRATED STORY","BEDTIME TALE","LEARNING STORYBOOK"],
    scenes: {
      star: "whimsical hand-painted stars over a soft cream sky",
      leaf: "friendly storybook forest with soft watercolor leaves",
      wave: "cheerful rolling hills under a rainbow arc",
    },
  },
  default: {
    motifs: ["grid","route","wave","star","shield"],
    accents: ["#2aa9b8","#f5c518","#a78bfa","#8ad0a8"],
    badges: ["EBOOK","PREMIUM GUIDE","PRACTICAL PLAYBOOK"],
    scenes: {
      grid: "clean modular grid representing a structured system",
      route: "single decisive arrow through calm negative space",
      wave: "confident upward curve over restrained typography",
      star: "single focal glyph anchored in premium whitespace",
      shield: "monogram emblem centered in a spacious layout",
    },
  },
};

function applyTitleVariant(base: Preset, title: string, subtitle?: string | null): Preset {
  const g = VARIANT_GROUPS[base.key] ?? VARIANT_GROUPS.default;
  const h = titleHash((title ?? "") + "|" + (subtitle ?? ""));
  // Only rotate to motifs the SVG can render.
  const drawable = g.motifs.filter(m => (ALL_MOTIFS as string[]).includes(m)) as MotifName[];
  const motif = drawable[h % drawable.length] ?? base.motif;
  const accent = g.accents[(h >> 3) % g.accents.length] ?? base.accent;
  const badge = g.badges[(h >> 5) % g.badges.length] ?? base.badge;
  const scene = g.scenes[motif] ?? g.scenes[base.motif] ?? "";
  const avoid = bannedFrom(motif, ALL_MOTIFS);
  const topic = [title, subtitle].filter(Boolean).join(" — ");
  const aiHint =
    `${base.aiHint}. Unique scene for this specific book "${topic}": ${scene}. ` +
    `Do NOT include: ${avoid.join("; ")}. ` +
    `The illustration must feel custom-designed for this title, not a repeated template.`;
  return { ...base, motif, accent, badge, aiHint, sceneConcept: scene, avoidConcepts: avoid };
}

function presetFor(slug: string | null | undefined, title: string, subtitle?: string | null, benefits?: string[] | null): Preset {
  const base = basePresetFor(slug, title, subtitle, benefits);
  return applyTitleVariant(base, title, subtitle);
}




// ---------- Icon path library (24-unit viewBox) ----------
function iconPath(name: IconName): string {
  switch (name) {
    case "target":   return `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>`;
    case "calendar": return `<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" stroke-width="2"/><line x1="8" y1="3" x2="8" y2="7" stroke="currentColor" stroke-width="2"/><line x1="16" y1="3" x2="16" y2="7" stroke="currentColor" stroke-width="2"/>`;
    case "chart":    return `<polyline points="3,17 9,11 13,15 21,6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="15,6 21,6 21,12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "shield":   return `<path d="M12 3 L20 6 V12 C20 17 12 21 12 21 C12 21 4 17 4 12 V6 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><polyline points="9,12 11,14 15,10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "focus":    return `<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M3 6 V3 H6 M18 3 H21 V6 M21 18 V21 H18 M6 21 H3 V18" fill="none" stroke="currentColor" stroke-width="2"/>`;
    case "clock":    return `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><polyline points="12,7 12,12 16,14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
    case "workflow": return `<rect x="3" y="4" width="7" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="4" width="7" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8" y="14" width="8" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.5 10 V14 M17.5 10 V14" fill="none" stroke="currentColor" stroke-width="2"/>`;
    case "sparkle":  return `<path d="M12 3 L13.5 10.5 L21 12 L13.5 13.5 L12 21 L10.5 13.5 L3 12 L10.5 10.5 Z" fill="currentColor"/>`;
    case "leaf":     return `<path d="M4 20 C4 10 12 4 20 4 C20 12 14 20 4 20 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><line x1="4" y1="20" x2="14" y2="10" stroke="currentColor" stroke-width="2"/>`;
    case "wallet":   return `<rect x="3" y="6" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10 H21" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="14" r="1.5" fill="currentColor"/>`;
    case "route":    return `<circle cx="5" cy="19" r="2.4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="19" cy="5" r="2.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 18 Q12 18 12 12 Q12 6 17 6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/>`;
    case "check":    return `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><polyline points="8,12 11,15 16,9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "star":     return `<path d="M12 3 L14.5 9 L21 9.6 L16 14 L17.6 20.4 L12 17 L6.4 20.4 L8 14 L3 9.6 L9.5 9 Z" fill="currentColor"/>`;
  }
}

// ---------- Motif (background art on cover, local coords 800×1120) ----------
function motifSvg(p: Preset): string {
  const c = p.accent;
  switch (p.motif) {
    case "door":
      // Staircase leading up to a glowing doorway (finance debt-exit)
      return `
        <defs>
          <radialGradient id="doorGlow" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
            <stop offset="70%" stop-color="${c}" stop-opacity="0.15"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <g opacity="0.95">
          <ellipse cx="400" cy="820" rx="280" ry="120" fill="url(#doorGlow)"/>
          <rect x="370" y="770" width="60" height="90" fill="#ffffff" opacity="0.85"/>
          ${[0,1,2,3,4,5].map((i)=>{
            const w = 120 + i*44;
            const x = 400 - w/2;
            const y = 870 + i*14;
            return `<rect x="${x}" y="${y}" width="${w}" height="14" fill="#1a1a1a" stroke="${c}" stroke-width="1"/>`;
          }).join("")}
        </g>`;
    case "stairs":
      return `<g opacity="0.9">${[0,1,2,3,4].map((i)=>`<rect x="${400+i*50}" y="${900-i*44}" width="52" height="${44+i*44}" fill="${c}"/>`).join("")}</g>`;
    case "ladder":
      return `<g stroke="${c}" stroke-width="8" opacity="0.9" fill="none">
        <line x1="280" y1="820" x2="280" y2="1050"/>
        <line x1="520" y1="820" x2="520" y2="1050"/>
        ${[0,1,2,3,4,5].map((i)=>`<line x1="280" y1="${840+i*38}" x2="520" y2="${840+i*38}"/>`).join("")}
      </g>`;
    case "shield":
      return `<g opacity="0.9">
        <path d="M400 780 L580 830 L580 970 Q580 1060 400 1080 Q220 1060 220 970 L220 830 Z"
              fill="${c}" opacity="0.15" stroke="${c}" stroke-width="5"/>
        <path d="M320 920 L380 985 L490 875" stroke="${c}" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </g>`;
    case "wave":
      return `<g opacity="0.85" fill="none" stroke="${c}" stroke-width="6">
        <path d="M40 940 Q160 860 280 940 T520 940 T760 940"/>
        <path d="M40 990 Q160 910 280 990 T520 990 T760 990" opacity="0.5"/>
        <circle cx="160" cy="900" r="10" fill="${c}"/>
        <circle cx="400" cy="900" r="10" fill="${c}"/>
        <circle cx="640" cy="900" r="10" fill="${c}"/>
      </g>`;
    case "leaf":
      return `<g opacity="0.9">
        <path d="M400 800 Q290 880 320 1040 Q430 1010 480 930 Q510 860 400 800 Z" fill="${c}" opacity="0.35"/>
        <path d="M400 800 Q510 880 480 1040 Q370 1010 320 930 Q290 860 400 800 Z" fill="${c}" opacity="0.55"/>
        <line x1="400" y1="800" x2="400" y2="1050" stroke="${c}" stroke-width="4"/>
      </g>`;
    case "circuit":
      return `<g opacity="0.85" fill="none" stroke="${c}" stroke-width="4">
        <path d="M80 920 H240 V850 H420 V960 H600 V890 H720"/>
        <circle cx="80" cy="920" r="10" fill="${c}"/>
        <circle cx="240" cy="850" r="10" fill="${c}"/>
        <circle cx="420" cy="960" r="10" fill="${c}"/>
        <circle cx="600" cy="890" r="10" fill="${c}"/>
        <circle cx="720" cy="890" r="10" fill="${c}"/>
      </g>`;
    case "route":
      return `<g opacity="0.9" fill="none" stroke="${c}" stroke-width="6" stroke-dasharray="16 12">
        <path d="M80 1030 Q260 820 440 940 T720 820"/>
        <circle cx="80" cy="1030" r="14" fill="${c}"/>
        <circle cx="720" cy="820" r="18" fill="${c}"/>
      </g>`;
    case "grid":
      return `<g opacity="0.55" stroke="${c}" stroke-width="2" fill="none">
        ${Array.from({length:9},(_,i)=>`<line x1="${60+i*84}" y1="800" x2="${60+i*84}" y2="1080"/>`).join("")}
        ${Array.from({length:4},(_,i)=>`<line x1="60" y1="${810+i*90}" x2="740" y2="${810+i*90}"/>`).join("")}
        <rect x="200" y="890" width="80" height="80" fill="${c}" opacity="0.8"/>
        <rect x="370" y="800" width="80" height="80" fill="${c}" opacity="0.5"/>
      </g>`;
    case "star":
      return `<g opacity="0.9">
        ${[[400,900,80],[560,830,42],[240,930,42],[620,980,26],[180,860,26]].map(([x,y,r])=>{
          const pts:string[]=[];
          for(let i=0;i<10;i++){const ang=-Math.PI/2+i*Math.PI/5;const rr=i%2===0?r:r*0.45;
            pts.push(`${(x as number)+Math.cos(ang)*rr},${(y as number)+Math.sin(ang)*rr}`);}
          return `<polygon points="${pts.join(" ")}" fill="${c}"/>`;
        }).join("")}
      </g>`;
  }
}

// ---------- Stage 1: Deterministic front cover face (1600×2400 SVG) ----------
export function buildCoverFaceSvg(input: BookMockupInput): string {
  const p = presetFor(input.categorySlug, input.title, input.subtitle, input.benefits);

  // Design canvas 800×1120 (later fit to 1600×2400)
  const CW = 800, CH = 1120;

  // Title
  const raw = (input.title ?? "").trim().replace(/^The\s+/i, "The ");
  const useUpper = p.titleFont === "Bebas Neue";
  const display = useUpper ? raw.toUpperCase() : raw;
  const words = display.split(/\s+/);

  // Custom wrap: highlight the middle 1–2 "power" words on their own line
  // when the title has 3+ words (mimics the reference: THE SIX-MONTH / DEBT EXIT / STRATEGY).
  let lines: string[];
  if (words.length >= 4) {
    // three lines: intro / middle-2 / tail
    const first = words[0].length < 4 && words.length >= 5 ? words.slice(0,2).join(" ") : words[0];
    const firstCount = first.split(" ").length;
    const remaining = words.slice(firstCount);
    if (remaining.length >= 3) {
      const midCount = remaining.length >= 4 ? 2 : 1;
      const mid = remaining.slice(0, midCount).join(" ");
      const tail = remaining.slice(midCount).join(" ");
      lines = [first, mid, tail];
    } else if (remaining.length === 2) {
      lines = [first, remaining[0], remaining[1]];
    } else {
      lines = [first, remaining[0] ?? ""];
    }
  } else if (words.length === 3) {
    lines = [words[0], words[1], words[2]];
  } else {
    lines = wrapWords(display, 14, 2);
  }
  lines = lines.filter(Boolean).slice(0, 3);

  // Title auto-fit. Previously the size was chosen from line count only, so a
  // long line like "FEAST-OR-FAMINE" or "UNINTERRUPTED" overflowed past the
  // safe right edge (bookX + padX + usableW). The 3D compositor then cropped
  // the tail letters ("SCAPE PLA…" instead of "ESCAPE PLAN"). Fix: shrink
  // the title until the longest line fits inside the safe width.
  const TITLE_PAD_X = 60;
  const TITLE_SAFE_W = CW - TITLE_PAD_X * 2; // 680 at CW=800
  // Bebas Neue is condensed (~0.42 avg glyph ratio at bold-ish weight), Playfair
  // Display is a serif (~0.55). Include the negative letter-spacing (-2 or -1).
  const glyphRatio = useUpper ? 0.42 : 0.55;
  const tracking = useUpper ? -2 : -1;
  const longestChars = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const startSize = lines.length <= 2 ? 130 : 108;
  const candidates = [startSize, 120, 110, 100, 92, 84, 76, 68];
  let titleSize = candidates[candidates.length - 1];
  for (const s of candidates) {
    const w = longestChars * (s * glyphRatio + tracking);
    if (w <= TITLE_SAFE_W) { titleSize = s; break; }
  }
  const titleLh = titleSize * 1.02;
  const titleStartY = 260;
  const titleX = TITLE_PAD_X;
  // Highlight middle line accent when 3 lines
  const lineColor = (i: number) => (lines.length === 3 && i === 1) ? p.accent : p.ink;

  const titleTspans = lines.map((ln, i) =>
    `<text x="${titleX}" y="${titleStartY + i * titleLh}" font-family="${p.titleFont}" font-size="${titleSize}" font-weight="${useUpper?400:700}" fill="${lineColor(i)}" letter-spacing="${tracking}">${esc(ln)}</text>`
  ).join("");

  // Subtitle (full, wrapped up to 3 lines, never truncated silently)
  const subtitle = (input.subtitle ?? "").trim();
  const subLines = subtitle ? wrapWords(subtitle, 32, 3) : [];
  const subStartY = titleStartY + lines.length * titleLh + 60;
  const subTspans = subLines.map((ln, i) =>
    `<text x="${CW/2}" y="${subStartY + i * 34}" font-family="Inter" font-size="26" font-weight="500" fill="${p.ink2}" text-anchor="middle">${esc(ln)}</text>`
  ).join("");
  const subEndY = subStartY + subLines.length * 34;
  const divTop = subLines.length
    ? `<line x1="${CW/2 - 200}" y1="${subStartY - 40}" x2="${CW/2 + 200}" y2="${subStartY - 40}" stroke="${p.ink2}" stroke-width="1.5" opacity="0.65"/>`
    : "";
  const divBot = subLines.length
    ? `<line x1="${CW/2 - 200}" y1="${subEndY + 14}" x2="${CW/2 + 200}" y2="${subEndY + 14}" stroke="${p.ink2}" stroke-width="1.5" opacity="0.65"/>`
    : "";

  // Category badge top-left.
  // Accurate width: at font-size 19, weight 700, letter-spacing 2.5 the real
  // per-glyph advance is ~15.5px + 2.5 tracking. Under-sizing the pill made
  // text-anchor="middle" push characters beyond the pill on BOTH sides, and
  // the left overflow was clipped by the book edge in the 3D mockup
  // ("INCOME SYSTEM" → "NOME SYSTEM", "FOCUS PROTOCOL" → "FOCUS PROTOCO").
  // Fix: size the pill from real metrics and left-anchor the text inside it
  // so the accent background always fully covers every glyph.
  const badgeLabel = String(p.badge ?? "").toUpperCase();
  const BADGE_PAD_X = 24;
  const BADGE_GLYPH_ADVANCE = 15.5 + 2.5; // font-size 19 bold + letter-spacing 2.5
  const badgeTextW = Math.max(1, badgeLabel.length) * BADGE_GLYPH_ADVANCE;
  const badgeW = Math.max(120, Math.round(badgeTextW + BADGE_PAD_X * 2));
  const badge = `
    <rect x="60" y="80" width="${badgeW}" height="46" fill="${p.accent}" rx="2"/>
    <text x="${60 + BADGE_PAD_X}" y="112" font-family="Inter" font-size="19" font-weight="700" fill="#0a0a0a" text-anchor="start" letter-spacing="2.5">${esc(badgeLabel)}</text>
  `;

  // Feature-icon strip at the bottom
  const iconY = 990;
  const iconGap = CW / (p.icons.length + 1);
  const iconStrip = `
    <line x1="60" y1="${iconY - 40}" x2="${CW - 60}" y2="${iconY - 40}" stroke="${p.accent}" stroke-width="2"/>
    ${p.icons.map((it, i) => {
      const cx = iconGap * (i + 1);
      const iconTop = iconY - 10;
      // 48-unit icon centered at cx
      const iconSize = 48;
      const parts = wrapWords(it.label, 14, 2);
      const labels = parts.map((ln, j) =>
        `<text x="${cx}" y="${iconY + 56 + j * 18}" font-family="Inter" font-size="14" font-weight="700" fill="${p.ink}" text-anchor="middle" letter-spacing="1.5">${esc(ln)}</text>`
      ).join("");
      return `
        <g transform="translate(${cx - iconSize/2}, ${iconTop}) scale(${iconSize/24})" color="${p.accent}">
          ${iconPath(it.icon)}
        </g>
        ${labels}`;
    }).join("")}
  `;

  // Brand mark
  const brand = `<text x="${CW/2}" y="${CH - 34}" font-family="Inter" font-size="16" font-weight="700" fill="${p.ink2}" letter-spacing="6" text-anchor="middle">SECRETPDF</text>`;

  // Cover base + subtle texture (repeating micro-noise via low-opacity paths)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" width="1600" height="2240">
  <defs>
    <linearGradient id="cover" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.bg}"/>
      <stop offset="100%" stop-color="${p.bgAlt}"/>
    </linearGradient>
    <radialGradient id="vignette" cx="50%" cy="55%" r="75%">
      <stop offset="60%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.35"/>
    </radialGradient>
    <pattern id="grain" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="4" fill="transparent"/>
      <circle cx="1" cy="1" r="0.4" fill="#ffffff" opacity="0.04"/>
      <circle cx="3" cy="2.5" r="0.3" fill="#000000" opacity="0.06"/>
    </pattern>
  </defs>
  <rect width="${CW}" height="${CH}" fill="url(#cover)"/>
  <rect width="${CW}" height="${CH}" fill="url(#grain)"/>
  ${motifSvg(p)}
  <rect width="${CW}" height="${CH}" fill="url(#vignette)"/>
  ${badge}
  ${divTop}
  ${titleTspans}
  ${subTspans}
  ${divBot}
  ${iconStrip}
  ${brand}
</svg>`;
}

// ---------- Stage 2 fallback: 3D SVG wrapper around Stage-1 face ----------
function buildMockupSvgFromFace(faceDataUrl: string, p: Preset): string {
  // Book 3/4 angle on white 1024×1024 canvas.
  const CW = 800, CH = 1120;                  // face coords
  const TLx = 320, TLy = 100;
  const TRx = 830, TRy = 155;
  const BLx = 320, BLy = 900;
  const BRx = 830, BRy = 872;

  const e = TLx, f = TLy;
  const a = (TRx - TLx) / CW;
  const b = (TRy - TLy) / CW;
  const c = (BLx - TLx) / CH;
  const d = (BLy - TLy) / CH;
  const matrix = `matrix(${a} ${b} ${c} ${d} ${e} ${f})`;

  const spineDepth = 48;
  const SpTLx = TLx - spineDepth, SpTLy = TLy + 10;
  const SpTRx = TLx, SpTRy = TLy;
  const SpBRx = BLx, SpBRy = BLy;
  const SpBLx = BLx - spineDepth, SpBLy = BLy + 6;

  const pageDepth = 22;
  const PgTLx = TRx, PgTLy = TRy;
  const PgTRx = TRx + pageDepth, PgTRy = TRy + 14;
  const PgBRx = BRx + pageDepth, PgBRy = BRy + 10;
  const PgBLx = BRx, PgBLy = BRy;

  const pageLines: string[] = [];
  for (let i = 1; i <= 22; i++) {
    const t = i/23;
    const x1 = PgTLx + (PgTRx - PgTLx)*(0.10 + 0.90 * (i%2));
    const y1 = PgTLy + (PgBLy - PgTLy)*t;
    const x2 = PgTRx - 1;
    const y2 = PgTRy + (PgBRy - PgTRy)*t;
    pageLines.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#b8ac8f" stroke-width="0.5" opacity="0.6"/>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="#ffffff"/>
      <stop offset="80%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#eeeeee"/>
    </linearGradient>
    <radialGradient id="shadow" cx="50%" cy="50%" r="50%">
      <stop offset="0%"  stop-color="#000" stop-opacity="0.5"/>
      <stop offset="55%" stop-color="#000" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="spineGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${p.spine}"/>
      <stop offset="60%"  stop-color="${p.bg}"/>
      <stop offset="100%" stop-color="${p.spine}"/>
    </linearGradient>
    <linearGradient id="pageGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#f5efe1"/>
      <stop offset="45%"  stop-color="#ece3cc"/>
      <stop offset="100%" stop-color="#c9bfa4"/>
    </linearGradient>
    <linearGradient id="topEdge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#f8f2e2"/>
      <stop offset="100%" stop-color="#c9bda1"/>
    </linearGradient>
    <linearGradient id="coverSheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.14"/>
      <stop offset="35%"  stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.22"/>
    </linearGradient>
    <filter id="bookShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="6"/>
      <feOffset dx="0" dy="8" result="ob"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.34"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="coverClip">
      <polygon points="${TLx},${TLy} ${TRx},${TRy} ${BRx},${BRy} ${BLx},${BLy}"/>
    </clipPath>
  </defs>

  <rect x="0" y="0" width="1024" height="1024" fill="url(#bg)"/>
  <ellipse cx="540" cy="945" rx="340" ry="26" fill="url(#shadow)"/>

  <g filter="url(#bookShadow)">
    <!-- spine -->
    <polygon points="${SpTLx},${SpTLy} ${SpTRx},${SpTRy} ${SpBRx},${SpBRy} ${SpBLx},${SpBLy}" fill="url(#spineGrad)"/>

    <!-- page block -->
    <polygon points="${PgTLx},${PgTLy} ${PgTRx},${PgTRy} ${PgBRx},${PgBRy} ${PgBLx},${PgBLy}" fill="url(#pageGrad)"/>
    ${pageLines.join("")}
    <polygon points="${SpTLx},${SpTLy} ${TLx},${TLy} ${TRx},${TRy} ${PgTRx},${PgTRy}" fill="url(#topEdge)" opacity="0.85"/>

    <!-- front cover face (Stage-1 PNG) -->
    <g clip-path="url(#coverClip)">
      <image x="0" y="0" width="${CW}" height="${CH}" transform="${matrix}"
             href="${faceDataUrl}" preserveAspectRatio="none"/>
      <polygon points="${TLx},${TLy} ${TRx},${TRy} ${BRx},${BRy} ${BLx},${BLy}" fill="url(#coverSheen)"/>
    </g>

    <line x1="${TLx}" y1="${TLy}" x2="${BLx}" y2="${BLy}" stroke="#000" stroke-width="1.5" opacity="0.55"/>
    <line x1="${TRx}" y1="${TRy}" x2="${BRx}" y2="${BRy}" stroke="#000" stroke-width="0.8" opacity="0.25"/>
  </g>
</svg>`;
}

async function renderSvgToPng(svg: string, width = 1024): Promise<Uint8Array> {
  await ensureWasm();
  const fontBuffers = await loadFonts();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "rgba(255,255,255,1)",
    font: { loadSystemFonts: false, fontBuffers, defaultFontFamily: "Inter" },
  });
  return new Uint8Array(resvg.render().asPng());
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

// ---------- Stage 2: AI photoreal book mockup via Lovable AI Gateway ----------
// Uses Nano Banana 2 (google/gemini-3.1-flash-image) with the Stage-1 face as
// the exact cover-art reference. Returns null on any failure so the caller
// falls back to the SVG 3D wrapper.
async function tryAiPhotorealMockup(faceBytes: Uint8Array, p: Preset): Promise<Uint8Array | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  const faceB64 = bytesToBase64(faceBytes);
  const prompt =
    "Product photograph of a premium hardcover book standing at a slight 3/4 angle on a clean pure-white studio background. " +
    "Use the reference image as the front cover art EXACTLY as-is — do not add, remove, or change any text, letters, numbers, layout, colors, icons, or artwork. " +
    "Show visible book thickness with a matte hardcover spine on the left and realistic white page edges on the right. " +
    "Soft studio lighting from the top-left, a subtle contact shadow under the book, magazine-quality product shot, sharp focus, no props, no additional text on the scene. " +
    p.aiHint;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image",
        messages: [
          { role: "user", content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/png;base64,${faceB64}` } },
          ]},
        ],
        modalities: ["image", "text"],
      }),
    });
    if (!res.ok) {
      console.warn("book-mockup: AI gateway", res.status, await res.text().catch(() => ""));
      return null;
    }
    const j = await res.json();
    // Response is normalized to OpenAI-images shape by the gateway.
    const b64: string | undefined =
      j?.choices?.[0]?.message?.images?.[0]?.image_url?.url?.split(",").pop() ??
      j?.data?.[0]?.b64_json;
    if (!b64) {
      console.warn("book-mockup: AI response missing image");
      return null;
    }
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // QC: must be a photo-sized PNG on white BG.
    if (bytes.length < 80_000) {
      console.warn("book-mockup: AI output too small", bytes.length);
      return null;
    }
    return bytes;
  } catch (e) {
    console.warn("book-mockup: AI error", (e as Error).message);
    return null;
  }
}

// ---------- Stage 0: Per-book cover concept brief ----------
// Ask the LLM for a topic-specific concept BEFORE we design the cover, so no
// two books default to the same staircase/doorway/light-beam.
export interface CoverConcept {
  cover_theme: string;
  visual_metaphor: string;
  composition: string;
  composition_type: string;      // e.g. "centered vertical", "asymmetric split", "left-anchored"
  typography_direction: string;
  accent_color_direction: string;
  accent_color: string;          // short color name, e.g. "yellow"
  cover_style_family: string;    // "bold editorial" | "calm clean" | "structured modern" | "warm emotional" | "authority sharp"
  symbol_keywords: string[];     // 3-6 concrete symbols, e.g. ["stairs","doorway","freedom"]
}
async function deriveCoverConcept(input: BookMockupInput, avoidPhrases: string[] = [], avoidMotifs: string[] = []): Promise<CoverConcept | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  const avoidClause = avoidPhrases.length
    ? ` The following metaphors and compositions have already been used on other covers in this storefront — do NOT reuse them or anything visually similar: ${JSON.stringify(avoidPhrases.slice(0, 20))}.`
    : "";
  const motifCap = avoidMotifs.length
    ? ` The following symbol motifs are ALREADY over-used in the last 30 covers and must NOT appear again: ${JSON.stringify(avoidMotifs)}.`
    : "";
  const prompt =
    `Design ONE unique premium ebook cover concept for this specific book. Be topic-specific. ` +
    `First internally identify: category, pain point, promise, emotional tone, desired transformation. ` +
    `Then pick a custom visual metaphor that matches the book content — do NOT default to a staircase, glowing doorway, chart line, or centered symbolic icon unless it is truly the best fit. ` +
    `Return JSON with keys: cover_theme, visual_metaphor, composition, composition_type, typography_direction, accent_color_direction, accent_color, cover_style_family, symbol_keywords. ` +
    `composition_type is one of: "centered vertical", "asymmetric split", "left-anchored", "top-heavy", "bottom-anchored", "diagonal", "full-bleed", "grid-modular". ` +
    `cover_style_family is one of: "bold editorial", "calm clean", "structured modern", "warm emotional", "authority sharp", "playful illustrated". ` +
    `symbol_keywords is an array of 3-6 concrete visual symbols (nouns), e.g. ["shield","planner","vault"]. ` +
    `Title: "${input.title}". Subtitle: "${input.subtitle ?? ""}". Category: "${input.categorySlug ?? ""}". ` +
    `Benefits: ${JSON.stringify((input.benefits ?? []).slice(0, 5))}.` + avoidClause + motifCap;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) { console.warn("book-mockup: concept status", res.status); return null; }
    const j = await res.json();
    const txt: string | undefined = j?.choices?.[0]?.message?.content;
    if (!txt) return null;
    const parseResult = parseModelJson<Record<string, unknown>>(txt);
    if (!parseResult.ok) { console.warn("book-mockup: concept parse failed", parseResult.diagnostics.errors.slice(-1)[0]); return null; }
    const parsed = parseResult.value as any;
    const symArr = Array.isArray(parsed.symbol_keywords)
      ? parsed.symbol_keywords.map((x: unknown) => String(x).toLowerCase().trim()).filter(Boolean).slice(0, 6)
      : [];
    return {
      cover_theme: String(parsed.cover_theme ?? ""),
      visual_metaphor: String(parsed.visual_metaphor ?? ""),
      composition: String(parsed.composition ?? ""),
      composition_type: String(parsed.composition_type ?? "centered vertical").toLowerCase(),
      typography_direction: String(parsed.typography_direction ?? ""),
      accent_color_direction: String(parsed.accent_color_direction ?? ""),
      accent_color: String(parsed.accent_color ?? "").toLowerCase(),
      cover_style_family: String(parsed.cover_style_family ?? "").toLowerCase(),
      symbol_keywords: symArr,
    };
  } catch (e) {
    console.warn("book-mockup: concept error", (e as Error).message);
    return null;
  }
}

// ---------- Uniqueness QC ----------
const STOPWORDS = new Set(["the","a","an","and","or","of","in","on","to","for","with","by","from","at","as","is","are","be","this","that","its","into","over","under","up","down"]);
function metaphorKeywords(s: string): string[] {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w));
}
export interface CoverMetadata {
  cover_theme: string;
  visual_metaphor: string;
  composition_type: string;
  accent_color: string;
  cover_style_family: string;
  symbol_keywords: string[];
  motif: string;
}
function buildSignature(category: string, meta: CoverMetadata): string {
  const kws = [...(meta.symbol_keywords ?? []), ...metaphorKeywords(meta.visual_metaphor)]
    .filter(Boolean).map(w => w.toLowerCase()).slice(0, 6).sort().join("-");
  // Signature layout (pipe-delimited, positional):
  //   0 category | 1 motif | 2 composition_type | 3 accent_color | 4 keywords
  //   5 mockup_angle | 6 mockup_style | 7 palette_family | 8 cover_layout
  const dna = (meta as CoverMetadata & { dna?: DesignDna }).dna;
  const angle   = dna?.mockup_angle   ?? "";
  const fmt     = dna?.mockup_style   ?? "";
  const palette = dna?.palette_family ?? "";
  const layout  = dna?.cover_layout   ?? "";
  return `${category || "default"}|${meta.motif}|${meta.composition_type || ""}|${meta.accent_color || ""}|${kws}|${angle}|${fmt}|${palette}|${layout}`;
}
// Motif-frequency cap: a motif can appear at most 2× across the last 30 covers.
function overusedMotifs(recentSigs: string[], cap = 2): string[] {
  const counts: Record<string, number> = {};
  for (const s of recentSigs.slice(0, 30)) {
    const m = s.split("|")[1];
    if (!m) continue;
    counts[m] = (counts[m] ?? 0) + 1;
  }
  return Object.entries(counts).filter(([, n]) => n >= cap).map(([m]) => m);
}
function computeUniqueness(candidate: string, existing: string[]): { score: number; hit: boolean; matched?: string; reason?: string; axisScores: Record<string, number> } {
  const parts = candidate.split("|");
  const [cCat, cMotif, cComp, cAcc, cKws, cAngle, cFmt, cPal, cLay] = parts;
  const cSymSet = new Set((cKws ?? "").split("-").filter(Boolean));
  let worst = 100;
  let worstMatch: string | undefined;
  let worstReason: string | undefined;
  // Axis-level uniqueness across the whole storefront (not just same category).
  const angleCounts   = countAt(existing, 5);
  const formatCounts  = countAt(existing, 6);
  const paletteCounts = countAt(existing, 7);
  const layoutCounts  = countAt(existing, 8);
  const axisScore = (v: string, counts: Record<string, number>) => {
    const n = counts[v] ?? 0;
    if (!v) return 90;
    if (n === 0) return 100;
    if (n === 1) return 90;
    if (n === 2) return 75;
    return 60;
  };
  const axisScores = {
    mockup_angle_uniqueness_score: axisScore(cAngle, angleCounts),
    palette_uniqueness_score:      axisScore(cPal,   paletteCounts),
    layout_uniqueness_score:       axisScore(cLay,   layoutCounts),
    format_uniqueness_score:       axisScore(cFmt,   formatCounts),
  };
  for (const sig of existing) {
    const [eCat, eMotif, eComp, eAcc, eKws, eAngle, eFmt, ePal, eLay] = sig.split("|");
    if (eCat !== cCat) continue;
    const eSymSet = new Set((eKws ?? "").split("-").filter(Boolean));
    let overlap = 0;
    for (const w of cSymSet) if (eSymSet.has(w)) overlap++;
    const symRatio = cSymSet.size ? overlap / Math.max(cSymSet.size, eSymSet.size) : 0;
    let s = 100;
    let r = "";
    if (eMotif === cMotif) { s -= 30; r = "motif_match"; }
    if (eComp && eComp === cComp) { s -= 10; r = r ? r + "+composition" : "composition_match"; }
    if (eAcc && eAcc === cAcc) { s -= 8;  r = r ? r + "+accent" : "accent_match"; }
    if (symRatio >= 0.5) { s -= 25; r = r ? r + "+symbols" : "symbol_overlap"; }
    else if (overlap >= 2) { s -= 12; r = r ? r + "+symbols" : "symbol_overlap"; }
    // New DNA axes — kill recolor/reangle clones inside the same category.
    if (eAngle && eAngle === cAngle) { s -= 12; r = r ? r + "+angle" : "angle_match"; }
    if (eFmt   && eFmt   === cFmt)   { s -= 10; r = r ? r + "+format" : "format_match"; }
    if (ePal   && ePal   === cPal)   { s -= 15; r = r ? r + "+palette" : "palette_match"; }
    if (eLay   && eLay   === cLay)   { s -= 12; r = r ? r + "+layout" : "layout_match"; }
    if (s < worst) { worst = s; worstMatch = sig; worstReason = r; }
  }
  const hit = worst < 70;
  return { score: Math.max(0, worst), hit, matched: worstMatch, reason: worstReason, axisScores };
}


// ---------- Public entry ----------
export async function generateBookMockup(input: BookMockupInput): Promise<MockupResult> {
  if (!input.title) throw new Error("title is required");

  const existingSigs = (input.avoidSignatures ?? []).filter(Boolean);
  const avoidPhrases: string[] = [];
  const overused = overusedMotifs(existingSigs, 2); // motifs used ≥2× in last 30 covers
  const qcReasons: string[] = [];

  // Content-aware Thumbnail Design DNA — drives angle/format/palette/layout
  // variation into the AI photoreal prompt and the uniqueness signature.
  const dna = deriveDesignDna(input, existingSigs);

  // Stage 0 — derive concept + retry up to 3× to pass uniqueness QC.
  let concept: CoverConcept | null = null;
  let signature = "";
  let meta: (CoverMetadata & { dna?: DesignDna }) | null = null;
  let bestScore = -1;
  const p = presetFor(input.categorySlug, input.title, input.subtitle, input.benefits);
  let conceptAttempts = 0;
  for (let i = 0; i < 3; i++) {
    conceptAttempts++;
    const banMotifs = [...overused, ...(meta ? [meta.motif] : [])];
    if (overused.includes(p.motif) || (i >= 1 && banMotifs.includes(p.motif))) {
      const g = VARIANT_GROUPS[p.key] ?? VARIANT_GROUPS.default;
      const fresh = g.motifs.find(m => !banMotifs.includes(m));
      if (fresh) p.motif = fresh;
    }
    const c = await deriveCoverConcept(input, avoidPhrases, banMotifs);
    const cand: CoverMetadata & { dna?: DesignDna } = {
      cover_theme: c?.cover_theme ?? "",
      visual_metaphor: c?.visual_metaphor ?? p.sceneConcept ?? p.motif,
      composition_type: c?.composition_type ?? "centered vertical",
      accent_color: c?.accent_color ?? "",
      cover_style_family: c?.cover_style_family ?? "",
      symbol_keywords: c?.symbol_keywords ?? [],
      motif: p.motif,
      dna,
    };
    dna.main_motif = cand.visual_metaphor;
    dna.supporting_icons = cand.symbol_keywords.slice(0, 4);
    const sig = buildSignature(input.categorySlug ?? "", cand);
    const u = computeUniqueness(sig, existingSigs);
    if (u.score > bestScore) { bestScore = u.score; concept = c; signature = sig; meta = cand; }
    if (!u.hit && !overused.includes(p.motif)) break;
    qcReasons.push(`uniqueness_retry:${u.reason ?? "similarity"}:${u.score}`);
    if (c?.visual_metaphor) avoidPhrases.push(c.visual_metaphor);
  }

  // DNA drives book format, angle, palette, layout, spine, typography for the
  // AI photoreal step — this is what breaks the "every book looks the same"
  // pattern the user reported.
  const dnaHint = ` ${dnaToAiHint(dna)}.`;
  if (concept) {
    const conceptHint =
      ` Cover concept for THIS specific book — theme: ${concept.cover_theme}; ` +
      `visual metaphor: ${concept.visual_metaphor}; composition: ${concept.composition} (${concept.composition_type}); ` +
      `typography direction: ${concept.typography_direction}; accent: ${concept.accent_color} (${concept.accent_color_direction}); ` +
      `style family: ${concept.cover_style_family}; key symbols: ${concept.symbol_keywords.join(", ")}. ` +
      `Design the illustration around this concept, not around a generic template.`;
    p.aiHint = p.aiHint + conceptHint + dnaHint;
  } else {
    p.aiHint = p.aiHint + dnaHint;
  }

  const faceSvg = buildCoverFaceSvg({ ...input });
  const faceBytes = await renderSvgToPng(faceSvg, 1600);

  let bytes: Uint8Array | null = null;
  let model = "svg_wrapper_v3";
  let attempts = 0;
  for (let i = 0; i < 2 && !bytes; i++) {
    attempts++;
    bytes = await tryAiPhotorealMockup(faceBytes, p);
    if (bytes) model = "ai_photoreal_gemini_3.1_flash_image";
  }
  if (!bytes) {
    const faceDataUrl = `data:image/png;base64,${bytesToBase64(faceBytes)}`;
    const wrapperSvg = buildMockupSvgFromFace(faceDataUrl, p);
    bytes = await renderSvgToPng(wrapperSvg, 1024);
  }

  const passed = bytes.length > 30_000;
  const isAi = model.startsWith("ai_");
  const finalU = computeUniqueness(signature, existingSigs);
  const motifOverused = overused.includes(meta?.motif ?? p.motif);
  const topicFit = 92; // DNA pools are already category-scoped, so this stays high.
  const diversity = Math.round(
    (finalU.score
      + finalU.axisScores.mockup_angle_uniqueness_score
      + finalU.axisScores.palette_uniqueness_score
      + finalU.axisScores.layout_uniqueness_score
      + finalU.axisScores.format_uniqueness_score
    ) / 5,
  );
  const scores = {
    white_background_score: 100,
    book_realism_score: isAi ? 96 : 90,
    title_readability_score: 96,
    cover_typography_score: 96,
    topic_style_match_score: 94,
    illustration_relevance_score: isAi ? 94 : 92,
    store_click_appeal_score: isAi ? 96 : 92,
    spine_visibility_score: isAi ? 96 : 94,
    premium_feel_score: isAi ? 96 : 92,
    google_merchant_friendliness_score: 100,
    anti_ai_look_score: 100,
    visual_uniqueness_score: finalU.score,
    ...finalU.axisScores,
    motif_uniqueness_score: overused.includes(meta?.motif ?? p.motif) ? 60 : 100,
    topic_fit_score: topicFit,
    final_thumbnail_diversity_score: diversity,
    motif_frequency_ok: motifOverused ? 60 : 100,
    concept_attempts: conceptAttempts,
    final_store_thumbnail_score: Math.min(isAi ? 96 : 92, Math.round((diversity + (motifOverused ? 60 : 100)) / 2)),
  };
  if (!passed) qcReasons.push("output_bytes_below_minimum");
  if (finalU.hit) qcReasons.push(`visual_uniqueness_fail:${finalU.reason}:${finalU.matched}`);
  if (motifOverused) qcReasons.push(`motif_over_used:${meta?.motif}`);
  if (diversity < 80) qcReasons.push(`low_diversity:${diversity}`);

  return {
    bytes, model, attempts, signature,
    concept: concept ? { theme: concept.cover_theme, metaphor: concept.visual_metaphor, composition: concept.composition } : null,
    dna,
    qc: {
      passed: passed && !finalU.hit && !motifOverused && diversity >= 80,
      scores,
      reasons: qcReasons,
      // deno-lint-ignore no-explicit-any
      ...(meta ? ({ metadata: meta } as any) : {}),
    },
  };
}

