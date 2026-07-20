// Story Batch V2 — Manuscript + Story Gate worker.
// One book per invocation. Cheap model only. Bounded to 1 revision.
// Advances stage: concept_generation → character_reference (on pass)
//                                    → failed (on hard fail after revision)

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  adminClient,
  assertBudget,
  AGE_BAND_CONTRACT,
  type AgeBand,
  BudgetCeilingError,
  chat,
  COST_ESTIMATE_CENTS,
  MODELS,
  recordCost,
  STORY_BATCH_V2_TAG,
} from "../_shared/story-batch-v2.ts";

const FROM_STAGE = "concept_generation";
const NEXT_STAGE = "character_reference";
const FAIL_STAGE = "failed";
const GATE_FLOOR = 85; // per-dimension floor
const OVERALL_FLOOR = 87;

interface BookRow {
  id: string;
  batch_id: string;
  age_band: AgeBand;
  title: string;
  subtitle: string | null;
  hook: string | null;
  synopsis: string | null;
  protagonist: string | null;
  setting: string | null;
  theme: string | null;
  parent_value: string | null;
  differentiation_note: string | null;
  stage: string;
}

function buildStoryPrompt(book: BookRow) {
  const contract = AGE_BAND_CONTRACT[book.age_band];
  return `You are a master picture-book author writing a saleable illustrated storybook.

BOOK CONCEPT
- Title: ${book.title}
- Subtitle: ${book.subtitle ?? "(none)"}
- Age band: ${book.age_band}
- Hook: ${book.hook ?? "(inferred from title)"}
- Synopsis: ${book.synopsis ?? "(inferred)"}
- Protagonist: ${book.protagonist ?? "(you choose, consistent)"}
- Setting: ${book.setting ?? "(you choose)"}
- Theme / parent value: ${book.theme ?? ""} | ${book.parent_value ?? ""}
- Differentiator: ${book.differentiation_note ?? ""}

CONTRACT (non-negotiable)
- Story pages: exactly ${contract.storyPages}
- Words per page: ${contract.wordsPerPage[0]}–${contract.wordsPerPage[1]}
- Tone: ${contract.tone}
- No copyrighted IP. No violence, no explicit content. No brand names.
- Every page must earn a page turn. No filler. No preachy narration.
- Protagonist name is consistent every page. Setting is coherent.

OUTPUT — return STRICT JSON, no prose outside JSON:
{
  "story_bible": {
    "logline": "one sentence",
    "protagonist": { "name": "...", "traits": ["..."], "visual_anchor": "..." },
    "world": "1-2 sentences",
    "want": "...", "obstacle": "...", "climax": "...", "resolution": "...",
    "themes": ["..."]
  },
  "page_plan": [
    { "page": 1, "beat": "opening/inciting/rising/midpoint/climax/resolution", "scene": "visual scene description", "emotional_beat": "..." }
    // exactly ${contract.storyPages} entries
  ],
  "manuscript": [
    { "page": 1, "text": "page text within word range" }
    // exactly ${contract.storyPages} entries, indices aligned with page_plan
  ]
}`;
}

function buildJudgePrompt(book: BookRow, payload: unknown) {
  const contract = AGE_BAND_CONTRACT[book.age_band];
  return `You are a strict children's book acquisitions editor. Score this manuscript on the SecretPDF rubric. Never give inflated scores.

TARGET: age ${book.age_band}, ${contract.storyPages} story pages, ${contract.wordsPerPage[0]}–${contract.wordsPerPage[1]} words per page.

MATERIAL:
${JSON.stringify(payload).slice(0, 12000)}

Score each dimension 0–100. Return STRICT JSON:
{
  "dimensions": {
    "narrative_arc": {"score": 0, "why": "..."},
    "age_fit": {"score": 0, "why": "..."},
    "voice_and_language": {"score": 0, "why": "..."},
    "page_turn_engineering": {"score": 0, "why": "..."},
    "originality": {"score": 0, "why": "..."},
    "visualizability": {"score": 0, "why": "..."},
    "commercial_appeal": {"score": 0, "why": "..."}
  },
  "overall": 0,
  "hard_failures": ["exact-page count wrong", "copyright IP", ...],
  "top_fix": "single most impactful revision instruction"
}`;
}

interface StoryPayload {
  story_bible: Record<string, unknown>;
  page_plan: Array<{ page: number; beat: string; scene: string; emotional_beat?: string }>;
  manuscript: Array<{ page: number; text: string }>;
}

function validateShape(p: unknown, expectedPages: number): { ok: boolean; reason?: string } {
  const x = p as StoryPayload;
  if (!x || typeof x !== "object") return { ok: false, reason: "not_object" };
  if (!x.story_bible) return { ok: false, reason: "missing_story_bible" };
  if (!Array.isArray(x.page_plan) || x.page_plan.length !== expectedPages)
    return { ok: false, reason: `page_plan_len=${x.page_plan?.length ?? 0} want=${expectedPages}` };
  if (!Array.isArray(x.manuscript) || x.manuscript.length !== expectedPages)
    return { ok: false, reason: `manuscript_len=${x.manuscript?.length ?? 0} want=${expectedPages}` };
  return { ok: true };
}

interface JudgeResult {
  dimensions: Record<string, { score: number; why: string }>;
  overall: number;
  hard_failures?: string[];
  top_fix?: string;
}

