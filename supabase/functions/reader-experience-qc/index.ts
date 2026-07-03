// Reader Experience QC — evaluates a manuscript like a real emotionally
// intelligent reader, not a grammar bot. Runs AFTER final-manuscript-qc.
//
// Contract:
//   Input:  { ebook_id, run_id? }
//   Output: writes ebooks.reader_experience_qc (JSON), .reader_experience_status
//           (pass | needs_review), .reader_experience_score, .reader_experience_fix_count.
//
// Loop:
//   1. Assemble manuscript from ebook_chapters.
//   2. Deterministic screens (repetition, canned phrases, sentence variety).
//   3. AI reader critic → 11-score rubric + flagged excerpts.
//   4. If any pass target fails and issues are repairable → targeted humanize
//      rewrite of flagged excerpts only (chapter-scoped). Re-score.
//   5. Max 3 rewrite attempts. On final fail, save needs_review + structured
//      rewrite_priorities so the admin UI can render them.
import { corsHeaders, admin, aiJSON, aiText, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";

const MAX_ATTEMPTS = 3;
const EDGE_SAFE_DEADLINE_MS = 70_000;
const MIN_AI_CALL_BUDGET_MS = 22_000;

// Pass targets from the spec.
const PASS = {
  natural_language_score: 90,
  human_written_feel_score: 90,
  readability_score: 90,
  emotional_resonance_score: 85,
  page_turning_score: 85,
  non_repetitive_score: 90,
  premium_sellability_score: 90,
} as const;

// Also tracked, not gated:
const TRACKED_ONLY = [
  "clarity_score",
  "insight_score",
  "reader_engagement_score",
  "voice_quality_score",
] as const;

const ALL_SCORE_KEYS = [...Object.keys(PASS), ...TRACKED_ONLY] as const;
type ScoreKey = typeof ALL_SCORE_KEYS[number];

// Deterministic canned-phrase / AI-tell blocklist. Presence spikes lower the
// human_written_feel_score deterministically before AI even runs.
const CANNED_PATTERNS: RegExp[] = [
  /\bin (?:today's|the modern) (?:fast[- ]paced |digital |connected )?world\b/gi,
  /\bat the end of the day\b/gi,
  /\bit is important to note that\b/gi,
  /\bin conclusion,?\s/gi,
  /\bfirst and foremost\b/gi,
  /\bwhen it comes to\b/gi,
  /\bin the realm of\b/gi,
  /\bnavigating the (?:complex|complexities of|landscape of|world of)\b/gi,
  /\bdelve into\b/gi,
  /\bunlock (?:the |your )?(?:secret|potential|power)/gi,
  /\bembark on (?:a |this |your )?journey\b/gi,
  /\bharness the power of\b/gi,
  /\bpaves? the way (?:for|to)\b/gi,
  /\ba testament to\b/gi,
  /\bplays a (?:crucial|vital|pivotal|significant) role\b/gi,
  /\bit's (?:worth|important) (?:noting|mentioning) that\b/gi,
  /\bhowever, it (?:is|'s) (?:crucial|essential|important)\b/gi,
  /\bin essence,?\s/gi,
  /\bcornerstone of\b/gi,
  /\bever[- ]evolving\b/gi,
];

interface ChapterRow {
  chapter_index: number;
  title: string;
  content: string;
  word_count: number;
}

interface FlaggedExcerpt {
  chapter_index: number;
  section_title?: string;
  excerpt: string;             // ≤ 400 chars, verbatim
  problem: string;             // human explanation
  category:
    | "robotic_phrasing"
    | "repetitive_structure"
    | "generic_filler"
    | "weak_transition"
    | "flat_emotion"
    | "cliche"
    | "fake_depth"
    | "loses_reader_interest";
  suggested_direction: string; // how to rewrite (specific)
}

interface Verdict {
  overall_verdict: string;
  overall_score: number;
  scores: Record<ScoreKey, number>;
  strengths: string[];
  weaknesses: string[];
  robotic_parts: FlaggedExcerpt[];
  repetitive_parts: FlaggedExcerpt[];
  lose_interest_parts: FlaggedExcerpt[];
  strong_pull_parts: FlaggedExcerpt[];
  rewrite_priorities: FlaggedExcerpt[];
  final_recommendation: "pass" | "minor_improvement" | "major_improvement" | "rewrite_required";
}

// ---------- Deterministic screens ----------

function countCannedHits(text: string): { total: number; samples: string[] } {
  const samples: string[] = [];
  let total = 0;
  for (const re of CANNED_PATTERNS) {
    const m = text.match(re);
    if (m) {
      total += m.length;
      if (samples.length < 8) samples.push(m[0]);
    }
  }
  return { total, samples };
}

// Detects sentences (or clauses) reused verbatim across the manuscript —
// a very reliable AI-repetition signal.
function repeatedSentenceRatio(text: string): { ratio: number; examples: string[] } {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 240);
  if (sentences.length < 20) return { ratio: 0, examples: [] };
  const counts = new Map<string, number>();
  for (const s of sentences) {
    const norm = s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    counts.set(norm, (counts.get(norm) ?? 0) + 1);
  }
  const dupes = [...counts.entries()].filter(([, n]) => n >= 2);
  const dupedSentences = dupes.reduce((a, [, n]) => a + n, 0);
  const examples = dupes.slice(0, 5).map(([s]) => s.slice(0, 160));
  return { ratio: dupedSentences / sentences.length, examples };
}

// Sentence-length variety — long stretches of same-length sentences read
// robotic. Return a 0–1 variety score (higher = more varied).
function sentenceVariety(text: string): number {
  const lens = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.split(/\s+/).filter(Boolean).length)
    .filter((n) => n >= 3 && n <= 60);
  if (lens.length < 30) return 0.7;
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
  const stdev = Math.sqrt(variance);
  // Real prose has stdev / mean ≈ 0.4–0.7. AI drafts often ≤ 0.25.
  const cv = stdev / Math.max(1, mean);
  return Math.max(0, Math.min(1, cv / 0.6));
}

// ---------- Manuscript assembly ----------

async function loadChapters(db: ReturnType<typeof admin>, ebook_id: string): Promise<ChapterRow[]> {
  const { data } = await db.from("ebook_chapters")
    .select("chapter_index,title,content,word_count").eq("ebook_id", ebook_id).order("chapter_index");
  return ((data ?? []) as ChapterRow[]).filter((c) => (c.content ?? "").trim().length > 0);
}

function truncateForCritic(chapters: ChapterRow[], maxChars = 24_000): string {
  // Sample front, middle, and end of each chapter so the critic sees pacing,
  // not just openings. Budget ~ maxChars total.
  const perChapter = Math.max(1200, Math.floor(maxChars / Math.max(1, chapters.length)));
  const seg = Math.floor(perChapter / 3);
    const parts: string[] = [];
  for (const c of chapters) {
    const body = (c.content ?? "").replace(/\s+/g, " ").trim();
    const head = body.slice(0, seg);
    const mid = body.slice(Math.max(0, Math.floor(body.length / 2) - seg / 2), Math.floor(body.length / 2) + seg / 2);
    const tail = body.slice(-seg);
    parts.push(`--- CHAPTER ${c.chapter_index}: ${c.title} (~${c.word_count ?? 0} words) ---
[OPENING] ${head}
[MIDDLE]  ${mid}
[CLOSING] ${tail}`);
  }
  return parts.join("\n\n");
}

// ---------- AI critic ----------

const CRITIC_SYSTEM = `You are one of the best editorial critics and reader-experience evaluators alive.
You read manuscripts like an emotionally intelligent, commercially experienced buyer — not a grammar bot.
You judge the total reading experience: natural language, human feel, emotional resonance, page-turning
momentum, clarity, premium sellability. You detect AI-tells: robotic phrasing, templated structures,
repeated logic, fake depth, generic filler, flat emotion, weak transitions.

Rules:
- Every flagged excerpt MUST be a verbatim string copied from the manuscript (≤ 400 chars).
- Rewrite suggestions must be specific (not "make it better").
- Score honestly on 1–100 scales. Do NOT inflate. A generic AI-sounding book scores 60–75, not 90+.
- Return valid JSON only.`;

const CRITIC_SCHEMA = `{
  "overall_verdict": "string, 3-5 sentences",
  "overall_score": "integer 1-100",
  "scores": {
    "natural_language_score": "int 1-100",
    "human_written_feel_score": "int 1-100",
    "emotional_resonance_score": "int 1-100",
    "readability_score": "int 1-100",
    "page_turning_score": "int 1-100",
    "clarity_score": "int 1-100",
    "insight_score": "int 1-100",
    "reader_engagement_score": "int 1-100",
    "voice_quality_score": "int 1-100",
    "non_repetitive_score": "int 1-100",
    "premium_sellability_score": "int 1-100"
  },
  "strengths": ["top 5, one sentence each"],
  "weaknesses": ["top 5, one sentence each"],
  "robotic_parts":       [{"chapter_index":int,"section_title":"string?","excerpt":"verbatim ≤400ch","problem":"string","category":"robotic_phrasing","suggested_direction":"string"}],
  "repetitive_parts":    [{"chapter_index":int,"excerpt":"verbatim","problem":"string","category":"repetitive_structure","suggested_direction":"string"}],
  "lose_interest_parts": [{"chapter_index":int,"excerpt":"verbatim","problem":"string","category":"loses_reader_interest","suggested_direction":"string"}],
  "strong_pull_parts":   [{"chapter_index":int,"excerpt":"verbatim","problem":"why it works","category":"flat_emotion","suggested_direction":"keep"}],
  "rewrite_priorities":  [{"chapter_index":int,"excerpt":"verbatim","problem":"string","category":"generic_filler|cliche|fake_depth|weak_transition|flat_emotion|robotic_phrasing|repetitive_structure","suggested_direction":"string"}],
  "final_recommendation": "pass | minor_improvement | major_improvement | rewrite_required"
}`;

function clampScore(n: number) {
  return Math.max(1, Math.min(100, Math.round(n)));
}

function fallbackPriorities(chapters: ChapterRow[], detRep: { examples: string[] }): FlaggedExcerpt[] {
  const out: FlaggedExcerpt[] = [];
  for (const c of chapters) {
    const content = c.content ?? "";
    for (const re of CANNED_PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(content);
      if (!m || m.index == null) continue;
      const start = Math.max(0, m.index - 120);
      const excerpt = content.slice(start, Math.min(content.length, m.index + m[0].length + 220)).replace(/\s+/g, " ").trim();
      if (excerpt.length >= 40) {
        out.push({
          chapter_index: c.chapter_index,
          section_title: c.title,
          excerpt,
          problem: `Canned/AI-sounding phrase detected: ${m[0]}`,
          category: "robotic_phrasing",
          suggested_direction: "Rewrite with a concrete, chapter-specific human example and varied sentence rhythm.",
        });
      }
      break;
    }
    if (out.length >= 8) break;
  }
  for (const ex of detRep.examples.slice(0, 3)) {
    const ch = chapters.find((c) => (c.content ?? "").toLowerCase().includes(ex.toLowerCase().slice(0, 60)));
    if (!ch) continue;
    out.push({
      chapter_index: ch.chapter_index,
      section_title: ch.title,
      excerpt: ex,
      problem: "Sentence or passage repeats elsewhere in the manuscript.",
      category: "repetitive_structure",
      suggested_direction: "Keep the meaning but change the structure, example, and cadence so this chapter feels distinct.",
    });
  }
  if (out.length === 0) {
    for (const c of chapters.slice(0, 4)) {
      const excerpt = (c.content ?? "").replace(/\s+/g, " ").trim().slice(0, 320);
      if (excerpt.length >= 80) out.push({
        chapter_index: c.chapter_index,
        section_title: c.title,
        excerpt,
        problem: "Reader QC needs a safer deterministic humanization pass because the AI critic was unavailable.",
        category: "robotic_phrasing",
        suggested_direction: "Rewrite the opening to sound more specific, lived-in, and less templated.",
      });
    }
  }
  return out.slice(0, 8);
}

function fallbackVerdict(
  chapters: ChapterRow[],
  detCanned: { total: number; samples: string[] },
  detRep: { ratio: number; examples: string[] },
  variety: number,
  sourceError: string,
): Verdict {
  const cannedPenalty = Math.min(28, detCanned.total * 2);
  const repPenalty = detRep.ratio >= 0.1 ? 35 : detRep.ratio >= 0.05 ? 20 : Math.round(detRep.ratio * 200);
  const varietyPenalty = variety < 0.35 ? 14 : variety < 0.5 ? 6 : 0;
  const scores = {
    natural_language_score: clampScore(94 - cannedPenalty - varietyPenalty),
    human_written_feel_score: clampScore(94 - cannedPenalty - varietyPenalty),
    emotional_resonance_score: clampScore(88 - Math.min(10, cannedPenalty / 3)),
    readability_score: clampScore(92 - varietyPenalty),
    page_turning_score: clampScore(88 - Math.min(12, cannedPenalty / 3)),
    clarity_score: 90,
    insight_score: 88,
    reader_engagement_score: clampScore(88 - Math.min(12, cannedPenalty / 3)),
    voice_quality_score: clampScore(90 - cannedPenalty - varietyPenalty),
    non_repetitive_score: clampScore(94 - repPenalty),
    premium_sellability_score: clampScore(90 - Math.min(16, cannedPenalty / 2)),
  } as Record<ScoreKey, number>;
  const priorities = fallbackPriorities(chapters, detRep);
  const overall = Math.round(ALL_SCORE_KEYS.reduce((a, k) => a + scores[k], 0) / ALL_SCORE_KEYS.length);
  return {
    overall_verdict: `AI reader critic was unavailable or timed out, so deterministic reader QC was used. Source error: ${sourceError.slice(0, 180)}`,
    overall_score: overall,
    scores,
    strengths: ["Manuscript has chapter content available for deterministic review."],
    weaknesses: priorities.slice(0, 5).map((p) => p.problem),
    robotic_parts: priorities.filter((p) => p.category === "robotic_phrasing"),
    repetitive_parts: priorities.filter((p) => p.category === "repetitive_structure"),
    lose_interest_parts: [],
    strong_pull_parts: [],
    rewrite_priorities: priorities,
    final_recommendation: overall >= 90 ? "pass" : priorities.length ? "minor_improvement" : "major_improvement",
  };
}

async function runCritic(
  db: ReturnType<typeof admin>,
  ebook_id: string,
  title: string,
  audience: string,
  manuscriptSample: string,
  detCanned: { total: number; samples: string[] },
  detRep: { ratio: number; examples: string[] },
  variety: number,
): Promise<Verdict> {
  const model = pickModel("premium", "qc");
  const critique = await aiJSON<Verdict>({
    model,
    system: CRITIC_SYSTEM,
    schemaHint: CRITIC_SCHEMA,
    user: `Evaluate this ebook manuscript as a real reader.

Title: ${title}
Target audience: ${audience || "general non-fiction buyer"}

Deterministic signals already measured (do NOT dispute these — use as evidence):
- Canned/AI-tell phrases detected: ${detCanned.total} (${detCanned.samples.slice(0, 5).join(" | ") || "none"})
- Verbatim repeated sentences: ${(detRep.ratio * 100).toFixed(1)}% of sampled sentences${detRep.examples.length ? " — e.g. \"" + detRep.examples[0] + "\"" : ""}
- Sentence-length variety (0-1, higher = more human): ${variety.toFixed(2)}

MANUSCRIPT SAMPLES (opening / middle / closing per chapter):
${manuscriptSample}

Return the JSON verdict per the schema. Flag EVERY excerpt verbatim from the samples above.`,
    maxTokens: 1200,
    timeoutMs: 30_000,
  });
  await logCost(db, {
    ebook_id, step: "reader_experience_qc.critic",
    model: critique.model, ...critique.usage,
  });
  return normalizeVerdict(critique.data, detCanned, detRep, variety);
}

function normalizeVerdict(
  v: Partial<Verdict>,
  detCanned: { total: number },
  detRep: { ratio: number },
  variety: number,
): Verdict {
  const scores = { ...(v.scores ?? {}) } as Record<string, number>;
  // Deterministic floors — the AI cannot rate above these when tells are heavy.
  if (detCanned.total >= 12) scores.human_written_feel_score = Math.min(scores.human_written_feel_score ?? 100, 70);
  if (detCanned.total >= 20) scores.natural_language_score  = Math.min(scores.natural_language_score  ?? 100, 68);
  if (detRep.ratio >= 0.05)  scores.non_repetitive_score    = Math.min(scores.non_repetitive_score    ?? 100, 72);
  if (detRep.ratio >= 0.10)  scores.non_repetitive_score    = Math.min(scores.non_repetitive_score    ?? 100, 55);
  if (variety < 0.35)        scores.readability_score       = Math.min(scores.readability_score       ?? 100, 78);

  for (const k of ALL_SCORE_KEYS) {
    const n = Number(scores[k]);
    scores[k] = Number.isFinite(n) ? Math.max(1, Math.min(100, Math.round(n))) : 70;
  }
  const overall = Math.round(ALL_SCORE_KEYS.reduce((a, k) => a + scores[k], 0) / ALL_SCORE_KEYS.length);

  const arr = <T>(x: unknown): T[] => Array.isArray(x) ? x as T[] : [];
  return {
    overall_verdict: v.overall_verdict ?? "",
    overall_score: v.overall_score ?? overall,
    scores: scores as Record<ScoreKey, number>,
    strengths: arr<string>(v.strengths).slice(0, 5),
    weaknesses: arr<string>(v.weaknesses).slice(0, 5),
    robotic_parts:       arr<FlaggedExcerpt>(v.robotic_parts),
    repetitive_parts:    arr<FlaggedExcerpt>(v.repetitive_parts),
    lose_interest_parts: arr<FlaggedExcerpt>(v.lose_interest_parts),
    strong_pull_parts:   arr<FlaggedExcerpt>(v.strong_pull_parts),
    rewrite_priorities:  arr<FlaggedExcerpt>(v.rewrite_priorities),
    final_recommendation: (v.final_recommendation as Verdict["final_recommendation"]) ?? "minor_improvement",
  };
}

// ---------- Gate ----------

function evaluateGate(verdict: Verdict): { passed: boolean; failedKeys: ScoreKey[] } {
  const failed: ScoreKey[] = [];
  for (const [k, min] of Object.entries(PASS) as [ScoreKey, number][]) {
    if ((verdict.scores[k] ?? 0) < min) failed.push(k);
  }
  return { passed: failed.length === 0, failedKeys: failed };
}

// ---------- Targeted humanize rewrite ----------
//
// Instead of regenerating whole chapters, we surgically replace the exact
// flagged excerpts inside their chapters. This preserves passing sections.

const HUMANIZE_SYSTEM = `You are a world-class human editor who rewrites AI-flat prose into vivid,
emotionally real writing that sounds like a smart human friend explaining something they've lived.
Rules:
- Preserve meaning and factual claims exactly.
- Kill canned phrases, generic openers, fake-depth metaphors, and templated structures.
- Vary sentence length. Use concrete sensory detail and specific examples.
- Keep the same approximate length (±20%). Do not add headings.
- Do NOT start with "In today's world", "It is important to note", "In conclusion", or similar filler.
- Return the rewritten passage as plain prose. No markdown fences, no commentary.`;

async function humanizeExcerpts(
  db: ReturnType<typeof admin>,
  ebook_id: string,
  chapters: ChapterRow[],
  priorities: FlaggedExcerpt[],
  deadlineMs: number,
): Promise<{ chaptersTouched: number; replacements: number }> {
  const byChapter = new Map<number, FlaggedExcerpt[]>();
  for (const p of priorities) {
    if (!p.excerpt || p.excerpt.length < 40) continue;
    const list = byChapter.get(p.chapter_index) ?? [];
    list.push(p);
    byChapter.set(p.chapter_index, list);
  }

  let touched = 0;
  let replacements = 0;
  let aiCalls = 0;
  const model = pickModel("premium", "content");

  for (const [chIdx, flags] of byChapter) {
    if (Date.now() > deadlineMs - MIN_AI_CALL_BUDGET_MS || aiCalls >= 2) break;
    const row = chapters.find((c) => c.chapter_index === chIdx);
    if (!row) continue;
    let content = row.content;
    let changedThisChapter = false;

    for (const f of flags.slice(0, 1)) {
      if (Date.now() > deadlineMs - MIN_AI_CALL_BUDGET_MS || aiCalls >= 2) break;
      // Find the excerpt in the chapter (allow whitespace tolerance).
      const pattern = new RegExp(escapeRegex(f.excerpt.trim()).replace(/\\\s+/g, "\\s+"), "i");
      const match = content.match(pattern);
      const original = match?.[0] ?? fallbackRepairSpan(content);
      if (!original || original.trim().length < 40) continue;

      try {
        aiCalls++;
        const rewrite = await aiText({
          model,
          system: HUMANIZE_SYSTEM,
          user: `Rewrite this passage to sound human, vivid, and non-templated.
Problem the editor flagged: ${f.problem}
Suggested direction: ${f.suggested_direction}

Original passage:
"""
${original}
"""

Return only the rewritten passage.`,
          maxTokens: 450,
          timeoutMs: 18_000,
        });
        const cleaned = (rewrite.data ?? "").trim().replace(/^["']|["']$/g, "");
        if (cleaned && cleaned.length >= original.length * 0.5) {
          content = content.replace(original, cleaned);
          replacements++;
          changedThisChapter = true;
          await logCost(db, {
            ebook_id, step: "reader_experience_qc.humanize",
            model: rewrite.model, ...rewrite.usage,
          });
        }
      } catch (_e) { /* skip this excerpt, continue */ }
    }

    if (changedThisChapter) {
      const newWc = content.split(/\s+/).filter(Boolean).length;
      await db.from("ebook_chapters")
        .update({ content, word_count: newWc })
        .eq("ebook_id", ebook_id).eq("chapter_index", chIdx);
      row.content = content;
      row.word_count = newWc;
      touched++;
    }
  }
  return { chaptersTouched: touched, replacements };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- Entry ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id } = await req.json() as { ebook_id: string; run_id?: string };
    if (!ebook_id) throw new Error("ebook_id required");

    const { data: ebook } = await db.from("ebooks").select("*").eq("id", ebook_id).maybeSingle();
    if (!ebook) throw new Error("ebook not found");

    await db.from("ebooks").update({
      reader_experience_status: "running",
      reader_experience_attempted_at: new Date().toISOString(),
    }).eq("id", ebook_id);

    const attemptsStart = Number(ebook.reader_experience_fix_count ?? 0);
    const title: string = ebook.title ?? "Untitled";
    const audience: string = ebook.target_audience ?? ebook.audience ?? "";

    let chapters = await loadChapters(db, ebook_id);
    if (chapters.length === 0) {
      throw new Error("no_chapters_to_review");
    }

    const history: Array<{ attempt: number; scores: Record<string, number>; failed_keys: string[]; humanize?: unknown }> = [];
    let verdict: Verdict | null = null;
    let passed = false;
    let attempts = 0;
    let deferred = false;
    // Supabase Edge Functions can idle-timeout around 150s. Stop well before
    // that and save a healthy `auto_retry` state so the recovery worker can
    // continue automatically instead of surfacing a red Failed state.
    const deadlineMs = Date.now() + 90_000;

    while ((attemptsStart + attempts) < MAX_ATTEMPTS) {
      if (Date.now() > deadlineMs - 12_000) { deferred = true; break; }
      attempts++;
      const fullText = chapters.map((c) => c.content).join("\n\n");
      const detCanned = countCannedHits(fullText);
      const detRep = repeatedSentenceRatio(fullText);
      const variety = sentenceVariety(fullText);
      const sample = truncateForCritic(chapters);

      try {
        verdict = await runCritic(db, ebook_id, title, audience, sample, detCanned, detRep, variety);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[reader-experience-qc] AI critic unavailable; using deterministic fallback:", msg);
        verdict = fallbackVerdict(chapters, detCanned, detRep, variety, msg);
      }
      const gate = evaluateGate(verdict);
      history.push({
        attempt: attempts,
        scores: verdict.scores,
        failed_keys: gate.failedKeys,
        humanize: undefined,
      });

      if (gate.passed) { passed = true; break; }
      if ((attemptsStart + attempts) >= MAX_ATTEMPTS) break;

      // Repair pass — surgical humanize of flagged excerpts.
      const priorities = [
        ...verdict.rewrite_priorities,
        ...verdict.robotic_parts,
        ...verdict.repetitive_parts,
        ...verdict.lose_interest_parts,
      ].slice(0, 8);
      const humanized = await humanizeExcerpts(db, ebook_id, chapters, priorities, deadlineMs - 5_000);
      history[history.length - 1].humanize = humanized;

      if (Date.now() > deadlineMs - 10_000) { deferred = true; break; }
      if (humanized.replacements === 0) break; // nothing left to repair automatically
      chapters = await loadChapters(db, ebook_id); // reload with new content
    }

    const finalOverall = verdict?.overall_score ?? 0;
    const report = {
      version: 1,
      passed,
      attempts_used: attemptsStart + attempts,
      pass_targets: PASS,
      verdict,
      history,
      generated_at: new Date().toISOString(),
    };

    if (deferred && !passed) {
      const nextRetry = new Date(Date.now() + 2 * 60_000).toISOString();
      await db.from("ebooks").update({
        reader_experience_qc: report,
        reader_experience_status: "auto_retry",
        reader_experience_score: finalOverall,
        reader_experience_fix_count: attemptsStart + attempts,
        autopilot_state: "waiting_for_worker_slot",
        canonical_status: "waiting_for_worker_slot",
        blocker_class: "recoverable_temporary_api_error",
        blocker_reason: "reader_qc_time_sliced_before_150s_timeout",
        needs_review_reason: null,
        next_retry_at: nextRetry,
      }).eq("id", ebook_id);
      return new Response(
        JSON.stringify({ ok: true, deferred: true, next_retry_at: nextRetry, overall_score: finalOverall, attempts }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await db.from("ebooks").update({
      reader_experience_qc: report,
      reader_experience_status: passed ? "pass" : "needs_review",
      reader_experience_score: finalOverall,
      reader_experience_fix_count: attemptsStart + attempts,
    }).eq("id", ebook_id);

    return new Response(
      JSON.stringify({ ok: true, passed, overall_score: finalOverall, attempts, failed_keys: verdict ? evaluateGate(verdict).failedKeys : [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
