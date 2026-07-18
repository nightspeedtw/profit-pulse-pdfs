// Structured segmented-manuscript writer + deterministic pre-image gate.
//
// KILLER 2 fix: writers previously emitted a free-form manuscript_md that a
// downstream splitter re-parsed into ~28 pages. When the split disagreed with
// the story judge or the illustrator, we spent image credits on a mismatched
// scene plan. Now the writer emits an EXACT-count array of page segments and
// every downstream consumer reads that array directly.
//
// Shape persisted at ebook.storefront_meta.kids_manuscript_segments:
//   { title, refrain, target: 28, pages: [{ page: 1..N, text: "..." }] }
//
// manuscript_md is a derived render (segments joined with blank lines) so any
// legacy consumer still works.

const LOVABLE_API_KEY = (globalThis as unknown as { Deno?: { env?: { get?: (key: string) => string | undefined } } })
  .Deno?.env?.get?.("LOVABLE_API_KEY") ?? "";

export interface KidsSegment {
  page: number;
  text: string;
  contains_refrain?: boolean;
}

// Structural refrain placement: pages that MUST carry the refrain verbatim.
// Choosing 2 (setup echo), middle beat, and final (payoff) guarantees the
// ≥3-verbatim gate BY CONSTRUCTION rather than hoping the model repeats it.
export function refrainPagesFor(target: number): number[] {
  const setup = 2;
  const mid = Math.max(setup + 1, Math.floor(target / 2));
  const finalPage = target;
  return Array.from(new Set([setup, mid, finalPage])).sort((a, b) => a - b);
}

// Historical failures the writer has produced against this gate. Fed into
// every prompt so the model does not repeat them. Append-only.
export const KNOWN_REFRAIN_FAILURES: string[] = [
  `run 0d592fc9 (2026-07-15): refrain "Sticky-gooey, wobbly-gluey, it's Pip's sweet mess!" appeared on only 2 pages — model paraphrased it as "sticky-gooey mess" on the third page instead of copying it verbatim.`,
  `run 770bfe17 (2026-07-15): refrain-count gate failed a second time despite the rewrite receiving the exact violation text — auto-rewrite prompt did not re-embed the refrain STRING itself, so the model invented a new one on retry.`,
];

export interface SegmentedManuscript {
  title: string;
  refrain: string;
  target: number;
  pages: KidsSegment[];
}

export interface SegmentValidation {
  ok: boolean;
  violations: string[]; // human-readable, quoted violations for rewrite prompt
}