function passesGate(j: JudgeResult): { pass: boolean; reason?: string } {
  if (j.hard_failures && j.hard_failures.length > 0)
    return { pass: false, reason: `hard_fail:${j.hard_failures.join("|")}` };
  for (const [dim, v] of Object.entries(j.dimensions ?? {})) {
    if ((v?.score ?? 0) < GATE_FLOOR) return { pass: false, reason: `dim:${dim}=${v?.score}` };
  }
  if ((j.overall ?? 0) < OVERALL_FLOOR)
    return { pass: false, reason: `overall=${j.overall}<${OVERALL_FLOOR}` };
  return { pass: true };
}

async function runOnce(book: BookRow, priorFix?: string) {
  const contract = AGE_BAND_CONTRACT[book.age_band];
  const model = MODELS.cheapText;

  // Draft
  const draftUser = priorFix
    ? `${buildStoryPrompt(book)}\n\nREVISION INSTRUCTION (from editor): ${priorFix}\nAddress it directly.`
    : buildStoryPrompt(book);

  const draft = await chat({ model, user: draftUser, json: true, temperature: 0.85 });
  await recordCost({
    batchId: book.batch_id,
    bookId: book.id,
    provider: "lovable_ai",
    model,
    kind: "text",
    costCents: COST_ESTIMATE_CENTS.story_bible + COST_ESTIMATE_CENTS.manuscript_page * contract.storyPages,
    meta: { step: "manuscript_draft", revision: !!priorFix },
  });

  const shape = validateShape(draft.parsed, contract.storyPages);
  if (!shape.ok) {
    return { ok: false as const, reason: `shape:${shape.reason}`, payload: null, judge: null };
  }
  const payload = draft.parsed as StoryPayload;

  // Judge
  const judgeRes = await chat({
    model,
    user: buildJudgePrompt(book, payload),
    json: true,
    temperature: 0.2,
  });
  await recordCost({
    batchId: book.batch_id,
    bookId: book.id,
    provider: "lovable_ai",
    model,
    kind: "text",
    costCents: 3,
    meta: { step: "story_gate_judge", revision: !!priorFix },
  });

  const judge = judgeRes.parsed as JudgeResult;
  const verdict = passesGate(judge);
  return { ok: verdict.pass, reason: verdict.reason, payload, judge };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { book_id } = await req.json().catch(() => ({}));
    if (!book_id) {
      return new Response(JSON.stringify({ error: "book_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = adminClient();
    const { data: book, error: bErr } = await supa
      .from("story_batch_v2_books")
      .select(
        "id,batch_id,age_band,title,subtitle,hook,synopsis,protagonist,setting,theme,parent_value,differentiation_note,stage",
      )
      .eq("id", book_id)
      .single();
    if (bErr || !book) throw new Error(`book not found: ${book_id}`);
    if (book.stage !== FROM_STAGE) {
      return new Response(
        JSON.stringify({ skipped: true, reason: `stage=${book.stage} want=${FROM_STAGE}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Budget guard: reserve room for draft + judge + one revision
    const contract = AGE_BAND_CONTRACT[book.age_band as AgeBand];
    const estimate = 2 * (COST_ESTIMATE_CENTS.story_bible +
      COST_ESTIMATE_CENTS.manuscript_page * contract.storyPages + 3);
    await assertBudget(book.batch_id, estimate);

    console.log(STORY_BATCH_V2_TAG, "manuscript.start", { book_id, title: book.title, age: book.age_band });

    // Attempt 1
    let result = await runOnce(book as BookRow);
    let attempts = 1;

    // Bounded revision (only if shape ok and judge available)
    if (!result.ok && result.judge?.top_fix) {
      console.log(STORY_BATCH_V2_TAG, "manuscript.revise", { book_id, reason: result.reason });
      const revised = await runOnce(book as BookRow, result.judge.top_fix);
      attempts = 2;
      // Keep whichever passes / has higher overall
      const prev = result.judge?.overall ?? 0;
      const next = revised.judge?.overall ?? 0;
      result = revised.ok || next > prev ? revised : result;
    }

    if (!result.ok || !result.payload) {
      await supa
        .from("story_batch_v2_books")
        .update({
          stage: FAIL_STAGE,
          stage_updated_at: new Date().toISOString(),
          stage_attempt_count: attempts,
          last_error: `story_gate_failed:${result.reason ?? "unknown"}`,
          story_gate_score: result.judge ?? null,
        })
        .eq("id", book_id);

      await supa.from("story_batch_v2_qc_findings").insert({
        book_id,
        gate: "story_gate",
        severity: "hard_fail",
        code: "story_gate_failed",
        message: result.reason ?? "story_gate_failed",
        detail: result.judge ?? null,
      });

      return new Response(
        JSON.stringify({ ok: false, stage: FAIL_STAGE, reason: result.reason, attempts }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const manuscript_md = result.payload.manuscript
      .map((p) => `## Page ${p.page}\n\n${p.text}`)
      .join("\n\n");

    await supa
      .from("story_batch_v2_books")
      .update({
        stage: NEXT_STAGE,
        stage_updated_at: new Date().toISOString(),
        stage_attempt_count: attempts,
        last_error: null,
        story_bible: result.payload.story_bible,
        page_plan: result.payload.page_plan,
        manuscript_md,
        story_gate_score: result.judge,
      })
      .eq("id", book_id);

    console.log(STORY_BATCH_V2_TAG, "manuscript.pass", {
      book_id,
      attempts,
      overall: result.judge?.overall,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        stage: NEXT_STAGE,
        attempts,
        overall: result.judge?.overall,
        pages: result.payload.manuscript.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e instanceof BudgetCeilingError ? 402 : 500;
    console.error(STORY_BATCH_V2_TAG, "manuscript.error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
