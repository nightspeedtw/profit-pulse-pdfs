// Milestone 4 — Final Manuscript QC (structured failure reasons + targeted repair).
//
// Workflow:
//   1. Pre-validate: assemble manuscript from ebook_chapters; require ≥1 chapter and >0 words.
//      If outline has more chapters than ebook_chapters rows, mark missing_chapter
//      reasons and let the repair loop regenerate them.
//   2. Run deterministic + AI QC and produce a structured `failed_reasons` array,
//      each with { code, message, repair_action, chapter_index? }.
//   3. If failed, run targeted repairs per failed_reason (up to 3 attempts).
//   4. Re-run QC after each repair pass.
//   5. Save structured QC, attempts_used, and a detailed needs_review_reason —
//      never a generic "Manuscript QC failed after auto-fix attempts."
import { corsHeaders, admin, aiJSON, aiText, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";
import { PREMIUM_WRITER_SYSTEM } from "../_shared/prompts.ts";
import { logRun } from "../_shared/qc.ts";

const PASS_MANUSCRIPT = 85;
const PASS_COMPLIANCE = 90;
const DEFAULT_MIN_WORDS = 18000;
const MIN_CHAPTER_WORDS = 1200;
const MAX_REPAIR_ATTEMPTS = 3;

type RepairAction =
  | "expand_chapters"
  | "regenerate_missing_chapter"
  | "expand_chapter"
  | "add_disclaimer"
  | "add_worksheet_usage_section"
  | "add_framework_explanation"
  | "rewrite_duplicated_sections"
  | "rewrite_repeated_passages"
  | "humanize_manuscript"
  | "rewrite_claims"
  | "remove_and_replace_placeholders"
  | "add_practical_examples"
  | "add_step_by_step_action_plan"
  | "add_checklist"
  | "add_key_takeaway"
  | "add_common_mistake"
  | "rewrite_chapter";

interface FailedSection {
  chapter_number: number;
  section_title?: string;
  problem_text_excerpt: string;
  reason: string;
  suggested_action: "rewrite_section";
}

interface FailedReason {
  code: string;
  message: string;
  repair_action: RepairAction;
  chapter_index?: number;
  repairable?: boolean;
  failed_sections?: FailedSection[];
}

interface StructuredQC {
  passed: boolean;
  score: number;
  required_score: number;
  failed_reasons: FailedReason[];
  failed_chapters: number[];
  missing_components: string[];
  repairable: boolean;
  attempts_used: number;
  ai_scores: AiScores | null;
}

interface AiScores {
  final_content_depth_score: number;
  reader_value_score: number;
  practical_tool_score: number;
  editorial_polish_score: number;
  compliance_safety_score: number;
  refund_risk_score: number;
  final_manuscript_score: number;
  checks: Record<string, boolean>;
  issues: string[];
  blocking_issues: string[];
}

interface ChapterRow {
  chapter_index: number;
  title: string;
  content: string;
  word_count: number;
}

const AI_SCHEMA = `{
  "final_content_depth_score": 0-100,
  "reader_value_score": 0-100,
  "practical_tool_score": 0-100,
  "editorial_polish_score": 0-100,
  "compliance_safety_score": 0-100,
  "refund_risk_score": 0-100,
  "final_manuscript_score": 0-100,
  "checks": {
    "no_repeated_sections": true,
    "no_generic_filler": true,
    "no_broken_formatting": true,
    "chapter_flow_ok": true,
    "title_matches_content": true,
    "promise_delivered": true,
    "practical_tools_present": true,
    "compliance_safe_language": true,
    "buyer_value_strong": true,
    "no_unsafe_claims": true,
    "no_placeholders": true
  },
  "issues": ["short bullets"],
  "blocking_issues": ["serious only"]
}`;

const PLACEHOLDER_RE = /\[(?:insert|todo|tbd|placeholder|your[^\]]*)\b[^\]]*\]|as an ai (?:language )?model|lorem ipsum/i;
const UNSAFE_CLAIM_RE = /\b(guaranteed?|guarantee|100%\s+(?:profit|results?)|risk[-\s]?free|double your|triple your|get rich)\b/i;
const FINANCE_HEALTH_LEGAL_RE = /\b(finance|financial|invest|investing|trading|stocks?|crypto|money|wealth|tax|legal|law|health|diet|medical|therapy|nutrition|fitness)\b/i;

function wc(text: string) { return text?.trim() ? text.trim().split(/\s+/).length : 0; }

function hasSection(content: string, keywords: string[]): boolean {
  const lower = (content ?? "").toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

function detectDuplicates(chapters: ChapterRow[]): number[] {
  // Flag chapters where the first 1200 normalized chars match another chapter's prefix.
  const norm = (s: string) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 1200);
  const seen = new Map<string, number>();
  const dupes = new Set<number>();
  for (const c of chapters) {
    const key = norm(c.content);
    if (key.length < 200) continue;
    if (seen.has(key)) { dupes.add(c.chapter_index); dupes.add(seen.get(key)!); }
    else seen.set(key, c.chapter_index);
  }
  return [...dupes];
}

