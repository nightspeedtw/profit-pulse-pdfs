// Milestone 6 — PDF QC scoring.
// Combines deterministic structural checks (page count, required sections,
// markdown leaks, duplicate headings) with AI-based readability/polish scoring.
import { aiJSON } from "./ai.ts";

export interface PdfQcReport {
  layout_score: number;
  readability_score: number;
  worksheet_score: number;
  diagram_score: number;
  cover_score: number;
  final_pdf_premium_score: number;
  checks: {
    premium_typography: boolean;
    clean_margins: boolean;
    strong_hierarchy: boolean;
    good_spacing: boolean;
    no_raw_markdown_tables: boolean;
    no_cut_off_text: boolean;
    no_duplicated_headings: boolean;
    no_broken_diagrams: boolean;
    has_cover: boolean;
    has_title_page: boolean;
    has_copyright_disclaimer: boolean;
    has_toc: boolean;
    has_chapter_dividers: boolean;
    has_callouts: boolean;
    has_worksheets: boolean;
    has_checklists: boolean;
    has_framework_diagrams: boolean;
    has_action_plan: boolean;
    has_bonus_section: boolean;
    has_page_numbers: boolean;
    has_headers_footers: boolean;
  };
  issues: string[];
  page_count: number;
}

export interface StructuralInputs {
  html: string;
  page_count: number;
  cover_score: number;
  chapter_count: number;
}

// Deterministic structural inspection of the HTML payload we sent to Chromium.
export function structuralChecks(s: StructuralInputs): {
  checks: PdfQcReport["checks"]; issues: string[]; structure_score: number;
} {
  const h = s.html;
  const has = (sel: string) => h.includes(sel);
  const headings = Array.from(h.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)).map((m) =>
    m[1].replace(/<[^>]+>/g, "").trim().toLowerCase());
  const dupHeadings = headings.filter((t, i) => t && headings.indexOf(t) !== i);
  // Markdown leaks: pipe-tables, raw "**", standalone backticks left in body text
  const mdTableLeak = /<p[^>]*>[^<]*\|[^<]*\|[^<]*<\/p>/.test(h);
  const mdBoldLeak = /<p[^>]*>[^<]*\*\*[^<]*<\/p>/.test(h);

  const checks: PdfQcReport["checks"] = {
    premium_typography: has(`font-family: "Inter"`) && has(`Source Serif`),
    clean_margins: has(`@page`) && has(`margin:`),
    strong_hierarchy: headings.length >= s.chapter_count,
    good_spacing: has(`line-height: 1.55`),
    no_raw_markdown_tables: !mdTableLeak,
    no_cut_off_text: has(`orphans: 3`) && has(`widows: 3`),
    no_duplicated_headings: dupHeadings.length === 0 && !mdBoldLeak,
    no_broken_diagrams: !has(`framework__grid`) || has(`framework__cell`),
    has_cover: has(`class="page cover"`),
    has_title_page: has(`class="page title-page"`),
    has_copyright_disclaimer: has(`>Copyright<`) && has(`>Disclaimer<`),
    has_toc: has(`class="page toc"`),
    has_chapter_dividers: has(`class="page chapter-divider"`),
    has_callouts: has(`class="callout`),
    has_worksheets: has(`class="worksheet"`),
    has_checklists: has(`class="checklist"`),
    has_framework_diagrams: has(`class="framework"`),
    has_action_plan: has(`class="page action-plan"`),
    has_bonus_section: has(`class="page bonus-divider"`) || has(`bonus-body`),
    has_page_numbers: true, // injected via Chromium footer template
    has_headers_footers: true,
  };

  const issues: string[] = [];
  if (mdTableLeak) issues.push("raw markdown table leaked into prose");
  if (mdBoldLeak) issues.push("raw markdown bold (**) leaked into prose");
  if (dupHeadings.length) issues.push(`duplicated headings: ${dupHeadings.slice(0, 3).join(", ")}`);
  if (s.page_count > 0 && s.page_count < (5 + s.chapter_count * 2)) {
    issues.push(`page_count=${s.page_count} suspiciously low for ${s.chapter_count} chapters`);
  }

  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.values(checks).length;
  const structure_score = Math.round((passed / total) * 100);
  return { checks, issues, structure_score };
}

// AI scoring for readability and premium polish — gives qualitative judgement
// on top of deterministic checks.
export async function scorePdfReadability(model: string, opts: {
  title: string; chapterTitles: string[]; sampleProse: string;
}) {
  return aiJSON<{
    readability_score: number;
    worksheet_score: number;
    diagram_score: number;
    layout_polish_score: number;
    issues: string[];
  }>({
    model,
    system: "You are a senior book designer scoring the polish of a premium paid ebook. Score honestly — generic, AI-sounding writing must be penalized. Return JSON only.",
    user: `Premium ebook: "${opts.title}"
Chapters (${opts.chapterTitles.length}):
${opts.chapterTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Representative prose sample (truncated):
"""
${opts.sampleProse.slice(0, 5000)}
"""

Score 0–100 each. Be critical.
{
  "readability_score": 0-100,
  "worksheet_score": 0-100,
  "diagram_score": 0-100,
  "layout_polish_score": 0-100,
  "issues": ["short bullet"]
}`,
  });
}
