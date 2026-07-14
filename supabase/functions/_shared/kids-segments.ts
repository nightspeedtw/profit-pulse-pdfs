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

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

export interface KidsSegment {
  page: number;
  text: string;
}

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
  });

  const refrain = String(m?.refrain ?? "").trim();
  if (!refrain) {
    v.push(`refrain: missing — writer must define one short chantable line`);
  } else {
    const count = countRefrainOccurrences(pages, refrain);
    if (count < minRefrain) {
      v.push(`refrain "${refrain}" appears in ${count} pages (need ≥${minRefrain} verbatim)`);
    }
  }

  return { ok: v.length === 0, violations: v };
}

function countRefrainOccurrences(pages: KidsSegment[], refrain: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const n = norm(refrain);
  if (n.length < 3) return 0;
  let c = 0;
  for (const p of pages) if (norm(String(p.text ?? "")).includes(n)) c++;
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
}

const DEFAULT_MODEL = "google/gemini-2.5-flash";

const WRITER_SYSTEM = `You are a professional children's picture-book author writing for ages 4-7.

Follow the Children's Storybook Consistency Lock: warm read-aloud voice, sensory detail,
gentle rhythm, satisfying resolution, implicit moral (never a lecture). English only.

You MUST return valid JSON only — no markdown, no prose framing, no code fences.`;

function buildWriterUser(opts: WriteSegmentsOpts, extraViolations?: string[]): string {
  const violationsBlock = extraViolations?.length
    ? `\n\nPREVIOUS ATTEMPT FAILED THE DETERMINISTIC GATE. Fix EVERY violation below on this rewrite:\n- ${extraViolations.join("\n- ")}\n`
    : "";
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
  "refrain": "one short chantable line that will appear verbatim on ≥3 pages",
  "pages": [
    { "page": 1, "text": "15-30 words of read-aloud text for page 1" },
    { "page": 2, "text": "..." },
    ...
    { "page": ${opts.target}, "text": "..." }
  ]
}

HARD RULES (a deterministic gate checks these — failing any wastes the call):
1. pages array MUST have EXACTLY ${opts.target} items, numbered 1..${opts.target}.
2. Each page.text MUST be 15-30 words. Not 14, not 31. Count them.
3. The refrain string MUST appear verbatim (case/punctuation-insensitive) on AT LEAST 3 pages.
4. No empty pages, no "Page N" placeholders, no TBD/TODO/lorem.
5. Clear 4-act arc across ${opts.target} beats: setup (1-4), rising problem (5-14),
   climax/turning point (15-22), warm resolution (23-${opts.target}).
6. Hero solves the problem themselves — no adult swoops in.
7. Grade 1-2 vocabulary. Never mention brands, tech, violence, or scary imagery.
${violationsBlock}`;
}

async function callWriter(system: string, user: string, model: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) throw new Error(`writer ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    const raw = (j.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    try { return JSON.parse(raw) as Record<string, unknown>; }
    catch {
      const s = raw.indexOf("{"); const e = raw.lastIndexOf("}");
      if (s >= 0 && e > s) return JSON.parse(raw.slice(s, e + 1)) as Record<string, unknown>;
      throw new Error("writer_json_parse_failed");
    }
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
    })),
  };
}

export interface WriteSegmentsResult {
  ok: boolean;
  manuscript: SegmentedManuscript;
  validation: SegmentValidation;
  attempts: number;
  model: string;
}

export async function writeSegmentedManuscript(opts: WriteSegmentsOpts): Promise<WriteSegmentsResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? 180_000;

  // Attempt 1
  const raw1 = await callWriter(WRITER_SYSTEM, buildWriterUser(opts), model, timeoutMs);
  let manuscript = coerceSegmented(raw1, opts);
  let validation = validateSegments(manuscript, { target: opts.target });
  if (validation.ok) {
    return { ok: true, manuscript, validation, attempts: 1, model };
  }

  console.warn(`[kids-segments] attempt 1 failed gate:\n- ${validation.violations.join("\n- ")}`);

  // Attempt 2 — quote the violations back and demand fixes.
  const raw2 = await callWriter(WRITER_SYSTEM, buildWriterUser(opts, validation.violations), model, timeoutMs);
  manuscript = coerceSegmented(raw2, opts);
  validation = validateSegments(manuscript, { target: opts.target });
  return { ok: validation.ok, manuscript, validation, attempts: 2, model };
}
