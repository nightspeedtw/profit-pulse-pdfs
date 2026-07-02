// Inside-illustration planner. Decides — for each chapter — whether a smart
// visual should be added, what kind, and what caption/prompt to use. Illustrations
// are AI-generated with "no text" prompts so PDF labels are HTML/SVG overlays only.
//
// Deterministic first pass (heuristics) so it never blocks the pipeline. An
// optional LLM refinement can be added later without changing the shape.

export type IllustrationKind =
  | "none"
  | "conceptual"
  | "infographic"
  | "timeline"
  | "process_map"
  | "before_after"
  | "decision_tree"
  | "cashflow_map"
  | "calculator_visual"
  | "system_diagram";

export interface IllustrationPlanEntry {
  chapter_index: number;
  chapter_title: string;
  text_density_score: number;      // 0-100, higher = more text-heavy
  recommendation: IllustrationKind;
  caption: string;                 // shown under image in PDF
  prompt: string;                  // used for AI image gen; ALWAYS "no text"
}

export interface IllustrationPlan {
  entries: IllustrationPlanEntry[];
  total_recommended: number;
  strategy: string;
}

// Keyword → kind mapping. Longer/more specific keys first.
const KIND_HINTS: [RegExp, IllustrationKind, string][] = [
  [/\b(cash[-\s]?flow|budget leak|burn rate|expense audit)\b/i, "cashflow_map", "Cash-flow map"],
  [/\b(negotiat|arbitrage|call script|hardship program)\b/i, "process_map", "Negotiation / arbitrage flow"],
  [/\b(72[-\s]?hour|sprint|liquidity)\b/i, "timeline", "72-hour liquidity sprint"],
  [/\b(velocity stacking|snowball|avalanche|payoff order)\b/i, "calculator_visual", "Payoff sequence visual"],
  [/\b(automat|defense system|guardrail)\b/i, "system_diagram", "Automated defense system"],
  [/\b(side hustle|income injection|extra income)\b/i, "process_map", "Income injection method map"],
  [/\b(tax|refund|w-?4|withhold)\b/i, "process_map", "Tax / refund optimization flow"],
  [/\b(milestone|motivation|habit|resilien|mindset)\b/i, "before_after", "Milestone anchor visual"],
  [/\b(operating system|permanent|debt-proof|long[-\s]?term)\b/i, "system_diagram", "Debt-proof operating system"],
  [/\b(forensic|audit|dashboard|balance tracker)\b/i, "infographic", "Debt forensic dashboard"],
  [/\b(decision|choose between|tradeoff|which one)\b/i, "decision_tree", "Decision tree"],
  [/\b(before|after|transformation|from … to)\b/i, "before_after", "Before / after transformation"],
];

// Compute a 0-100 text-density score: mostly-prose long chapters trend to 90+.
export function textDensityScore(content: string): number {
  const chars = (content ?? "").length;
  if (chars < 800) return 30;
  const bullets = (content.match(/(^|\n)[-*\d+.]/g) ?? []).length;
  const paragraphs = (content.match(/\n{2,}/g) ?? []).length + 1;
  const headings = (content.match(/(^|\n)#{1,6}\s/g) ?? []).length;
  // Prose-density ratio: fewer bullets/headings per 1000 chars → more text-heavy.
  const per1k = ((bullets + headings) / Math.max(1, chars / 1000));
  // per1k around 10 = balanced; below 4 is text-heavy.
  let score = 100 - Math.min(60, per1k * 8);
  // Long unbroken paragraphs push density up.
  if (paragraphs < chars / 900) score = Math.min(100, score + 10);
  return Math.round(Math.max(20, Math.min(100, score)));
}

function pickKindFor(title: string, content: string): { kind: IllustrationKind; caption: string } {
  const hay = `${title}\n${content.slice(0, 1500)}`;
  for (const [re, kind, caption] of KIND_HINTS) {
    if (re.test(hay)) return { kind, caption };
  }
  return { kind: "conceptual", caption: "Concept illustration" };
}

// Build a safe AI image prompt for a given kind. Always ends with the
// "no text" guardrail so labels are added by HTML/SVG overlay.
function buildPrompt(kind: IllustrationKind, chapterTitle: string): string {
  const base = {
    conceptual:        "Editorial minimalist conceptual illustration, muted warm palette (deep navy, cream, soft gold), abstract flat vector style, professional finance-book quality",
    infographic:       "Clean minimalist infographic composition, abstract shapes, geometric icons, muted warm palette (navy, cream, gold), no text, publication-quality",
    timeline:          "Horizontal timeline abstract illustration, milestone markers as circles, minimalist, muted warm palette, professional finance-book quality",
    process_map:       "Abstract process flow illustration with connected nodes and arrows, minimalist geometric shapes, muted warm palette, editorial style",
    before_after:      "Split illustration showing two contrasting states (chaotic vs organized), minimalist abstract shapes, muted warm palette, editorial style",
    decision_tree:     "Abstract decision-tree illustration with branching paths, minimalist geometric shapes, muted warm palette, editorial style",
    cashflow_map:      "Abstract cash-flow map illustration with flowing lines between rectangles representing accounts, minimalist, muted warm palette, editorial style",
    calculator_visual: "Abstract calculator/formula illustration with stacked coin motif and rising arrow, minimalist geometric shapes, muted warm palette, editorial style",
    system_diagram:    "Abstract system diagram with interlocking gears/nodes representing automation, minimalist geometric shapes, muted warm palette, editorial style",
    none:              "",
  }[kind];
  const scene = chapterTitle.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 80);
  return `${base}. Scene concept: ${scene}. Absolutely no text, no words, no letters, no numbers, no typography of any kind in the image.`;
}

export function planIllustrations(
  chapters: { index: number; title: string; content: string }[],
): IllustrationPlan {
  const entries: IllustrationPlanEntry[] = chapters.map((c) => {
    const density = textDensityScore(c.content);
    const chars = (c.content ?? "").length;
    // Recommend an illustration when the chapter is at least 1500 chars long
    // AND has a density ≥ 50 (moderately text-heavy). This keeps chapter
    // openings free of decoration while still adding a visual break to
    // any chapter with 3+ pages of continuous prose.
    if (chars < 1500 || density < 50) {
      return {
        chapter_index: c.index, chapter_title: c.title,
        text_density_score: density, recommendation: "none", caption: "", prompt: "",
      };
    }
    const { kind, caption } = pickKindFor(c.title, c.content);
    return {
      chapter_index: c.index,
      chapter_title: c.title,
      text_density_score: density,
      recommendation: kind,
      caption: `${caption} — ${c.title}`,
      prompt: buildPrompt(kind, c.title),
    };
  });
  const total = entries.filter((e) => e.recommendation !== "none").length;
  return {
    entries,
    total_recommended: total,
    strategy: `Text-density-driven planner: added ${total} illustration${total === 1 ? "" : "s"} where chapters are ≥50 density and ≥1500 chars.`,
  };
}