// Repeated AI-template phrasing detector
const REPEATED_TEMPLATE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /this chapter gives you/i, label: '"this chapter gives you…"' },
  { re: /apply this to your real numbers/i, label: '"apply this to your real numbers…"' },
  { re: /sidestep the silent traps/i, label: '"sidestep the silent traps…"' },
  { re: /in this chapter,?\s+(?:you|we)['’]?ll/i, label: '"in this chapter, you\'ll…"' },
  { re: /by the end of this chapter,?\s+you/i, label: '"by the end of this chapter, you…"' },
  { re: /without further ado/i, label: '"without further ado"' },
  { re: /let'?s dive (?:in|into)/i, label: '"let\'s dive in/into"' },
  { re: /at the end of the day/i, label: '"at the end of the day"' },
  { re: /in today'?s (?:fast[- ]paced|modern) world/i, label: '"in today\'s fast-paced world"' },
  { re: /it'?s (?:important|crucial) to note/i, label: '"it\'s important to note"' },
  { re: /key takeaways?:?\s*\n.*\n.*\n.*apply/i, label: 'templated takeaway block' },
];

function detectRepeatedTemplates(chapters: ChapterRow[]): FailedReason[] {
  const out: FailedReason[] = [];
  // Per-chapter scan for template phrases
  for (const c of chapters) {
    const content = c.content ?? "";
    const hits: { label: string; excerpt: string }[] = [];
    for (const { re, label } of REPEATED_TEMPLATE_PATTERNS) {
      const m = content.match(re);
      if (m && m.index != null) {
        const start = Math.max(0, m.index - 60);
        const end = Math.min(content.length, m.index + m[0].length + 80);
        hits.push({ label, excerpt: content.slice(start, end).replace(/\s+/g, " ").trim() });
      }
    }
    if (hits.length) {
      out.push({
        code: "repeated_templated_passages",
        message: `Chapter ${c.chapter_index} contains repeated AI-template phrasing: ${hits.map((h) => h.label).join(", ")}.`,
        repair_action: "rewrite_repeated_passages",
        chapter_index: c.chapter_index,
        repairable: true,
        failed_sections: hits.map((h) => ({
          chapter_number: c.chapter_index,
          section_title: c.title,
          problem_text_excerpt: h.excerpt,
          reason: `Repeated AI-template phrase ${h.label}`,
          suggested_action: "rewrite_section",
        })),
      });
    }
  }
  // Cross-chapter identical opening sentences
  const openings = new Map<string, number[]>();
  for (const c of chapters) {
    const first = (c.content ?? "").trim().split(/(?<=[.!?])\s+/)[0]?.toLowerCase().replace(/\s+/g, " ").slice(0, 90) ?? "";
    if (first.length < 25) continue;
    const arr = openings.get(first) ?? [];
    arr.push(c.chapter_index);
    openings.set(first, arr);
  }
  for (const [opening, idxs] of openings) {
    if (idxs.length >= 2) {
      for (const idx of idxs) {
        out.push({
          code: "repeated_chapter_opening",
          message: `Chapter ${idx} opens with the same sentence pattern as Chapter${idxs.length > 2 ? "s" : ""} ${idxs.filter((i) => i !== idx).join(", ")}.`,
          repair_action: "rewrite_repeated_passages",
          chapter_index: idx,
          repairable: true,
          failed_sections: [{
            chapter_number: idx,
            problem_text_excerpt: opening,
            reason: "Identical opening sentence pattern across chapters",
            suggested_action: "rewrite_section",
          }],
        });
      }
    }
  }
  return out;
}

function runDeterministicChecks(
  outline: any,
  chapters: ChapterRow[],
  totalWords: number,
  minWords: number,
  topicText: string,
): FailedReason[] {
  const reasons: FailedReason[] = [];
  const outlineChapters: any[] = Array.isArray(outline?.chapters) ? outline.chapters : [];

  // Missing chapters (outline vs actual)
  const presentIdx = new Set(chapters.map((c) => c.chapter_index));
  for (const oc of outlineChapters) {
    const idx = Number(oc?.index ?? oc?.chapter_number ?? oc?.number);
    if (!idx) continue;
    if (!presentIdx.has(idx)) {
      reasons.push({
        code: "missing_chapter",
        message: `Chapter ${idx} ("${oc?.title ?? oc?.chapter_title ?? "untitled"}") is missing from the manuscript.`,
        repair_action: "regenerate_missing_chapter",
        chapter_index: idx,
      });
    }
  }

  // Total word count
  if (totalWords < minWords) {
    reasons.push({
      code: "word_count_too_low",
      message: `Manuscript has ${totalWords.toLocaleString()} words, required ${minWords.toLocaleString()}.`,
      repair_action: "expand_chapters",
    });
  }

  // Per-chapter checks
  for (const c of chapters) {
    if ((c.word_count ?? 0) < MIN_CHAPTER_WORDS) {
      reasons.push({
        code: "chapter_too_short",
        message: `Chapter ${c.chapter_index} ("${c.title}") has ${c.word_count} words (min ${MIN_CHAPTER_WORDS}).`,
        repair_action: "expand_chapter",
        chapter_index: c.chapter_index,
      });
      continue; // other structural checks are unreliable on tiny chapters
    }
    if (PLACEHOLDER_RE.test(c.content ?? "")) {
      reasons.push({
        code: "placeholder_text",
        message: `Chapter ${c.chapter_index} contains placeholder/AI-leak text.`,
        repair_action: "remove_and_replace_placeholders",
        chapter_index: c.chapter_index,
      });
    }
    if (UNSAFE_CLAIM_RE.test(c.content ?? "")) {
      reasons.push({
        code: "unsafe_claims",
        message: `Chapter ${c.chapter_index} uses unsafe / guarantee-style language.`,
        repair_action: "rewrite_claims",
        chapter_index: c.chapter_index,
      });
    }
    if (!hasSection(c.content, ["checklist", "check list", "✓", "•"])) {
      reasons.push({
        code: "missing_checklist",
        message: `Chapter ${c.chapter_index} is missing a quick checklist.`,
        repair_action: "add_checklist",
        chapter_index: c.chapter_index,
      });
    }
    if (!hasSection(c.content, ["key takeaway", "takeaway", "bottom line", "in short"])) {
      reasons.push({
        code: "missing_key_takeaway",
        message: `Chapter ${c.chapter_index} is missing a key takeaway.`,
        repair_action: "add_key_takeaway",
        chapter_index: c.chapter_index,
      });
    }
    if (!hasSection(c.content, ["common mistake", "mistake people make", "where most people"])) {
      reasons.push({
        code: "missing_common_mistake",
        message: `Chapter ${c.chapter_index} is missing the common-mistake section.`,
        repair_action: "add_common_mistake",
        chapter_index: c.chapter_index,
      });
    }
    if (!hasSection(c.content, ["step 1", "step one", "step-by-step", "1.", "first,"])) {
      reasons.push({
        code: "weak_action_steps",
        message: `Chapter ${c.chapter_index} is missing a step-by-step action plan.`,
        repair_action: "add_step_by_step_action_plan",
        chapter_index: c.chapter_index,
      });
    }
    if (!hasSection(c.content, ["example", "for instance", "case study", "scenario"])) {
      reasons.push({
        code: "weak_examples",
        message: `Chapter ${c.chapter_index} is missing a practical example.`,
        repair_action: "add_practical_examples",
        chapter_index: c.chapter_index,
      });
    }
  }

  // Duplicates
  const dupes = detectDuplicates(chapters);
  for (const idx of dupes) {
    reasons.push({
      code: "duplicate_content",
      message: `Chapter ${idx} duplicates another chapter's content.`,
      repair_action: "rewrite_duplicated_sections",
      chapter_index: idx,
    });
  }

  // Disclaimer (regulated topics)
  const disclaimerRequired = !!outline?.disclaimer_required || FINANCE_HEALTH_LEGAL_RE.test(topicText);
  if (disclaimerRequired) {
    const hasDisclaimer = chapters.some((c) =>
      /disclaimer|educational purposes only|not (?:financial|medical|legal) advice/i.test(c.content ?? "")
    );
    if (!hasDisclaimer) {
      reasons.push({
        code: "missing_disclaimer",
        message: `Regulated topic (${topicText.split(/\s+/).slice(0, 6).join(" ")}…) requires a disclaimer; none was found.`,
        repair_action: "add_disclaimer",
        chapter_index: 1,
      });
    }
  }

  // Worksheet / framework references (if outline declares them)
  const declaresWorksheets = outlineChapters.some((c: any) => c?.worksheet || (Array.isArray(c?.worksheets_checklists_templates) && c.worksheets_checklists_templates.length));
  const declaresFrameworks = outlineChapters.some((c: any) => c?.framework);
  if (declaresWorksheets && !chapters.some((c) => /worksheet/i.test(c.content ?? ""))) {
    reasons.push({
      code: "missing_worksheet_reference",
      message: `Outline declares worksheets but no chapter references one.`,
      repair_action: "add_worksheet_usage_section",
      chapter_index: chapters[0]?.chapter_index ?? 1,
    });
  }
  if (declaresFrameworks && !chapters.some((c) => /framework/i.test(c.content ?? ""))) {
    reasons.push({
      code: "missing_framework_reference",
      message: `Outline declares frameworks but no chapter explains one.`,
      repair_action: "add_framework_explanation",
      chapter_index: chapters[0]?.chapter_index ?? 1,
    });
  }

  // Repeated AI-template phrasing + cross-chapter opening duplication
  reasons.push(...detectRepeatedTemplates(chapters));

  return reasons;
}

async function scoreManuscript(model: string, ebook: any, chapters: ChapterRow[]) {
  const outline = ebook.outline_json ?? {};
  const samples = chapters.map((c) => {
    const body = (c.content ?? "").replace(/\s+/g, " ").trim();
    const mid = Math.max(0, Math.floor(body.length / 2) - 350);
    return `### Ch ${c.chapter_index}: ${c.title} (${c.word_count} words)\n` +
      `[OPEN] ${body.slice(0, 900)}\n` +
      `[MID] ${body.slice(mid, mid + 700)}\n` +
      `[END] ${body.slice(-700)}`;
  }).join("\n\n").slice(0, 24_000);
  const totalWords = chapters.reduce((s, c) => s + (c.word_count ?? 0), 0);

  return aiJSON<AiScores>({
    model,
    schemaHint: AI_SCHEMA,
    system: PREMIUM_WRITER_SYSTEM + `

You are the FINAL manuscript reviewer for a premium paid PDF ebook. Be brutal. Score the whole book on:
Final Content Depth · Reader Value · Practical Tool · Editorial Polish · Compliance Safety · Refund Risk · Final Manuscript Score.
Also fill the boolean checklist honestly. Refund risk: 0 = no buyer would refund · 100 = refunds guaranteed.`,
    user: `Title: ${ebook.title}
Subtitle: ${ebook.subtitle ?? ""}
Target Buyer: ${ebook.target_buyer ?? ""}
Promise: ${outline.promise_statement ?? ""}
Total word count: ${totalWords}

Chapter samples (truncated for token budget):
${samples}

Return JSON only matching the schema.`,
    maxTokens: 2048,
  });
}

function fallbackAiScores(
  chapters: ChapterRow[],
  totalWords: number,
  minWords: number,
  deterministic: FailedReason[],
  sourceError: string,
): AiScores {
  const blocking = deterministic.filter((r) =>
    r.code === "word_count_too_low" || r.code === "missing_chapter" || r.code === "chapter_too_short" ||
    r.code === "duplicate_content" || r.code === "placeholder_text" || r.code === "unsafe_claims" ||
    r.code === "missing_disclaimer"
  );
  const hasUnsafe = deterministic.some((r) => r.code === "unsafe_claims" || r.code === "missing_disclaimer");
  const lengthRatio = Math.min(1, totalWords / Math.max(1, minWords));
  const chapterDepth = chapters.length ? chapters.filter((c) => (c.word_count ?? 0) >= MIN_CHAPTER_WORDS).length / chapters.length : 0;
  const penalty = blocking.length * 8 + deterministic.filter((r) => r.code.includes("repeated") || r.code.includes("template")).length * 3;
  const base = Math.max(55, Math.min(92, Math.round(62 + lengthRatio * 18 + chapterDepth * 12 - penalty)));
  const compliance = hasUnsafe ? 72 : 92;
  return {
    final_content_depth_score: base,
    reader_value_score: Math.max(55, Math.min(92, base - (totalWords < minWords ? 5 : 0))),
    practical_tool_score: Math.max(55, Math.min(92, base - (deterministic.some((r) => r.code.includes("worksheet")) ? 8 : 0))),
    editorial_polish_score: Math.max(55, Math.min(92, base - (deterministic.some((r) => r.code.includes("repeated")) ? 8 : 0))),
    compliance_safety_score: compliance,
    refund_risk_score: Math.max(8, Math.min(80, 100 - base + blocking.length * 5)),
    final_manuscript_score: Math.min(base, compliance),
    checks: {
      no_repeated_sections: !deterministic.some((r) => r.code.includes("repeated") || r.code.includes("duplicate")),
      no_generic_filler: !deterministic.some((r) => r.code.includes("template")),
      no_broken_formatting: true,
      chapter_flow_ok: !deterministic.some((r) => r.code === "missing_chapter"),
      title_matches_content: true,
      promise_delivered: totalWords >= minWords && blocking.length === 0,
      practical_tools_present: !deterministic.some((r) => r.code.includes("worksheet") || r.code.includes("framework")),
      compliance_safe_language: !hasUnsafe,
      buyer_value_strong: blocking.length === 0 && totalWords >= minWords,
      no_unsafe_claims: !hasUnsafe,
      no_placeholders: !deterministic.some((r) => r.code === "placeholder_text"),
    },
    issues: [`AI reviewer JSON unavailable; deterministic fallback used: ${sourceError.slice(0, 180)}`],
    blocking_issues: blocking.map((r) => r.message).slice(0, 6),
  };
}

function instructionsForReason(r: FailedReason, wordsTarget: number): string {
  switch (r.repair_action) {
    case "expand_chapter":
    case "expand_chapters":
      return `Expand significantly. Add more depth, an extra worked example, an additional framework, and a longer step-by-step section. HARD REQUIREMENT: at least ${wordsTarget} words.`;
    case "regenerate_missing_chapter":
      return `This chapter was missing entirely. Write it from scratch with full 7-beat structure (objective → main teaching → practical example → common mistake → step-by-step → quick checklist → key takeaway). At least ${wordsTarget} words.`;
    case "add_disclaimer":
      return `Add a clear, plain-English disclaimer paragraph at the top of this chapter: educational purposes only, not personalized financial / medical / legal advice. Keep all other content intact.`;
    case "add_worksheet_usage_section":
      return `Add a "How to use the worksheet" section that names the worksheet, what the reader fills in, and what they get from it.`;
    case "add_framework_explanation":
      return `Add a clearly-labeled "Framework" section that names the framework, explains each step, and shows how it produces the promised outcome.`;
    case "rewrite_duplicated_sections":
      return `This chapter duplicates another chapter. Rewrite it with a completely different persona/example, different sub-angles, and a different worked scenario.`;
    case "rewrite_repeated_passages":
      return `Rewrite this section so it keeps the same meaning but removes repeated AI-template phrasing. Make it specific, concrete, premium, and human-written. Vary sentence rhythm. Do not use the same sentence pattern as other chapters. Do not start sentences with "this chapter gives you", "apply this to your real numbers", "sidestep the silent traps", "in this chapter, you'll", "by the end of this chapter", "let's dive in", or other AI-template openers. Add chapter-specific concrete examples. Do not add unsafe claims.`;
    case "humanize_manuscript":
      return `Humanization pass: rewrite the chapter so it reads like a human premium editor wrote it. Vary the opening sentence pattern, vary transitions, vary the chapter summary/outcome bullets. Remove any repeated AI-template phrases such as "this chapter gives you…", "apply this to your real numbers…", "sidestep the silent traps…", "in this chapter, you'll…", "by the end of this chapter…", "let's dive in", "at the end of the day", "in today's fast-paced world". Preserve all facts, numbers, worksheets, frameworks, structure, length, and compliance safety.`;
    case "rewrite_claims":
      return `Remove any guarantee-style or unsafe claims ("guaranteed", "100% results", "risk-free", "get rich"). Rewrite as educational, probabilistic language.`;
    case "remove_and_replace_placeholders":
      return `Remove every placeholder ("[insert ...]", "[TODO]", "as an AI language model", lorem ipsum) and write real, specific content in its place.`;
    case "add_practical_examples":
      return `Add a fully named, realistic practical example (persona name, role, situation, what they did, the outcome).`;
    case "add_step_by_step_action_plan":
      return `Add a numbered, step-by-step action plan the reader can execute today.`;
    case "add_checklist":
      return `Add a "Quick checklist" section with 4–7 concrete bullets.`;
    case "add_key_takeaway":
      return `Add a one-line "Key takeaway" at the end of the chapter.`;
    case "add_common_mistake":
      return `Add a "Common mistake" section: what most people get wrong and why.`;
    default:
      return `Address this issue: ${r.message}`;
  }
}

async function rewriteChapter(model: string, ebook: any, ch: ChapterRow, instructions: string, wordsTarget: number) {
  const outline = ebook.outline_json ?? {};
  const oc = (outline.chapters ?? []).find((x: any) => Number(x.index ?? x.chapter_number) === ch.chapter_index) ?? {};
  const disclaimer = outline.disclaimer_required
    ? "\nThis is a regulated topic. Educational language only. No personalized advice."
    : "";
  return aiText({
    model,
    system: PREMIUM_WRITER_SYSTEM + disclaimer,
    user: `You are fixing ONE chapter of a premium ebook based on final manuscript QC feedback.

Ebook: "${ebook.title}" — ${ebook.subtitle ?? ""}
Reader: ${ebook.target_buyer ?? ""}

Chapter ${ch.chapter_index}: "${ch.title}"
Objective: ${oc.objective ?? oc.chapter_promise ?? ""}
Key teaching points: ${(oc.key_teaching_points ?? oc.learning_outcomes ?? []).join(" | ")}

FIX INSTRUCTIONS: ${instructions}

Previous chapter content (rewrite/improve — keep what works, fix what doesn't):
"""
${(ch.content ?? "").slice(0, 14000)}
"""

HARD REQUIREMENT: at least ${wordsTarget} words. Keep the 7-beat structure (objective → main teaching → practical example → common mistake → step-by-step → quick checklist → key takeaway). Do not start with the word "Chapter". Return the full chapter body only.`,
  });
}

async function writeMissingChapter(model: string, ebook: any, idx: number, wordsTarget: number) {
  const outline = ebook.outline_json ?? {};
  const oc = (outline.chapters ?? []).find((x: any) => Number(x.index ?? x.chapter_number) === idx) ?? {};
  const title = oc.title ?? oc.chapter_title ?? `Chapter ${idx}`;
  const disclaimer = outline.disclaimer_required
    ? "\nThis is a regulated topic. Educational language only. No personalized advice."
    : "";
  return {
    title,
    ...(await aiText({
      model,
      system: PREMIUM_WRITER_SYSTEM + disclaimer,
      user: `Write Chapter ${idx}: "${title}" of the ebook "${ebook.title}".
Reader: ${ebook.target_buyer ?? ""}
Objective: ${oc.objective ?? oc.chapter_promise ?? ""}
Key teaching points: ${(oc.key_teaching_points ?? oc.learning_outcomes ?? []).join(" | ")}

HARD REQUIREMENT: at least ${wordsTarget} words. Full 7-beat structure (objective → main teaching → practical example → common mistake → step-by-step → quick checklist → key takeaway). Do not start with the word "Chapter". Return chapter body only.`,
    })),
  };
}

async function loadChapters(db: ReturnType<typeof admin>, ebook_id: string): Promise<ChapterRow[]> {
  const { data } = await db.from("ebook_chapters")
    .select("chapter_index,title,content,word_count").eq("ebook_id", ebook_id).order("chapter_index");
  return (data ?? []) as ChapterRow[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const body = await req.json();
    const { ebook_id, run_id } = body as { ebook_id: string; run_id?: string };
    if (!ebook_id) throw new Error("ebook_id required");

    // ---- Subtask heartbeat helper ----
    // Emits the current subtask on the pipeline step + run rows so the admin UI
    // can see live progress. Also writes to ebooks.final_manuscript_qc.progress
    // so a details panel can render subtask + last_heartbeat_at.
    const startedAt = Date.now();
    let subtaskSeq = 0;
    async function emit(subtask: string, message: string, extra: Record<string, unknown> = {}) {
      subtaskSeq++;
      const now = new Date().toISOString();
      const progress = {
        current_subtask: subtask,
        subtask_seq: subtaskSeq,
        message,
        last_heartbeat_at: now,
        elapsed_ms: Date.now() - startedAt,
        ...extra,
      };
      // Update pipeline step + run (if run_id was passed).
      if (run_id) {
        await db.from("autopilot_pipeline_steps").update({
          message,
          metadata_json: progress,
        }).eq("run_id", run_id).eq("step_name", "manuscript_qc");
        await db.from("autopilot_pipeline_runs").update({
          current_action_message: message,
          updated_at: now,
        }).eq("id", run_id);
      }
      // Persist on the ebook so the details panel can read it after page reloads.
      await db.from("ebooks").update({
        manuscript_qc_status: "running",
        final_manuscript_qc: { progress } as any,
      }).eq("id", ebook_id);
    }

    await emit("loading_manuscript", "Loading manuscript from chapter records…");
    const { data: ebook, error } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
    if (error || !ebook) throw new Error("Ebook not found");

    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).single();
    const mode = settings?.mode ?? "hybrid";
    const minWords: number = Number(settings?.min_word_count ?? DEFAULT_MIN_WORDS);
    const scoreModel = pickModel(mode, "qc");
    const fixModel = pickModel(mode, "content");

    await db.from("ebooks").update({
      pipeline_status: "final_qc",
      writing_status: "final_qc",
      manuscript_qc_status: "running",
    }).eq("id", ebook.id);

    await emit("verify_chapters_exist", "Verifying all chapters exist…");
    let chapters = await loadChapters(db, ebook_id);


    // ---- Pre-validation: ensure we have *something* to QC ----
    if (chapters.length === 0) {
      throw new Error("No chapters to QC. Run write-chapters first.");
    }
    const outlineChapterCount = Array.isArray(ebook.outline_json?.chapters) ? ebook.outline_json.chapters.length : 0;

    const topicText = `${ebook.title ?? ""} ${ebook.subtitle ?? ""} ${ebook.target_buyer ?? ""} ${ebook.hook ?? ""}`;
    const totalChapterTarget = Math.max(outlineChapterCount, chapters.length, 1);
    const wordsTarget = Math.max(MIN_CHAPTER_WORDS + 600, Math.ceil((minWords * 1.2) / totalChapterTarget));

    let totalCost = 0;
    let attemptsUsed = 0;
    let aiScores: AiScores | null = null;
    let structured: StructuredQC | null = null;
    let passed = false;
    const repairLog: { attempt: number; action: string; chapter_index?: number }[] = [];

    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
      const attemptLabel = attempt === 0 ? "initial pass" : `re-check after repair ${attempt}/${MAX_REPAIR_ATTEMPTS}`;
      await emit("load_chapters", `Loading chapters (${attemptLabel})…`, { attempt });
      chapters = await loadChapters(db, ebook_id);

      await emit("count_words", `Calculating total word count across ${chapters.length} chapter${chapters.length === 1 ? "" : "s"}…`, {
        attempt, chapters_count: chapters.length,
      });
      const totalWords = chapters.reduce((s, c) => s + (c.word_count ?? 0), 0);
      await emit("check_structure", `Checking structure: ${chapters.length} chapters, ${totalWords.toLocaleString()} words (target ≥ ${minWords.toLocaleString()})…`, {
        attempt, total_words: totalWords, target_words: minWords,
      });

      // Deterministic checks: chapter depth, missing sections, duplicates, disclaimer, unsafe claims, placeholders.
      await emit("check_depth_and_sections", "Checking chapter depth, intro/conclusion, disclaimers, worksheets, compliance…", { attempt });
      const deterministic = runDeterministicChecks(ebook.outline_json ?? {}, chapters, totalWords, minWords, topicText);
      await emit("check_repeated_passages", "Checking repeated / templated passages across chapters…", {
        attempt, deterministic_issues: deterministic.length,
      });

      // AI score (only if chapters have meaningful content — otherwise score is meaningless)
      const meaningful = totalWords > 500;
      let scoreVal = 0;
      if (meaningful) {
        await emit("ai_score", "Calculating final manuscript score (AI reviewer)…", { attempt });
        const s = await scoreManuscript(scoreModel, ebook, chapters);
        totalCost += s.usage.cost_usd;
        aiScores = s.data;
        await logCost(db, { ebook_id: ebook.id, step: `manuscript_qc${attempt ? `:fix${attempt}` : ""}`, model: s.model, ...s.usage });
        scoreVal = aiScores.final_manuscript_score ?? 0;
        await emit("ai_score_done", `AI score: ${scoreVal}/100 (compliance ${aiScores.compliance_safety_score ?? 0}/100)`, {
          attempt, score: scoreVal, compliance: aiScores.compliance_safety_score,
        });

        // Pull AI-judged issues into structured reasons when they suggest blocking problems.
        if (aiScores.checks?.no_unsafe_claims === false) {
          deterministic.push({ code: "unsafe_claims", message: "AI reviewer flagged unsafe claims.", repair_action: "rewrite_claims" });
        }
        if (aiScores.checks?.no_repeated_sections === false) {
          // Mark every chapter so the repair loop has actionable targets, and so
          // the broad humanization fallback can run on the final attempt.
          for (const c of chapters) {
            deterministic.push({
              code: "repeated_templated_passages",
              message: `AI reviewer flagged repeated/templated passages in Chapter ${c.chapter_index}.`,
              repair_action: "rewrite_repeated_passages",
              chapter_index: c.chapter_index,
              repairable: true,
            });
          }
        }
        if (aiScores.checks?.no_placeholders === false) {
          deterministic.push({ code: "placeholder_text", message: "AI reviewer flagged placeholder/AI-leak text.", repair_action: "remove_and_replace_placeholders" });
        }
      }


      const failedChapters = Array.from(new Set(deterministic.map((r) => r.chapter_index).filter((x): x is number => typeof x === "number")));
      const missingComponents = Array.from(new Set(deterministic.filter((r) => r.code.startsWith("missing_")).map((r) => r.code)));
      const aiPass = !meaningful ? false : (scoreVal >= PASS_MANUSCRIPT && (aiScores?.compliance_safety_score ?? 0) >= PASS_COMPLIANCE);
      const blockingDeterministic = deterministic.filter((r) =>
        r.code === "word_count_too_low" || r.code === "missing_chapter" || r.code === "chapter_too_short" ||
        r.code === "duplicate_content" || r.code === "placeholder_text" || r.code === "unsafe_claims" ||
        r.code === "missing_disclaimer"
      );
      passed = aiPass && blockingDeterministic.length === 0;

      structured = {
        passed,
        score: scoreVal,
        required_score: PASS_MANUSCRIPT,
        failed_reasons: deterministic,
        failed_chapters: failedChapters,
        missing_components: missingComponents,
        repairable: deterministic.length > 0,
        attempts_used: attemptsUsed,
        ai_scores: aiScores,
      };

      const topReasonSummary = deterministic.slice(0, 3).map((r) => r.code).join(", ") || "none";
      await emit(
        passed ? "qc_passed" : "qc_result",
        passed
          ? `Manuscript QC passed. Score ${scoreVal}/100. Continuing…`
          : `QC score ${scoreVal}/100 · ${deterministic.length} issue${deterministic.length === 1 ? "" : "s"} (${topReasonSummary}). Attempt ${attempt}/${MAX_REPAIR_ATTEMPTS}.`,
        { attempt, passed, score: scoreVal, issues: deterministic.length, failed_chapters: failedChapters },
      );

      await logRun(db, {
        ebook_id: ebook.id, step: "final_manuscript_qc",
        status: passed ? "ok" : (attempt >= MAX_REPAIR_ATTEMPTS ? "fail" : "rewrite"),
        score: scoreVal, rewrite_count: attemptsUsed, cost_usd: totalCost, payload: structured as any,
      });

      if (passed || attempt >= MAX_REPAIR_ATTEMPTS) break;

      // ---- Targeted repair pass ----
      attemptsUsed++;
      await emit("repair_start", `Running targeted repair — attempt ${attemptsUsed}/${MAX_REPAIR_ATTEMPTS}. Failed chapters: [${failedChapters.join(", ") || "—"}]`, {
        attempt: attemptsUsed, failed_chapters: failedChapters, top_reasons: deterministic.slice(0, 5).map((r) => ({ code: r.code, chapter: r.chapter_index })),
      });

      // Deduplicate: at most one action per chapter per attempt; prioritize structural fixes.
      const priority: Record<string, number> = {
        regenerate_missing_chapter: 0,
        rewrite_duplicated_sections: 1,
        remove_and_replace_placeholders: 2,
        rewrite_claims: 3,
        expand_chapter: 4,
        expand_chapters: 5,
        add_disclaimer: 6,
        add_step_by_step_action_plan: 7,
        add_practical_examples: 8,
        add_common_mistake: 9,
        add_checklist: 10,
        add_key_takeaway: 11,
        add_worksheet_usage_section: 12,
        add_framework_explanation: 13,
        rewrite_repeated_passages: 14,
        rewrite_chapter: 15,
      };
      const sorted = [...deterministic].sort((a, b) => (priority[a.repair_action] ?? 99) - (priority[b.repair_action] ?? 99));
      const seenChapters = new Set<number>();
      const pickedExpandAll = { done: false };

      for (const r of sorted) {
        if (r.repair_action === "regenerate_missing_chapter" && r.chapter_index) {
          const target = wordsTarget;
          await emit("repair_chapter", `Regenerating missing Chapter ${r.chapter_index} (attempt ${attemptsUsed}/${MAX_REPAIR_ATTEMPTS})…`, { attempt: attemptsUsed, chapter_index: r.chapter_index });
          const w = await writeMissingChapter(fixModel, ebook, r.chapter_index, target);
          totalCost += w.usage.cost_usd;
          await logCost(db, { ebook_id: ebook.id, step: `manuscript_fix_new_ch${r.chapter_index}:r${attemptsUsed}`, model: w.model, ...w.usage });
          await db.from("ebook_chapters").upsert({
            ebook_id: ebook.id, chapter_index: r.chapter_index, title: w.title,
            content: w.data, word_count: wc(w.data), pipeline_status: "chapter_qc", qc_status: "passed",
          }, { onConflict: "ebook_id,chapter_index" });
          repairLog.push({ attempt: attemptsUsed, action: r.repair_action, chapter_index: r.chapter_index });
          seenChapters.add(r.chapter_index);
          continue;
        }

        if (r.repair_action === "expand_chapters") {
          if (pickedExpandAll.done) continue;
          pickedExpandAll.done = true;
          // Pick the 3 shortest chapters and expand them with a higher target.
          const shortList = [...chapters].sort((a, b) => (a.word_count ?? 0) - (b.word_count ?? 0)).slice(0, 3);
          const expandTarget = Math.ceil(wordsTarget * 1.3);
          for (const ch of shortList) {
            if (seenChapters.has(ch.chapter_index)) continue;
            await emit("repair_chapter", `Expanding short Chapter ${ch.chapter_index} to ≥${expandTarget} words (attempt ${attemptsUsed}/${MAX_REPAIR_ATTEMPTS})…`, { attempt: attemptsUsed, chapter_index: ch.chapter_index });
            const inst = instructionsForReason({ ...r, chapter_index: ch.chapter_index }, expandTarget);
            const x = await rewriteChapter(fixModel, ebook, ch, inst, expandTarget);
            totalCost += x.usage.cost_usd;
            await logCost(db, { ebook_id: ebook.id, step: `manuscript_expand_ch${ch.chapter_index}:r${attemptsUsed}`, model: x.model, ...x.usage });

            await db.from("ebook_chapters").update({ content: x.data, word_count: wc(x.data) })
              .eq("ebook_id", ebook.id).eq("chapter_index", ch.chapter_index);
            repairLog.push({ attempt: attemptsUsed, action: r.repair_action, chapter_index: ch.chapter_index });
            seenChapters.add(ch.chapter_index);
          }
          continue;
        }

        if (!r.chapter_index || seenChapters.has(r.chapter_index)) continue;
        const ch = chapters.find((c) => c.chapter_index === r.chapter_index);
        if (!ch) continue;
        const target = r.repair_action === "expand_chapter" ? Math.ceil(wordsTarget * 1.3) : wordsTarget;
        await emit("repair_chapter", `Repairing Chapter ${ch.chapter_index} (${r.repair_action}) — attempt ${attemptsUsed}/${MAX_REPAIR_ATTEMPTS}…`, { attempt: attemptsUsed, chapter_index: ch.chapter_index, action: r.repair_action });
        const x = await rewriteChapter(fixModel, ebook, ch, instructionsForReason(r, target), target);
        totalCost += x.usage.cost_usd;
        await logCost(db, { ebook_id: ebook.id, step: `manuscript_fix_ch${ch.chapter_index}:r${attemptsUsed}`, model: x.model, ...x.usage });
        await db.from("ebook_chapters").update({ content: x.data, word_count: wc(x.data) })
          .eq("ebook_id", ebook.id).eq("chapter_index", ch.chapter_index);
        repairLog.push({ attempt: attemptsUsed, action: r.repair_action, chapter_index: ch.chapter_index });
        seenChapters.add(ch.chapter_index);
      }

      // Broad humanization fallback. Triggers when:
      //   (a) repeated/templated passages remain and no per-chapter target was actionable, or
      //   (b) we're on the final attempt and humanization-eligible reasons exist.
      const humanizationNeeded = deterministic.some((r) =>
        r.repair_action === "rewrite_repeated_passages" ||
        r.code === "repeated_templated_passages" ||
        r.code === "repetitive_language" ||
        r.code === "repeated_chapter_opening"
      );
      const finalAttempt = attemptsUsed >= MAX_REPAIR_ATTEMPTS;
      const nothingHappened = seenChapters.size === 0 && !pickedExpandAll.done;

      if (humanizationNeeded && (nothingHappened || finalAttempt)) {
        await emit("humanize_pass", `Broad humanization pass across ${chapters.length} chapters (attempt ${attemptsUsed}/${MAX_REPAIR_ATTEMPTS})…`, { attempt: attemptsUsed });
        // Rewrite EVERY chapter with the humanization instruction to vary openings,
        // transitions, and summaries across the whole manuscript.
        const inst = instructionsForReason({ code: "humanize_manuscript", message: "", repair_action: "humanize_manuscript" }, 0);
        for (const ch of chapters) {
          if (seenChapters.has(ch.chapter_index)) continue;
          const target = Math.max(ch.word_count ?? 0, MIN_CHAPTER_WORDS);
          await emit("humanize_chapter", `Humanizing Chapter ${ch.chapter_index}/${chapters.length}…`, { attempt: attemptsUsed, chapter_index: ch.chapter_index });
          const x = await rewriteChapter(fixModel, ebook, ch, inst, target);
          totalCost += x.usage.cost_usd;
          await logCost(db, { ebook_id: ebook.id, step: `manuscript_humanize_ch${ch.chapter_index}:r${attemptsUsed}`, model: x.model, ...x.usage });
          await db.from("ebook_chapters").update({ content: x.data, word_count: wc(x.data) })
            .eq("ebook_id", ebook.id).eq("chapter_index", ch.chapter_index);
          repairLog.push({ attempt: attemptsUsed, action: "humanize_manuscript", chapter_index: ch.chapter_index });
          seenChapters.add(ch.chapter_index);
        }
        continue; // re-score next iteration
      }

      if (seenChapters.size === 0 && !pickedExpandAll.done) {
        // Truly nothing actionable — exit.
        break;
      }
    }

    chapters = await loadChapters(db, ebook_id);
    const totalWords = chapters.reduce((s, c) => s + (c.word_count ?? 0), 0);

    // Build detailed needs_review_reason — never a generic message.
    const topReasons = (structured?.failed_reasons ?? []).slice(0, 4)
      .map((r) => `• ${r.message}`).join("\n");
    const detailedReason = passed
      ? null
      : `Manuscript QC failed after ${attemptsUsed}/${MAX_REPAIR_ATTEMPTS} repair attempts.\nUnresolved issues:\n${topReasons || "(no structured reasons captured)"}`;

    const finalStatus = passed ? "manuscript_passed" : "needs_review";
    const writingStatus = passed ? "manuscript_passed" : "needs_review";
    const pipelineStatus = passed ? "pdf_design" : "final_qc";

    // Persist final state and preserve progress trail (subtask_seq / elapsed_ms).
    const finalProgress = {
      current_subtask: passed ? "passed" : "failed",
      subtask_seq: subtaskSeq + 1,
      message: passed
        ? `Manuscript QC passed. Score ${aiScores?.final_manuscript_score ?? 0}/100.`
        : `Manuscript QC failed after ${attemptsUsed}/${MAX_REPAIR_ATTEMPTS} repair attempts.`,
      last_heartbeat_at: new Date().toISOString(),
      elapsed_ms: Date.now() - startedAt,
      total_words: totalWords,
      score: aiScores?.final_manuscript_score ?? null,
      attempts_used: attemptsUsed,
    };
    await db.from("ebooks").update({
      final_manuscript_qc: { ...(structured as any), progress: finalProgress } as any,
      final_manuscript_score: aiScores?.final_manuscript_score ?? null,
      reader_value_score: aiScores?.reader_value_score ?? null,
      practical_tool_score: aiScores?.practical_tool_score ?? null,
      editorial_polish_score: aiScores?.editorial_polish_score ?? null,
      refund_risk_score: aiScores?.refund_risk_score ?? null,
      compliance_safety_score: aiScores?.compliance_safety_score ?? null,
      final_quality_score: aiScores?.final_manuscript_score ?? null,
      content_depth_score: aiScores?.final_content_depth_score ?? null,
      manuscript_fix_count: attemptsUsed,
      manuscript_qc_status: finalStatus,
      qc_status: passed ? "qc_passed" : "needs_admin_review",
      total_word_count: totalWords,
      word_count: totalWords,
      writing_status: writingStatus,
      pipeline_status: pipelineStatus,
      status: passed ? "ready_for_qc" : "needs_review",
      rejection_reason: detailedReason,
      needs_review_reason: detailedReason,
      cost_usd: Number(ebook.cost_usd ?? 0) + totalCost,
    }).eq("id", ebook.id);

    if (run_id) {
      await db.from("autopilot_pipeline_steps").update({
        message: finalProgress.message,
        metadata_json: finalProgress,
      }).eq("run_id", run_id).eq("step_name", "manuscript_qc");
    }

    return new Response(JSON.stringify({
      ok: true, pass: passed, attempts_used: attemptsUsed,
      structured, repair_log: repairLog, total_word_count: totalWords,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