// ---------------------------------------------------------------------------
// Deterministic pre-image gate. Cheap, runs before the LLM story judge.
// ---------------------------------------------------------------------------
export function validateSegments(
  m: SegmentedManuscript,
  opts: { target: number; minWords?: number; maxWords?: number; minRefrainOccurrences?: number },
): SegmentValidation {
  const target = opts.target;
  const minW = opts.minWords ?? 15;
  const maxW = opts.maxWords ?? 30;
  const minRefrain = opts.minRefrainOccurrences ?? 3;
  const v: string[] = [];

  const pages = Array.isArray(m?.pages) ? m.pages : [];
  if (pages.length !== target) {
    v.push(`segment_count: got ${pages.length}, need exactly ${target}`);
  }

  const placeholderRx = /^\s*(page\s*\d+|todo|tbd|lorem|placeholder|\.\.\.)\s*\.?\s*$/i;
  // SKILL E — page_text_completeness_gate. Text must END with terminal
  // punctuation (. ! ? …), optionally followed by closing wrappers
  // (straight/curly quotes, closing parens/brackets/braces). Dialogue-final
  // text like `…PLOOP!”` or `…done!)` is legitimate and must PASS. A bare
  // trailing comma or mid-sentence connector (e.g. `He made a big,`) still
  // FAILS because there is no terminal punctuation before the wrapper.
  const terminalPunctRx = /[.!?…][\s"'”“’‘)\]\}]*$/u;
  pages.forEach((p, i) => {
    const idx = i + 1;
    const text = String(p?.text ?? "").trim();
    if (!text) {
      v.push(`page ${idx}: empty text`);
      return;
    }
    if (placeholderRx.test(text)) {
      v.push(`page ${idx}: placeholder text "${text.slice(0, 60)}"`);
    }
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < minW || words > maxW) {
      v.push(`page ${idx}: ${words} words (need ${minW}-${maxW}) — "${text.slice(0, 80)}"`);
    }
    if (Number(p?.page ?? idx) !== idx) {
      v.push(`page ${idx}: page number is ${p?.page} — must be sequential 1..${target}`);
    }
    if (!terminalPunctRx.test(text)) {
      v.push(`page ${idx}: page_text_completeness_gate — no terminal punctuation (.!?…) — "${text.slice(-60)}"`);
    }
  });

  const refrain = String(m?.refrain ?? "").trim();
  if (!refrain) {
    v.push(`refrain: missing — writer must define one short chantable line and repeat it verbatim on the marked refrain pages`);
  } else {
    const required = refrainPagesFor(target);
    const nRefrain = normalizeForRefrainMatch(refrain);
    // Structural check — pages MARKED contains_refrain: true MUST contain the refrain verbatim.
    for (const pn of required) {
      const p = pages.find((x) => Number(x?.page) === pn);
      const text = String(p?.text ?? "");
      const marked = Boolean(p?.contains_refrain);
      const hasVerbatim = nRefrain.length >= 3 && normalizeForRefrainMatch(text).includes(nRefrain);
      if (!marked) {
        v.push(`page ${pn}: contains_refrain must be true — this is a designated refrain page (setup/mid/final). Set "contains_refrain": true AND include the refrain verbatim: "${refrain}".`);
      }
      if (!hasVerbatim) {
        v.push(`page ${pn}: refrain missing from text — the refrain "${refrain}" MUST appear VERBATIM (identical wording and punctuation) inside page ${pn}.text. Copy the exact string. Do not paraphrase, translate, or shorten.`);
      }
    }
    const count = countRefrainOccurrences(pages, refrain);
    if (count < minRefrain) {
      v.push(`refrain "${refrain}" appears in ${count} pages, need ≥${minRefrain} — refrain pages are ${required.join(", ")}; put the refrain verbatim on ALL of them.`);
    }
  }

  return { ok: v.length === 0, violations: v };
}

function normalizeForRefrainMatch(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function countRefrainOccurrences(pages: KidsSegment[], refrain: string): number {
  const n = normalizeForRefrainMatch(refrain);
  if (n.length < 3) return 0;
  let c = 0;
  for (const p of pages) if (normalizeForRefrainMatch(String(p.text ?? "")).includes(n)) c++;
  return c;
}



// ---------------------------------------------------------------------------
// Human-readable render — kept for legacy consumers of manuscript_md.
// Uses blank-line separators so any \n\n+ splitter also produces the same N.
// ---------------------------------------------------------------------------
export function renderSegmentsToMd(m: SegmentedManuscript): string {
  return (m.pages ?? [])
    .slice()
    .sort((a, b) => a.page - b.page)
    .map((p) => `<!-- page ${p.page} -->\n${String(p.text ?? "").trim()}`)
    .join("\n\n");
}

export function segmentsToPageTexts(m: SegmentedManuscript | null | undefined): string[] {
  if (!m?.pages) return [];
  return m.pages.slice().sort((a, b) => a.page - b.page).map((p) => String(p.text ?? "").trim());
}

// Derives an illustration ScenePlan 1:1 from segments. Emotion/setting are
// left generic here — the render step re-hydrates them from the bible + text.
export function segmentsToScenePlan(m: SegmentedManuscript): { scenes: Array<{ scene: string; emotion: string; setting: string }> } {
  const pages = segmentsToPageTexts(m);
  return {
    scenes: pages.map((text) => ({
      scene: text,
      emotion: "warm",
      setting: "storybook world",
    })),
  };
}

// Extract segments from an ebooks_kids or ebooks row. Prefers the canonical
// storefront_meta location; falls back to kids_scene_briefs_json.spreads.
export function loadSegments(ebook: Record<string, unknown> | null | undefined): SegmentedManuscript | null {
  if (!ebook) return null;
  const meta = (ebook.storefront_meta ?? {}) as Record<string, unknown>;
  const seg = meta.kids_manuscript_segments as SegmentedManuscript | undefined;
  if (seg && Array.isArray(seg.pages) && seg.pages.length > 0) return seg;
  // Compat: derive from kids_scene_briefs_json (rewrite-kids-manuscript path).
  const briefs = ebook.kids_scene_briefs_json as { spreads?: Array<{ story_text?: string; text?: string }> } | undefined;
  if (briefs?.spreads?.length) {
    const pages: KidsSegment[] = briefs.spreads.map((s, i) => ({
      page: i + 1,
      text: String(s?.story_text ?? s?.text ?? "").trim(),
    }));
    return { title: String(ebook.title ?? ""), refrain: "", target: pages.length, pages };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The writer. One structured call to Gemini, one deterministic validation,
// one automatic rewrite on failure with the specific violations quoted.
// ---------------------------------------------------------------------------
export interface WriteSegmentsOpts {
  title: string;
  subtitle?: string | null;
  description?: string | null;
  ageBand?: string | null;
  target: number; // typically 28
  heroName?: string | null;
  extraCraftBlock?: string; // e.g. loadStoryCraftBlock output
  model?: string;
  timeoutMs?: number;
  // For cost accounting (right-first-time verification). Optional so legacy
  // callers keep compiling; when set every writer attempt is logged to cost_log.
  ebookId?: string | null;
  ideaId?: string | null;
}


// RIGHT-FIRST-TIME ARCHITECTURE (2026-07-18):
// Writer defaults to the TOP text tier with the complete story_gate rubric
// baked into the system prompt so the FIRST draft is written TO the rubric,
// not graded against it blind. This deprecates the repair ladder: pipeline
// does one regeneration with judge feedback and retires the concept otherwise.
const DEFAULT_MODEL = "google/gemini-2.5-pro";

const STORY_GATE_RUBRIC_ADDENDUM = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STORY_GATE RUBRIC — write TO these thresholds. Every draft is judged on:
  * age_appropriateness   ≥ 90  (grade 1-2 vocab, gentle worry never terror, one theme)
  * story_coherence       ≥ 90  (4-act arc across the beats; three escalating tries; hero solves it)
  * emotional_payoff      ≥ 85  (small hero + small want; warm final-spread payoff; implicit moral via action)
  * reread_value          ≥ 85  (chantable refrain repeated ≥3×, participation beats on most spreads,
                                 one hidden-detail thread across pages, callback ending — NOT a moral summary)
  * language_level        ≥ 90  (sensory read-aloud voice; short sentences; rhythm)
  * parent_buyer_value    ≥ 85  (developmental theme a parent can name in one sentence;
                                 lesson SHOWN not told; child has real agency; fun first, teaching second)
  * generic_story_risk    ≤ 25  (distinctive story engine tied to premise; visual hook cannot be swapped;
                                 no interchangeable "child learns lesson from object" plot)

WRITE AS IF THE JUDGE IS READING. Anchor every page-turn to a specific mechanic
that only this premise could produce. Ban moralizing lines ("and that's how she
learned…", "the lesson was…"). End on a callback / ritual / reveal, never a summary.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

const WRITER_SYSTEM = `You are a professional children's picture-book author writing for ages 4-7.

Follow the Children's Storybook Consistency Lock: warm read-aloud voice, sensory detail,
gentle rhythm, satisfying resolution, implicit moral (never a lecture). English only.

You MUST return valid JSON only — no markdown, no prose framing, no code fences.
${STORY_GATE_RUBRIC_ADDENDUM}`;

function buildWriterUser(
  opts: WriteSegmentsOpts,
  extraViolations?: string[],
  lockedPages?: KidsSegment[],
  priorRefrain?: string,
): string {
  const violationsBlock = extraViolations?.length
    ? `\n\nPREVIOUS ATTEMPT FAILED THE DETERMINISTIC GATE. Fix EVERY violation below on this rewrite:\n- ${extraViolations.join("\n- ")}\n`
    : "";
  const locked = (lockedPages ?? []).slice().sort((a, b) => a.page - b.page);
  const lockedNumbers = new Set(locked.map((p) => p.page));
  const missingNumbers = Array.from({ length: opts.target }, (_, i) => i + 1).filter((n) => !lockedNumbers.has(n));
  const partialRecoveryBlock = locked.length > 0
    ? `\n\nPARTIAL JSON RECOVERY MODE:\nThe parser recovered complete page objects for pages ${locked.map((p) => p.page).join(", ")}. Those pages are LOCKED and must not be rewritten.\nReturn JSON with the same title/refrain shape, but the pages array must contain ONLY the missing/broken page numbers: ${missingNumbers.join(", ")}.\nRecovered pages for context:\n${JSON.stringify(locked)}\n`
    : "";
  const required = refrainPagesFor(opts.target);
  const priorRefrainBlock = priorRefrain
    ? `\n\nREFRAIN LOCK (do NOT invent a new refrain on this retry):\nThe refrain from the previous attempt is:\n>>> ${priorRefrain} <<<\nKeep this EXACT string as the "refrain" field AND paste it VERBATIM into the "text" of pages ${required.join(", ")}. Do not translate, paraphrase, shorten, restyle punctuation, or change capitalisation.\n`
    : "";
  const knownFailuresBlock = `\n\nKNOWN PAST FAILURES OF THIS GATE (do not repeat):\n- ${KNOWN_REFRAIN_FAILURES.join("\n- ")}\n`;
  return `Book title: "${opts.title}"
Subtitle: "${opts.subtitle ?? ""}"
Story promise / description: ${opts.description ?? ""}
Hero: ${opts.heroName ?? "(pick a name and use it consistently)"}
Target reader: ages ${opts.ageBand ?? "4-6"}

${opts.extraCraftBlock ?? ""}

TASK: write a SQUARE 8.5x8.5 in picture-book manuscript as STRUCTURED JSON.

STRICT SHAPE — return exactly:
{
  "title": "the book title",
  "refrain": "one short chantable line — this EXACT string must be pasted verbatim into the text of the refrain pages below",
  "pages": [
    { "page": 1, "text": "15-30 words of read-aloud text for page 1", "contains_refrain": false },
    { "page": 2, "text": "... — this page is a refrain page, MUST include the refrain verbatim", "contains_refrain": true },
    ...
    { "page": ${opts.target}, "text": "... — final refrain payoff, MUST include the refrain verbatim", "contains_refrain": true }
  ]
}

REFRAIN PLACEMENT (structural — enforced by the gate BY CONSTRUCTION):
- Pages ${required.join(", ")} are the refrain pages.
- On EACH of those pages you MUST:
    1. Set "contains_refrain": true
    2. Paste the refrain STRING verbatim (identical wording, punctuation, capitalisation) inside "text".
- All other pages: set "contains_refrain": false and do not include the refrain string.

HARD RULES (a deterministic gate checks these — failing any wastes the call):
1. pages array MUST have EXACTLY ${opts.target} items, numbered 1..${opts.target}.
2. Each page.text MUST be 15-30 words. Not 14, not 31. Count them.
3. The refrain STRING must appear verbatim (case/punctuation-insensitive) inside pages ${required.join(", ")}.
4. No empty pages, no "Page N" placeholders, no TBD/TODO/lorem.
5. Clear 4-act arc across ${opts.target} beats: setup (1-4), rising problem (5-14),
   climax/turning point (15-22), warm resolution (23-${opts.target}).
6. Hero solves the problem themselves — no adult swoops in.
7. Grade 1-2 vocabulary. Never mention brands, tech, violence, or scary imagery.
${priorRefrainBlock}${knownFailuresBlock}${violationsBlock}${partialRecoveryBlock}`;
}

export interface WriterParseDiagnostics {
  repairs: string[];
  errors: string[];
  raw_excerpt?: string;
  raw_model_output?: string;
  finish_reason?: string;
  output_tokens?: number;
  max_tokens?: number;
  provider_truncation?: boolean;
}

export interface WriterParseResult {
  ok: boolean;
  value: Record<string, unknown>;
  partial: boolean;
  diagnostics: WriterParseDiagnostics;
}

// Deterministic truncation classifier. Signals `provider_truncation` when the
// model completion was cut by the output-token cap. Combines signals to avoid
// false positives: finish_reason==='length' OR (mid-JSON tail AND near cap).
export function classifyProviderTruncation(
  raw: string,
  parseErrors: string[],
  finishReason?: string,
  outputTokens?: number,
  maxTokens?: number,
): boolean {
  if (finishReason && finishReason.toLowerCase() === "length") return true;
  const errText = parseErrors.join(" | ");
  const looksMidJson =
    /Unterminated string|Unexpected end of|Expected ',' or '}'|Expected ',' or '\]'/i.test(errText)
    || (raw.trim().length > 0 && !/[}\]]\s*$/.test(raw.trim()));
  const nearCap = typeof outputTokens === "number" && typeof maxTokens === "number" && maxTokens > 0
    && outputTokens >= Math.floor(maxTokens * 0.95);
  return looksMidJson && nearCap;
}

function stripCodeFence(raw: string, repairs: string[]): string {
  const trimmed = String(raw ?? "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    repairs.push("code_fence_stripped");
    return fenced[1].trim();
  }
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function extractOutermostJsonObject(text: string, repairs: string[]): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const out = text.slice(start, i + 1).trim();
        if (start > 0 || i < text.length - 1) repairs.push("outer_json_extracted");
        return out;
      }
    }
  }
  return null;
}

function repairJsonText(text: string, repairs: string[]): string {
  let repaired = text;
  const beforeCommas = repaired;
  repaired = repaired
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/("(?:\\.|[^"\\])*")\s+(?="[^"\\]*(?:\\.[^"\\]*)*"\s*:)/g, "$1,")
    .replace(/}\s*{/g, "},{")
    .replace(/]\s*(?="[^"\\]*(?:\\.[^"\\]*)*"\s*:)/g, "],")
    .replace(/}\s*(?="[^"\\]*(?:\\.[^"\\]*)*"\s*:)/g, "},");
  if (repaired !== beforeCommas) {
    if (beforeCommas.replace(/,\s*([}\]])/g, "$1") !== beforeCommas) repairs.push("trailing_comma_removed");
    if (/("(?:\\.|[^"\\])*")\s+(?="[^"\\]*(?:\\.[^"\\]*)*"\s*:)/.test(beforeCommas)) repairs.push("missing_comma_inserted");
  }
  return repaired;
}

function extractStringField(text: string, field: string): string {
  const rx = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const match = text.match(rx);
  if (!match) return "";
  try { return JSON.parse(`"${match[1]}"`); }
  catch { return match[1]; }
}

function completePageObjectsFromPagesArray(text: string): Record<string, unknown>[] {
  const pagesMatch = /"pages"\s*:\s*\[/i.exec(text);
  if (!pagesMatch) return [];
  const start = pagesMatch.index + pagesMatch[0].length;
  const objects: Record<string, unknown>[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objectStart >= 0) {
        try {
          const obj = JSON.parse(repairJsonText(text.slice(objectStart, i + 1), []));
          if (Number.isFinite(Number(obj?.page)) && typeof obj?.text === "string" && obj.text.trim()) objects.push(obj);
        } catch { /* ignore incomplete object */ }
        objectStart = -1;
      }
    } else if (ch === "]" && depth === 0) {
      break;
    }
  }
  return objects;
}

function hasNonEmptyPagesArray(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const pages = (value as { pages?: unknown }).pages;
  return Array.isArray(pages) && pages.length > 0;
}

export function parseSegmentedWriterOutput(raw: string): WriterParseResult {
  const repairs: string[] = [];
  const errors: string[] = [];
  const raw_model_output = String(raw ?? "");
  const raw_excerpt = raw_model_output.slice(0, 12_000);
  const cleaned = stripCodeFence(raw, repairs);
  const candidates = [cleaned];
  const outer = extractOutermostJsonObject(cleaned, repairs);
  if (outer && outer !== cleaned) candidates.push(outer);

  const diag = () => ({ repairs: [...new Set(repairs)], errors, raw_excerpt, raw_model_output });
  const EMPTY_ERR = "writer_output_missing_pages: parsed JSON has no non-empty `pages` array";

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (hasNonEmptyPagesArray(value)) return { ok: true, value, partial: false, diagnostics: diag() };
      errors.push(EMPTY_ERR);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }

    const repaired = repairJsonText(candidate, repairs);
    if (repaired !== candidate) {
      try {
        const value = JSON.parse(repaired);
        if (hasNonEmptyPagesArray(value)) return { ok: true, value, partial: false, diagnostics: diag() };
        errors.push(EMPTY_ERR);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  const salvageSource = outer ?? cleaned;
  const pages = completePageObjectsFromPagesArray(salvageSource);
  if (pages.length > 0) {
    repairs.push("complete_pages_salvaged");
    return {
      ok: true,
      value: {
        title: extractStringField(salvageSource, "title"),
        refrain: extractStringField(salvageSource, "refrain"),
        pages,
      },
      partial: true,
      diagnostics: diag(),
    };
  }

  if (!errors.includes(EMPTY_ERR)) errors.push(EMPTY_ERR);
  return { ok: false, value: {}, partial: false, diagnostics: diag() };
}

async function callWriter(
  system: string,
  user: string,
  model: string,
  timeoutMs: number,
  costCtx?: { ebookId?: string | null; ideaId?: string | null; step: string },
): Promise<WriterParseResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const MAX_TOKENS = 16000;
  // Lazy cost logger — never throws, always fire-and-forget.
  async function logIfPossible(input_tokens: number, output_tokens: number, provider: string, usedModel: string) {
    if (!costCtx) return;
    try {
      const { logAiCost, costDb } = await import("./cost-log.ts");
      logAiCost(costDb(), {
        ebook_id: costCtx.ebookId ?? null,
        idea_id: costCtx.ideaId ?? null,
        step: costCtx.step,
        model: usedModel,
        input_tokens, output_tokens,
        provider,
      });
    } catch (_e) { /* ignore */ }
  }
  try {
    const isGoogle = /^google\//i.test(model);
    // Tier 1: gemini-direct for google models.
    if (isGoogle) {
      try {
        const { geminiDirectChat, hasGeminiDirect } = await import("./gemini-direct.ts");
        if (hasGeminiDirect()) {
          const r = await geminiDirectChat({ system, user, model, responseJson: true });
          const parsed = parseSegmentedWriterOutput(r.text);
          parsed.diagnostics.finish_reason = "STOP";
          parsed.diagnostics.output_tokens = r.output_tokens;
          parsed.diagnostics.max_tokens = MAX_TOKENS;
          parsed.diagnostics.provider_truncation = classifyProviderTruncation(
            String(r.text ?? ""), parsed.diagnostics.errors, "STOP", r.output_tokens, MAX_TOKENS,
          );
          if (parsed.diagnostics.provider_truncation) {
            parsed.diagnostics.errors.push(`provider_truncation: out=${r.output_tokens}/${MAX_TOKENS}`);
          }
          void logIfPossible(r.input_tokens ?? 0, r.output_tokens ?? 0, "google_direct", model);
          return parsed;
        }
      } catch (e) {
        console.warn(`[kids-segments] google_direct writer failed, trying openai-direct: ${(e as Error).message}`);
      }
    }
    // Tier 2: openai-direct fallback (bypasses Lovable gateway credit pool).
    try {
      const { openaiDirectChat, hasOpenAIDirect } = await import("./openai-direct.ts");
      if (hasOpenAIDirect()) {
        const openaiModel = isGoogle ? (/pro/i.test(model) ? "openai/gpt-4o" : "openai/gpt-4o-mini") : model;
        const r = await openaiDirectChat({
          system, user, model: openaiModel, responseJson: true,
          maxTokens: MAX_TOKENS, timeoutMs,
        });
        const parsed = parseSegmentedWriterOutput(r.text);
        parsed.diagnostics.finish_reason = "STOP";
        parsed.diagnostics.output_tokens = r.output_tokens;
        parsed.diagnostics.max_tokens = MAX_TOKENS;
        parsed.diagnostics.provider_truncation = classifyProviderTruncation(
          String(r.text ?? ""), parsed.diagnostics.errors, "STOP", r.output_tokens, MAX_TOKENS,
        );
        if (parsed.diagnostics.provider_truncation) {
          parsed.diagnostics.errors.push(`provider_truncation: out=${r.output_tokens}/${MAX_TOKENS}`);
        }
        void logIfPossible(r.input_tokens ?? 0, r.output_tokens ?? 0, "openai_direct", openaiModel);
        return parsed;
      }
    } catch (e) {
      console.warn(`[kids-segments] openai-direct writer failed, falling back to gateway: ${(e as Error).message}`);
    }
    // Tier 3: Lovable Gateway.
    if (!LOVABLE_API_KEY) throw new Error("missing LOVABLE_API_KEY");
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) throw new Error(`writer ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    const raw = j.choices?.[0]?.message?.content ?? "";
    const finishReason = j.choices?.[0]?.finish_reason ?? undefined;
    const outputTokens = j.usage?.completion_tokens ?? j.usage?.output_tokens ?? undefined;
    const inputTokens = j.usage?.prompt_tokens ?? j.usage?.input_tokens ?? undefined;
    const parsed = parseSegmentedWriterOutput(raw);
    parsed.diagnostics.finish_reason = finishReason;
    parsed.diagnostics.output_tokens = outputTokens;
    parsed.diagnostics.max_tokens = MAX_TOKENS;
    parsed.diagnostics.provider_truncation = classifyProviderTruncation(
      String(raw ?? ""), parsed.diagnostics.errors, finishReason, outputTokens, MAX_TOKENS,
    );
    if (parsed.diagnostics.provider_truncation) {
      parsed.diagnostics.errors.push(
        `provider_truncation: finish_reason=${finishReason ?? "?"} output_tokens=${outputTokens ?? "?"}/${MAX_TOKENS}`,
      );
      console.warn(`[kids-segments] provider_truncation model=${model} finish=${finishReason} out=${outputTokens}/${MAX_TOKENS}`);
    }
    void logIfPossible(inputTokens ?? 0, outputTokens ?? 0, "gateway", model);
    return parsed;
  } finally { clearTimeout(t); }
}


function coerceSegmented(raw: Record<string, unknown>, opts: WriteSegmentsOpts): SegmentedManuscript {
  const pages = Array.isArray(raw.pages) ? (raw.pages as Array<Record<string, unknown>>) : [];
  return {
    title: String(raw.title ?? opts.title ?? ""),
    refrain: String(raw.refrain ?? "").trim(),
    target: opts.target,
    pages: pages.map((p, i) => ({
      page: Number(p?.page ?? i + 1),
      text: String(p?.text ?? "").trim(),
      contains_refrain: Boolean(p?.contains_refrain),
    })),
  };
}

export interface WriteSegmentsResult {
  ok: boolean;
  manuscript: SegmentedManuscript;
  validation: SegmentValidation;
  attempts: number;
  model: string;
  parseFailures?: WriterParseDiagnostics[];
}

function mergeRecoveredPages(base: SegmentedManuscript | null, next: SegmentedManuscript, opts: WriteSegmentsOpts): SegmentedManuscript {
  if (!base?.pages?.length) return next;
  const byPage = new Map<number, KidsSegment>();
  for (const p of base.pages) byPage.set(p.page, p);
  for (const p of next.pages) byPage.set(p.page, p);
  const pages = Array.from(byPage.values()).sort((a, b) => a.page - b.page);
  return {
    title: next.title || base.title || opts.title,
    refrain: next.refrain || base.refrain,
    target: opts.target,
    pages,
  };
}

function parseFailureViolations(parseFailures: WriterParseDiagnostics[]): string[] {
  const last = parseFailures.at(-1);
  if (!last) return [];
  const out = [
    `writer_json_malformation: return one valid JSON object only; parser errors were ${last.errors.slice(-2).join("; ")}`,
    "Do not include markdown fences, commentary, truncated arrays, or adjacent properties without commas.",
  ];
  if (last.provider_truncation) {
    out.push(
      `provider_truncation: previous response was cut off at the token cap (finish_reason=${last.finish_reason ?? "?"}, out=${last.output_tokens ?? "?"}/${last.max_tokens ?? "?"}). Keep each page.text tight (15-22 words), NO extra keys, NO comments — the JSON must fit within the token budget with all ${28} pages intact.`,
    );
  }
  return out;
}

export async function writeSegmentedManuscript(opts: WriteSegmentsOpts): Promise<WriteSegmentsResult> {
  const primary = opts.model ?? DEFAULT_MODEL;
  const fallback = "google/gemini-2.5-pro";  // stronger model for the last-chance rewrite
  const timeoutMs = opts.timeoutMs ?? 180_000;

  const parseFailures: WriterParseDiagnostics[] = [];
  let recovered: SegmentedManuscript | null = null;
  const costCtx = { ebookId: opts.ebookId ?? null, ideaId: opts.ideaId ?? null, step: "kids_manuscript_writer" };

  // Attempt 1 — primary model, fresh prompt.
  const raw1 = await callWriter(WRITER_SYSTEM, buildWriterUser(opts), primary, timeoutMs, costCtx);
  if (!raw1.ok || raw1.partial || raw1.diagnostics.errors.length > 0) parseFailures.push(raw1.diagnostics);
  let manuscript = raw1.ok ? coerceSegmented(raw1.value, opts) : coerceSegmented({}, opts);
  if (raw1.partial && manuscript.pages.length > 0) recovered = manuscript;
  let validation = validateSegments(manuscript, { target: opts.target });
  if (validation.ok) return { ok: true, manuscript, validation, attempts: 1, model: primary, parseFailures };
  console.warn(`[kids-segments] attempt 1 (${primary}) failed gate:\n- ${validation.violations.join("\n- ")}`);

  // Attempt 2 — same model, violations quoted back with fix demand.
  const raw2 = await callWriter(WRITER_SYSTEM, buildWriterUser(opts, [...parseFailureViolations(parseFailures), ...validation.violations], recovered?.pages, manuscript.refrain), primary, timeoutMs, costCtx);
  if (!raw2.ok || raw2.partial || raw2.diagnostics.errors.length > 0) parseFailures.push(raw2.diagnostics);
  manuscript = raw2.ok ? mergeRecoveredPages(recovered, coerceSegmented(raw2.value, opts), opts) : (recovered ?? coerceSegmented({}, opts));
  if (raw2.partial && manuscript.pages.length > 0) recovered = manuscript;
  validation = validateSegments(manuscript, { target: opts.target });
  if (validation.ok) return { ok: true, manuscript, validation, attempts: 2, model: primary, parseFailures };
  console.warn(`[kids-segments] attempt 2 (${primary}) failed gate:\n- ${validation.violations.join("\n- ")}`);

  // Attempt 3 — stronger model with all accumulated violations.
  const raw3 = await callWriter(WRITER_SYSTEM, buildWriterUser(opts, [...parseFailureViolations(parseFailures), ...validation.violations], recovered?.pages, manuscript.refrain), fallback, timeoutMs, costCtx);
  if (!raw3.ok || raw3.partial || raw3.diagnostics.errors.length > 0) parseFailures.push(raw3.diagnostics);
  manuscript = raw3.ok ? mergeRecoveredPages(recovered, coerceSegmented(raw3.value, opts), opts) : (recovered ?? coerceSegmented({}, opts));
  validation = validateSegments(manuscript, { target: opts.target });
  return { ok: validation.ok, manuscript, validation, attempts: 3, model: fallback, parseFailures };
}


