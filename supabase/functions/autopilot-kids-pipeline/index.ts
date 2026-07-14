import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { falFluxSchnell, falRecraftV3 } from '../_shared/fal.ts';
import { pickStyle, markStyleUsed } from '../_shared/style-picker.ts';
import { buildScenePlan } from '../_shared/kids-interior.ts';
// PDF assembly is delegated to the multi-stage `kids-build-picture-pdf`
// worker — no direct pdf-lib import needed here.

import { runKidsStoryJudge } from '../_shared/kids-story-judge.ts';
import { detectBibleStoryMismatch, detectMetadataStoryMismatch, METADATA_STORY_MISMATCH } from '../_shared/bible-story-mismatch.ts';
import { writeSegmentedManuscript, renderSegmentsToMd, loadSegments, segmentsToPageTexts } from '../_shared/kids-segments.ts';
import { loadStoryCraftBlock } from '../_shared/story-craft-skill.ts';
import { renderKidsTitleTreatment } from '../_shared/covers/kids-title-treatment.ts';
import { uploadAndSignImage, versionedKidsAssetPath } from '../_shared/versioned-assets.ts';
import { computeLuminance } from '../_shared/image-luminance.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

// Sentinel error that the pipeline loop recognizes to short-circuit before art.
const STORY_GATE_BLOCK = 'STORY_GATE_BLOCK';
// Sentinel: interior rendering is running asynchronously in kids-render-interior.
// Not a failure — the run pauses and the render function resumes it via
// force_finish when all pages are written.
const INTERIOR_STAGED = 'INTERIOR_STAGED';

const MIN_INTERIOR = 12;
const TARGET_INTERIOR = 28;
const MIN_PREVIEWS = 3;


type StepResult = { output: Record<string, unknown>; fallbackUsed?: boolean };
type Step = {
  name: string;
  label: string;
  critical?: boolean;
  run: (ctx: Ctx) => Promise<StepResult>;
};
type Ctx = { supabase: ReturnType<typeof createClient>; ebookId: string; ebook: Record<string, unknown>; runId?: string };

const STEPS: Step[] = [
  { name: 'generate_idea', label: 'Generate story idea', critical: true, run: generateIdea },
  { name: 'generate_manuscript', label: 'Write manuscript', critical: true, run: generateManuscript },
  { name: 'story_gate', label: 'Story judge gate (before art)', critical: true, run: storyGate },
  { name: 'metadata_gate', label: 'Metadata/manuscript alignment gate', critical: true, run: metadataGate },
  { name: 'bible_check', label: 'Bible/story hero match check', critical: true, run: bibleCheck },
  { name: 'generate_cover', label: 'Design cover', run: generateCover },
  { name: 'generate_style_bible', label: 'Lock style bible', critical: true, run: generateStyleBible },
  { name: 'generate_interior', label: 'Illustrate interior', critical: true, run: generateInterior },
  { name: 'generate_thumbnail', label: 'Store thumbnail', run: generateThumbnail },
  { name: 'generate_previews', label: 'Preview pages', run: generatePreviews },
  { name: 'dispatch_pdf_qc_publish', label: 'Dispatch multi-stage PDF → QC → publish', critical: true, run: dispatchPdfQcPublish },
];


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { run_id, force_finish } = await req.json();
    if (!run_id) return json({ error: 'run_id required' }, 400);

    const { data: run, error: runErr } = await supabase
      .from('autopilot_kids_runs')
      .select('id, ebook_kids_id, status')
      .eq('id', run_id)
      .single();
    if (runErr || !run) return json({ error: 'run not found' }, 404);
    if (!run.ebook_kids_id) return json({ error: 'no ebook_kids_id' }, 400);

    // If forcing finish, look up already-completed steps to skip.
    let doneSteps = new Set<string>();
    if (force_finish) {
      const { data: prior } = await supabase
        .from('autopilot_kids_steps')
        .select('step_name, status')
        .eq('run_id', run_id);
      doneSteps = new Set((prior ?? []).filter(s => s.status === 'completed' || s.status === 'completed_with_fallback').map(s => s.step_name));
    }

    await supabase.from('autopilot_kids_runs').update({
      status: 'running',
      started_at: new Date().toISOString(),
      blocker_reason: null,
    }).eq('id', run_id);

    const { data: ebook } = await supabase.from('ebooks_kids').select('*').eq('id', run.ebook_kids_id).single();
    const ctx: Ctx = { supabase, ebookId: run.ebook_kids_id as string, ebook: ebook ?? {}, runId: run_id };

    const criticalFailures: string[] = [];
    const softFailures: string[] = [];

    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i];
      const pct = Math.round(((i + 1) / STEPS.length) * 100);
      await supabase.from('autopilot_kids_runs').update({
        current_step: step.name,
        current_step_label: step.label,
        progress_percent: pct,
      }).eq('id', run_id);

      if (doneSteps.has(step.name)) {
        console.log(`skip already-done step ${step.name}`);
        continue;
      }

      const stepStart = Date.now();
      const { data: stepRow } = await supabase.from('autopilot_kids_steps').insert({
        run_id, step_name: step.name, step_label: step.label,
        status: 'running', started_at: new Date().toISOString(),
      }).select('id').single();

      // reload ebook state between steps
      const { data: fresh } = await supabase.from('ebooks_kids').select('*').eq('id', ctx.ebookId).single();
      if (fresh) ctx.ebook = fresh;

      let outcome: { status: string; output: Record<string, unknown>; error?: string };
      try {
        const result = await withRetry(() => step.run(ctx), 3);
        outcome = {
          status: result.fallbackUsed ? 'completed_with_fallback' : 'completed',
          output: result.output,
        };
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        // Not a failure — interior render is running asynchronously and will
        // resume this run via force_finish when all pages exist.
        if (msg.includes(INTERIOR_STAGED)) {
          console.log(`step ${step.name} → interior render dispatched, pausing run`);
          outcome = { status: 'in_progress', output: { staged: true, reason: 'interior render dispatched' } };
          await supabase.from('autopilot_kids_steps').update({
            status: 'in_progress',
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - stepStart,
            output: outcome.output,
          }).eq('id', stepRow!.id);
          await supabase.from('autopilot_kids_runs').update({
            status: 'waiting_for_interior',
            blocker_reason: null,
          }).eq('id', run_id);
          return json({ ok: true, ebook_id: ctx.ebookId, status: 'waiting_for_interior', staged: true });
        }
        console.error(`step ${step.name} unrecoverable`, msg);
        outcome = { status: 'failed', output: {}, error: msg };
        if (step.critical) criticalFailures.push(`${step.name}: ${msg}`);
        else softFailures.push(`${step.name}: ${msg}`);
      }

      await supabase.from('autopilot_kids_steps').update({
        status: outcome.status,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - stepStart,
        output: outcome.output,
        error_message: outcome.error ?? null,
      }).eq('id', stepRow!.id);

      // Hard stop: if the story-gate step failed, do NOT run any art/PDF/QC/publish steps.
      // Fire the repair-story-gate function (fire-and-forget). It will loop the
      // reviser up to MAX_ATTEMPTS; on success it resumes this pipeline
      // (force_finish=true) — on exhaustion it sets pipeline_status='retired'
      // so the parent one-click loop rotates to a fresh concept. Autopilot must
      // NEVER rest in human_review_required (owner rule).
      if (step.name === 'story_gate' && outcome.status === 'failed') {
        await supabase.from('ebooks_kids').update({
          listing_status: 'draft',
          status: 'needs_revision',
          pipeline_status: 'story_gate_repairing',
          blocker_reason: `story_gate_failed: ${(outcome.error ?? 'unknown').slice(0, 200)}`,
        }).eq('id', ctx.ebookId);
        console.log(`story_gate failed; dispatching kids-repair-story-gate for ${ctx.ebookId}`);
        fetch(`${SUPABASE_URL}/functions/v1/kids-repair-story-gate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ ebook_id: ctx.ebookId, run_id: ctx.runId, resume_pipeline: true }),
        }).catch(e => console.error('repair-story-gate dispatch failed', e));
        break;
      }

      // Hard stop: bible/story or metadata/story mismatch means any downstream
      // art would use the wrong character/premise. Retire directly so the
      // parent one-click loop rotates to a fresh concept (never dead-end).
      if ((step.name === 'bible_check' || step.name === 'metadata_gate') && outcome.status === 'failed') {
        await supabase.from('ebooks_kids').update({
          listing_status: 'draft',
          status: 'needs_revision',
          pipeline_status: 'retired',
          blocker_reason: `auto_retired_for_fresh_concept: ${step.name}_failed: ${(outcome.error ?? (step.name === 'metadata_gate' ? METADATA_STORY_MISMATCH : 'BIBLE_STORY_MISMATCH')).slice(0, 180)}`,
          human_review_reason: outcome.error ?? (step.name === 'metadata_gate' ? METADATA_STORY_MISMATCH : 'BIBLE_STORY_MISMATCH'),
        }).eq('id', ctx.ebookId);
        console.log(`${step.name} blocked pipeline: ${outcome.error}`);
        break;
      }

      // Never break the loop for other steps — keep pushing forward. Later steps decide what to do given prior state.
    }


    const finalStatus = criticalFailures.length > 0 ? 'failed' : 'completed';
    const blocker = criticalFailures.length > 0
      ? criticalFailures.join(' | ')
      : (softFailures.length > 0 ? `soft: ${softFailures.join(' | ')}` : null);

    await supabase.from('autopilot_kids_runs').update({
      status: finalStatus,
      progress_percent: 100,
      completed_at: new Date().toISOString(),
      blocker_reason: blocker,
    }).eq('id', run_id);

    return json({ ok: true, ebook_id: ctx.ebookId, status: finalStatus, soft_failures: softFailures });
  } catch (e) {
    console.error('pipeline error', e);
    return json({ ok: false, error: String(e) }, 500);
  }
});

async function withRetry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String((e as Error)?.message ?? e).toLowerCase();
      const transient = /no image|429|5\d\d|fetch failed|timeout|network|econn|temporar/.test(msg);
      if (!transient || i === attempts - 1) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function callAI(prompt: string, system: string): Promise<string> {
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'system', content: `${system}\n\nCRITICAL: Respond in English only. Never use Thai or any other language.` }, { role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? '';
}

async function generateIdea(ctx: Ctx): Promise<StepResult> {
  // If title already exists (force_finish scenario), skip.
  if (ctx.ebook.title && ctx.ebook.description) {
    return { output: { skipped: true, reason: 'idea already present' } };
  }
  const { data: age } = await ctx.supabase.from('kids_age_groups').select('label_en, min_age, max_age')
    .eq('id', ctx.ebook.age_group_id).maybeSingle();
  const themeIds = (ctx.ebook.theme_ids as string[]) ?? [];
  const { data: themes } = await ctx.supabase.from('kids_themes').select('label_en').in('id', themeIds);
  const themeStr = (themes ?? []).map(t => t.label_en).join(', ') || 'general';
  const ageStr = age ? `${age.min_age}-${age.max_age} (${age.label_en})` : 'children';

  const text = await callAI(
    `Give me one original children's book concept for ages ${ageStr}, theme: ${themeStr}. Reply as JSON only: {"title":"","subtitle":"","description":"","main_character":""}. English only.`,
    'You are a children\'s book concept designer. Reply with JSON only, no markdown fences.'
  );
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const parsed = JSON.parse(cleaned);
  await ctx.supabase.from('ebooks_kids').update({
    title: parsed.title, subtitle: parsed.subtitle, description: parsed.description,
    storefront_title: parsed.title, storefront_subtitle: parsed.subtitle,
    storefront_meta: { main_character: parsed.main_character },
    status: 'writing', pipeline_status: 'writing',
  }).eq('id', ctx.ebookId);
  return { output: parsed };
}

async function generateManuscript(ctx: Ctx): Promise<StepResult> {
  const existingSeg = loadSegments(ctx.ebook);
  if (existingSeg && existingSeg.pages.length === TARGET_INTERIOR && ctx.ebook.manuscript_md) {
    return { output: { skipped: true, reason: 'segments already present' } };
  }

  const ageBand = (ctx.ebook.storefront_meta as { admin_params?: { age_band?: string } } | null)?.admin_params?.age_band ?? '4-6';
  const craft = await loadStoryCraftBlock(ctx.supabase, ageBand);
  const meta = (ctx.ebook.storefront_meta ?? {}) as Record<string, unknown>;
  const heroName = (meta.main_character as string | undefined)
    ?? ((meta.locked_concept as { hero?: string } | undefined)?.hero)
    ?? null;

  const result = await writeSegmentedManuscript({
    title: String(ctx.ebook.title ?? ''),
    subtitle: (ctx.ebook.subtitle as string | null) ?? null,
    description: (ctx.ebook.description as string | null) ?? null,
    ageBand,
    target: TARGET_INTERIOR,
    heroName,
    extraCraftBlock: craft,
  });

  if (!result.ok) {
    throw new Error(`segmented_writer_gate_failed: ${result.validation.violations.slice(0, 6).join(' | ')}`);
  }

  const md = renderSegmentsToMd(result.manuscript);
  const wordCount = result.manuscript.pages.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0);

  const nextMeta = { ...meta, kids_manuscript_segments: result.manuscript };
  await ctx.supabase.from('ebooks_kids').update({
    manuscript_md: md,
    word_count: wordCount,
    storefront_meta: nextMeta,
    status: 'illustrating',
    pipeline_status: 'illustrating',
  }).eq('id', ctx.ebookId);
  ctx.ebook.manuscript_md = md;
  ctx.ebook.storefront_meta = nextMeta;
  return { output: { word_count: wordCount, segments: result.manuscript.pages.length, attempts: result.attempts, refrain: result.manuscript.refrain } };
}

// Story gate — runs BEFORE any art/PDF step so baseline never spends image cost on a rejected story.
// Throws when the strict story judge does not pass; the pipeline loop then short-circuits.
async function storyGate(ctx: Ctx): Promise<StepResult> {
  const manuscript = String(ctx.ebook.manuscript_md ?? '').trim();
  if (!manuscript) throw new Error(`${STORY_GATE_BLOCK}: manuscript missing`);
  const ageBand = (ctx.ebook.storefront_meta as { admin_params?: { age_band?: string } } | null)?.admin_params?.age_band ?? '4-6';
  const segs = loadSegments(ctx.ebook);
  const sb = (ctx.ebook.story_bible ?? {}) as { spreads?: Array<{ text?: string }> };
  const pageTexts = segs
    ? segmentsToPageTexts(segs)
    : (Array.isArray(sb.spreads) ? sb.spreads.map((s) => String(s?.text ?? '')) : []);

  const report = await runKidsStoryJudge({
    title: String(ctx.ebook.title ?? ''),
    subtitle: (ctx.ebook.subtitle as string | null) ?? null,
    ageBand,
    manuscript_md: manuscript,
    page_texts: pageTexts,
    ebook_id: ctx.ebook.id as string,
  });

  // Persist scorecard even on pass so the admin UI can display subscores.
  const sc = (ctx.ebook.qc_scorecard ?? {}) as Record<string, unknown>;
  sc.story_gate = {
    passed: report.story_qc_passed,
    scores: {
      age: report.age_appropriateness_score,
      coh: report.story_coherence_score,
      emo: report.emotional_payoff_score,
      rer: report.reread_value_score,
      lang: report.language_level_score,
      buyer: report.parent_buyer_value_score,
      generic_risk: report.generic_story_risk_score,
    },
    subscores: {
      premise_specificity: report.premise_specificity_score,
      story_engine_specificity: report.story_engine_specificity_score,
      visual_hook_specificity: report.visual_hook_specificity_score,
      retitle_resistance: report.retitle_resistance_score,
      trope_dependency: report.trope_dependency_score,
    },
    generic_risk_analysis: report.generic_risk_analysis,
    evidence: report.evidence,
    judge_version: report.judge_version,
    computed_at: report.computed_at,
  };
  await ctx.supabase.from('ebooks_kids').update({ qc_scorecard: sc }).eq('id', ctx.ebookId);

  if (!report.story_qc_passed) {
    const blockers: string[] = [];
    if (report.age_appropriateness_score < 90) blockers.push(`age=${report.age_appropriateness_score}<90`);
    if (report.story_coherence_score < 90) blockers.push(`coh=${report.story_coherence_score}<90`);
    if (report.emotional_payoff_score < 85) blockers.push(`emo=${report.emotional_payoff_score}<85`);
    if (report.reread_value_score < 85) blockers.push(`rer=${report.reread_value_score}<85`);
    if (report.language_level_score < 90) blockers.push(`lang=${report.language_level_score}<90`);
    if (report.parent_buyer_value_score < 85) blockers.push(`buyer=${report.parent_buyer_value_score}<85`);
    if (report.generic_story_risk_score > 25) blockers.push(`generic_risk=${report.generic_story_risk_score}>25`);
    throw new Error(`${STORY_GATE_BLOCK}: ${blockers.join(', ')}`);
  }
  return { output: { passed: true, generic_risk: report.generic_story_risk_score, subscores: sc.story_gate } };
}

// Metadata/manuscript alignment guardrail. Runs BEFORE bible_check so that
// stale title/description (left over from a prior book or a superseded
// storyline) cannot seed the character bible with the wrong hero. If the
// mismatch is safe to auto-repair (manuscript has a clear hero + terms), we
// regenerate title/description from the manuscript in-place and let the
// pipeline continue. If unsafe, we hard-fail so a human can intervene.
async function metadataGate(ctx: Ctx): Promise<StepResult> {
  const db = ctx.supabase;
  const manuscript = String(ctx.ebook.manuscript_md ?? '').trim();
  if (!manuscript) {
    // Nothing to compare against; skip. bible_check will still guard.
    return { output: { skipped: true, reason: 'no manuscript' } };
  }
  const report = detectMetadataStoryMismatch({
    manuscript,
    title: (ctx.ebook.title as string | null) ?? null,
    description: (ctx.ebook.description as string | null) ?? null,
    storefrontMeta: (ctx.ebook.storefront_meta as Record<string, unknown> | null) ?? null,
  });
  if (!report.mismatch) {
    return { output: { ok: true, ...report } };
  }
  if (report.repair_action === 'hard_block') {
    throw new Error(`${METADATA_STORY_MISMATCH}: ${report.reason}`);
  }
  // Safe auto-sync: regenerate title/description from the manuscript so the
  // downstream bible prompt sees aligned inputs.
  console.warn(`metadata_gate auto-sync: ${report.reason}`);
  try {
    const sysMsg = "You are a picture-book editor. English only. JSON only, no markdown. The hero name MUST appear verbatim in the manuscript.";
    const userMsg = `Read this manuscript and produce aligned commercial metadata.\n\nMANUSCRIPT:\n"""\n${manuscript.slice(0, 4000)}\n"""\n\nReturn JSON exactly: {"title":"","subtitle":"","description":"","hero_name":""}`;
    const raw = await callAI(userMsg, sysMsg);
    const meta = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()) as Record<string, string>;
    const hero = String(meta.hero_name ?? '').trim();
    if (!hero || !new RegExp(`\\b${hero.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i').test(manuscript)) {
      throw new Error(`${METADATA_STORY_MISMATCH}: auto-sync produced hero "${hero}" not in manuscript`);
    }
    const existingMeta = (ctx.ebook.storefront_meta ?? {}) as Record<string, unknown>;
    await db.from('ebooks_kids').update({
      title: String(meta.title ?? '').trim() || (ctx.ebook.title as string) || 'Untitled',
      subtitle: (String(meta.subtitle ?? '').trim() || null),
      description: String(meta.description ?? '').trim() || (ctx.ebook.description as string) || '',
      storefront_meta: {
        ...existingMeta,
        hero_name: hero,
        metadata_synced_from_manuscript: true,
        metadata_synced_at: new Date().toISOString(),
      },
    }).eq('id', ctx.ebookId);
    // Reload ebook so next step sees synced state.
    const { data: fresh } = await db.from('ebooks_kids').select('*').eq('id', ctx.ebookId).single();
    if (fresh) ctx.ebook = fresh;
    return { output: { ok: true, auto_synced: true, new_title: meta.title, hero, ...report }, fallbackUsed: true };
  } catch (e) {
    throw new Error(`${METADATA_STORY_MISMATCH}: auto-sync failed: ${(e as Error).message}`);
  }
}

// Bible/story hero-match guardrail. Runs after the story judge and BEFORE any
// art step. If the existing kids_book_bibles row locks a character that does
// not appear in the current manuscript (e.g. stale "Luna/bear cub" bible on a
// "Tali/kid inventor" story), we auto-wipe the stale bible + cover so the
// downstream cover step rebuilds from the current story. If a stale bible is
// wiped we still let the pipeline continue; if the manuscript itself is
// missing a namable hero AND a bible already exists, we hard-block so a human
// can decide.
async function bibleCheck(ctx: Ctx): Promise<StepResult> {
  const db = ctx.supabase;
  const manuscript = String(ctx.ebook.manuscript_md ?? '').trim();
  const storyBible = (ctx.ebook.story_bible ?? null) as Record<string, unknown> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bible } = await (db.from('kids_book_bibles') as any)
    .select('*').eq('ebook_id', ctx.ebookId).maybeSingle();

  const characterBible = (bible?.character_bible_json ?? null) as Record<string, unknown> | null;
  const report = detectBibleStoryMismatch({
    manuscript,
    title: (ctx.ebook.title as string) ?? null,
    storyBible,
    characterBible,
  });

  if (!report.mismatch) {
    return { output: { ok: true, ...report } };
  }

  // Mismatch found. Auto-repair: wipe stale bible + cover + any stale art so
  // downstream steps rebuild from the correct manuscript. Do NOT hard-fail —
  // the wipe means the next cover step will regenerate the right character.
  console.warn(`bible_check auto-wipe: ${report.reason}`);
  if (bible) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.from('kids_book_bibles') as any).update({
      character_bible_json: {},
      style_bible_json: {},
      character_reference_image_url: null,
      cover_master_url: null,
      locked_at: null,
    }).eq('ebook_id', ctx.ebookId);
  }
  await db.from('ebooks_kids').update({
    cover_url: null,
    thumbnail_url: null,
    pdf_url: null,
    interior_illustrations: [],
    preview_page_urls: [],
    style_bible_json: null,
  }).eq('id', ctx.ebookId);
  // Reload ebook so the very next step sees the wiped state.
  const { data: fresh } = await db.from('ebooks_kids').select('*').eq('id', ctx.ebookId).single();
  if (fresh) ctx.ebook = fresh;
  return {
    output: { ok: true, auto_wiped: true, reason: report.reason, ...report },
    fallbackUsed: true,
  };
}

async function generateCover(ctx: Ctx): Promise<StepResult> {
  // 1. Pick / load style preset (auto-rotate across pool)
  // 2. Build character bible via AI
  // 3. Generate character reference sheet with Fal Flux Schnell (fast, cheap)
  // 4. Generate final cover with Fal Recraft V3 using ref image (i2i for consistency)
  const db = ctx.supabase;

  // Load or create bible row
  const { data: existingBible } = await db.from('kids_book_bibles')
    .select('*').eq('ebook_id', ctx.ebookId).maybeSingle();

  let bible = existingBible as Record<string, unknown> | null;

  // Ensure a bible with character_bible_json exists. If a row exists but the
  // JSON is empty (partial prior run), fill it in place instead of crashing.
  const bibleNeedsChar = !bible || !bible.character_bible_json || Object.keys((bible.character_bible_json as Record<string, unknown>) ?? {}).length === 0;
  if (bibleNeedsChar) {
    const style = await pickStyle(db);
    // IMPORTANT: seed the character bible from the actual MANUSCRIPT, not from
    // ctx.ebook.title / description. Repair passes rewrite manuscript_md but
    // may leave stale title/description behind, which previously caused the
    // bible to lock the wrong hero (e.g. "Barnaby Bear" for a Tali story).
    const manuscriptExcerpt = String(ctx.ebook.manuscript_md ?? '').slice(0, 2000);
    const bibleText = await callAI(
      `Create a character bible JSON for the HERO of the following children's picture book MANUSCRIPT. The hero MUST be the character who is actually named and acts throughout the manuscript text below — do NOT invent a new hero from the title or description. Use the exact hero name that appears in the manuscript.

MANUSCRIPT:
"""
${manuscriptExcerpt}
"""

Title (for context only, may be stale): ${ctx.ebook.title}
Description (for context only, may be stale): ${ctx.ebook.description}

Reply as JSON only: {"name":"","species":"","age":"","hair":"","eyes":"","skin":"","outfit":"","accessory":"","personality":"","forbidden_changes":["never change hair color","never change outfit"]}`,
      "You are a picture-book art director. English only. JSON only, no markdown. The hero name MUST appear verbatim in the manuscript."
    );
    const cbJson = JSON.parse(bibleText.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    // Post-validate: hero name must appear in manuscript, else abort so the
    // caller can decide (do not spend image cost on a wrong hero).
    const heroName = String(cbJson?.name ?? '').trim();
    if (heroName && manuscriptExcerpt && !new RegExp(`\\b${heroName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i').test(manuscriptExcerpt)) {
      throw new Error(`BIBLE_STORY_MISMATCH: generated hero "${heroName}" is not present in manuscript. Refusing to spend image cost. Update title/description or manuscript so they align.`);
    }
    const patch = {
      character_bible_json: cbJson,
      style_bible_json: { style_slug: style.slug, style_label: style.label },
      style_preset_id: style.id,
      style_slug: style.slug,
    };
    if (bible) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const upd = await (db.from('kids_book_bibles') as any).update(patch).eq('ebook_id', ctx.ebookId).select('*').single();
      bible = upd.data ?? { ...bible, ...patch };
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ins = await (db.from('kids_book_bibles') as any).insert({ ebook_id: ctx.ebookId, ...patch }).select('*').single();
      if (ins.error) throw new Error(`bible insert failed: ${ins.error.message}`);
      bible = ins.data ?? { ebook_id: ctx.ebookId, ...patch };
    }
    await markStyleUsed(db, style.id);
  }
  if (!bible) throw new Error('bible unavailable after upsert');

  const cb = (bible!.character_bible_json ?? {}) as Record<string, string>;
  const styleSlug = bible!.style_slug as string | null;
  const { data: stylePreset } = await db.from('kids_style_presets')
    .select('prompt_suffix, negative_prompt').eq('slug', styleSlug ?? '').maybeSingle();
  const styleSuffix = (stylePreset?.prompt_suffix as string | undefined) ?? 'children\'s picture book illustration';
  const negativePrompt = (stylePreset?.negative_prompt as string | undefined) ?? 'text, watermark, scary';

  const charDesc = [
    cb.name && `named ${cb.name}`,
    cb.species && `(${cb.species})`,
    cb.hair && `${cb.hair} hair`,
    cb.eyes && `${cb.eyes} eyes`,
    cb.skin && `${cb.skin} skin`,
    cb.outfit && `wearing ${cb.outfit}`,
    cb.accessory && `with ${cb.accessory}`,
  ].filter(Boolean).join(', ');

  async function assertLiveCoverImage(bytes: Uint8Array, label: string) {
    const lum = await computeLuminance(bytes);
    if (lum.dead) {
      throw new Error(`${label}_dead_image_gate: ${lum.reason} (mean=${lum.mean.toFixed(1)}, var=${lum.variance.toFixed(0)})`);
    }
    return lum;
  }

  // Step: character reference sheet (only if we don't have one yet)
  let refUrl = bible!.character_reference_image_url as string | null;
  if (!refUrl) {
    const refPrompt = `Character reference sheet: a friendly children's book hero ${charDesc}. Full body, front view, neutral pose, plain white background, clear features, ${styleSuffix}`;
    let refBytes: Uint8Array | null = null;
    let lastRefErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const candidate = await falFluxSchnell({ prompt: `${refPrompt}${attempt > 1 ? ' Bright, fully lit, no black background, no empty canvas.' : ''}`, image_size: 'square_hd', ebook_id: ctx.ebookId, step: 'kids_character_reference' });
        const refLum = await computeLuminance(candidate);
        if (refLum.mean < 12 || refLum.reason === 'near_black') throw new Error(`character_reference_dead_image_gate: ${refLum.reason} (mean=${refLum.mean.toFixed(1)}, var=${refLum.variance.toFixed(0)})`);
        refBytes = candidate;
        break;
      } catch (e) {
        lastRefErr = String((e as Error).message ?? e).slice(0, 220);
        console.warn(`character reference attempt ${attempt} rejected: ${lastRefErr}`);
      }
    }
    if (!refBytes) throw new Error(`character_reference_generation_failed_after_dead_image_gate: ${lastRefErr}`);
    const refPath = versionedKidsAssetPath(ctx.ebookId, 'character-ref');
    const refSigned = await uploadAndSignImage(db, 'ebook-covers', refPath, refBytes);
    refUrl = refSigned.signedUrl;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.from('kids_book_bibles') as any).update({
      character_reference_image_url: refUrl,
    }).eq('ebook_id', ctx.ebookId);
  }

  // Step: final cover — reference-grade whimsical illustrated children's storybook cover.
  // Textless art layer: title lettering is layered as a separate typographic overlay by
  // the store-thumbnail pipeline, so the AI never bakes text into the artwork.
  const coverPrompt = [
    `Whimsical illustrated children's picture book COVER ARTWORK for "${ctx.ebook.title}".`,
    `Hero character: ${charDesc}. Show the hero clearly in a warmly-lit, richly detailed scene that captures the story's emotional promise.`,
    `Portrait orientation. Storybook composition with strong focal character, rich magical/nature environment when fitting, cozy inviting atmosphere, soft golden lighting, painterly textures, expressive character face, generous negative space at the top for a title to be added later.`,
    `Style: ${styleSuffix}. Hand-illustrated feel like a modern reference-grade picture book cover (in the emotional spirit of Oliver Jeffers, Jon Klassen, Beatrice Alemagna — do NOT copy any of them).`,
    `Description hint: ${ctx.ebook.description ?? ''}`,
    `ABSOLUTELY NO TEXT of any kind: no letters, no numbers, no title, no words, no logo, no watermark, no captions, no typography, no book mockup, no UI. Textless artwork only.`,
    `Avoid AI clichés: no purple/indigo gradients on white, no glossy 3D blobs, no stock face, no generic hero-on-gradient, no melted shapes, no six-finger hands.`,
  ].join(' ');

  let coverBytes: Uint8Array | null = null;
  let coverLum: Awaited<ReturnType<typeof computeLuminance>> | null = null;
  let lastCoverErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const candidate = await falRecraftV3({
        prompt: `${coverPrompt}${attempt > 1 ? ` Retry ${attempt}: previous cover was unusable (${lastCoverErr}). Render a bright, fully illustrated, non-black cover with visible character and rich background.` : ''}`,
        image_url: refUrl ?? undefined,
        strength: 0.6,
        image_size: 'portrait_4_3',
        negative_prompt: `${negativePrompt}, black canvas, near-black image, empty image, blank image, text, letters, numbers, words, title, typography, watermark, logo, book mockup, ui, caption, subtitle, spine, gradient on white, glossy 3d blob, stock photo, six fingers, deformed hands, generic ai look`,
        ebook_id: ctx.ebookId,
        step: 'kids_cover_master',
      });
      coverLum = await assertLiveCoverImage(candidate, 'cover_master');
      coverBytes = candidate;
      break;
    } catch (e) {
      lastCoverErr = String((e as Error).message ?? e).slice(0, 220);
      console.warn(`cover master attempt ${attempt} rejected: ${lastCoverErr}`);
    }
  }
  if (!coverBytes) throw new Error(`cover_generation_failed_after_dead_image_gate: ${lastCoverErr}`);

  // Upload the TEXTLESS AI master (used as the visual anchor for interior gen
  // and as the input to the illustrated title-treatment compositor).
  const masterPath = versionedKidsAssetPath(ctx.ebookId, 'cover-master');
  const masterSigned = await uploadAndSignImage(db, 'ebook-covers', masterPath, coverBytes);
  const coverMasterUrl = masterSigned.signedUrl;

  // Compose the illustrated title treatment (hand-lettered feel, layered
  // stroke/shadow/highlight/texture, per-letter jitter, themed decorations).
  // Title text comes from ctx.ebook.title verbatim — never from the AI model.
  const styleBibleForPalette = (bible!.style_bible_json ?? {}) as Record<string, unknown>;
  const palette = Array.isArray(styleBibleForPalette.palette)
    ? (styleBibleForPalette.palette as string[])
    : (Array.isArray((cb as Record<string, unknown>).palette) ? (cb as Record<string, string[]>).palette : []);
  const ageBand = (ctx.ebook.storefront_meta as { admin_params?: { age_band?: string } } | null)?.admin_params?.age_band ?? null;
  const treatment = await renderKidsTitleTreatment({
    coverBg: coverBytes,
    title: String(ctx.ebook.title ?? ''),
    subtitle: (ctx.ebook.subtitle as string | null) ?? null,
    description: (ctx.ebook.description as string | null) ?? null,
    palette,
    ageBadge: ageBand ? `AGES ${ageBand}` : null,
    width: 1600,
    height: 1600,
  });
  const finalLum = await assertLiveCoverImage(treatment.png, 'final_cover');

  const composedPath = versionedKidsAssetPath(ctx.ebookId, 'cover');
  const pub = await uploadAndSignImage(db, 'ebook-covers', composedPath, treatment.png);
  const coverUrl = pub.signedUrl;

  // Store both: textless master (interior anchor) + composed cover (product asset).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db.from('kids_book_bibles') as any).update({
    cover_master_url: coverMasterUrl,
  }).eq('ebook_id', ctx.ebookId);

  const existingMeta = (ctx.ebook.storefront_meta ?? {}) as Record<string, unknown>;
  await db.from('ebooks_kids').update({
    cover_url: coverUrl,
    thumbnail_url: coverUrl,
    status: 'rendering', pipeline_status: 'rendering',
    storefront_meta: { ...existingMeta, title_treatment: treatment.metadata, cover_luminance: { master: coverLum, final: finalLum } },
  }).eq('id', ctx.ebookId);
  return {
    output: {
      composed_path: composedPath,
      master_path: masterPath,
      style: styleSlug,
      ref_used: !!refUrl,
      title_theme: treatment.metadata.theme,
      title_font_size: treatment.metadata.font_size,
      lines: treatment.metadata.lines,
    },
  };
}

// ---------- Style bible (locked, drives interior style consistency) ----------
async function generateStyleBible(ctx: Ctx): Promise<StepResult> {
  const db = ctx.supabase;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bible } = await (db.from('kids_book_bibles') as any).select('*').eq('ebook_id', ctx.ebookId).maybeSingle();
  const existing = (bible?.style_bible_json ?? {}) as Record<string, unknown>;
  // Consider "present" only if it has structural fields (not just the auto-created stub).
  const hasStructure = existing && (existing.line_quality || existing.palette || existing.lighting);
  if (hasStructure) {
    await db.from('ebooks_kids').update({ style_bible_json: existing }).eq('id', ctx.ebookId);
    return { output: { skipped: true, reason: 'style bible already locked' } };
  }

  const cb = (bible?.character_bible_json ?? {}) as Record<string, string>;
  const stylePrompt = await callAI(
    `Create a locked style bible for "${ctx.ebook.title}". Character: ${JSON.stringify(cb)}. Existing style hint: ${JSON.stringify(existing)}.
Return JSON only: {"line_quality":"","palette":["#","#","#","#","#"],"lighting":"","medium":"","mood":"","character_proportions":"","forbidden":["no text","no photorealism"]}`,
    "You are a children's picture book art director locking a style bible for consistent interior illustrations.",
  );
  const parsed = JSON.parse(stylePrompt.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  const merged = { ...existing, ...parsed, locked_at: new Date().toISOString() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db.from('kids_book_bibles') as any).update({ style_bible_json: merged }).eq('ebook_id', ctx.ebookId);
  await db.from('ebooks_kids').update({ style_bible_json: merged }).eq('id', ctx.ebookId);
  return { output: { style_bible: merged } };
}

// ---------- Interior illustrations ----------
// Interior generation used to run all ~28 reference-conditioned image calls
// inside this single edge invocation. That reliably hit the worker
// wall-clock, killed the run without persisting stage state, and made
// every watchdog resume restart from scratch — burning image credits.
//
// New flow: build (or reuse) the scene plan here, persist it into
// qc_scorecard.scene_plan, then hand off to `kids-render-interior` which
// generates in batches of 8, persists per-page to interior_illustrations,
// self-chains until every page exists, and finally resumes THIS run via
// force_finish so thumbnail/previews/PDF steps continue automatically.
async function generateInterior(ctx: Ctx): Promise<StepResult> {
  const db = ctx.supabase;
  const existing = Array.isArray(ctx.ebook.interior_illustrations) ? ctx.ebook.interior_illustrations : [];
  const qc = (ctx.ebook.qc_scorecard ?? {}) as Record<string, unknown>;
  const persistedPlan = qc.scene_plan as { scenes?: unknown[] } | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bible } = await (db.from('kids_book_bibles') as any).select('*').eq('ebook_id', ctx.ebookId).maybeSingle();
  if (!bible) throw new Error('no bible — cover step must run first');

  // If plan not yet persisted, build it once here and store on the ebook so
  // every resume (and kids-render-interior itself) reuses the same beats.
  let plan = persistedPlan as { scenes: Array<{ scene: string; emotion: string; setting: string }> } | undefined;
  if (!plan || !Array.isArray(plan.scenes) || plan.scenes.length < MIN_INTERIOR) {
    plan = await buildScenePlan({
      title: String(ctx.ebook.title ?? ''),
      manuscript_md: String(ctx.ebook.manuscript_md ?? ''),
      min_scenes: TARGET_INTERIOR,
    });
    await db.from('ebooks_kids').update({
      qc_scorecard: { ...qc, scene_plan: plan },
    }).eq('id', ctx.ebookId);
  }
  const total = plan.scenes.length;

  // Skip when interior is fully rendered (resume-after-completion path).
  if (existing.length >= total) {
    return { output: { skipped: true, count: existing.length, total } };
  }

  // Set progress marker so the admin UI + watchdog see the staged state.
  await db.from('ebooks_kids').update({
    pipeline_status: 'illustrating',
    qc_scorecard: {
      ...qc,
      scene_plan: plan,
      interior_build: { done: existing.length, total, updated_at: new Date().toISOString() },
    },
  }).eq('id', ctx.ebookId);

  // Dispatch the staged renderer. It will self-chain in batches of 8 and
  // resume this run via force_finish when every page is on disk.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runIdFromCtx: string | null = ((ctx as any).runId ?? null);
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/kids-render-interior`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ ebook_id: ctx.ebookId, run_id: runIdFromCtx }),
    });
  } catch (e) {
    console.warn('dispatch kids-render-interior failed (will be retried by watchdog):', (e as Error).message);
  }

  // Sentinel — the outer loop treats this as a clean pause, not a failure.
  throw new Error(`${INTERIOR_STAGED}: dispatched kids-render-interior (${existing.length}/${total} rendered)`);
}


// ---------- Thumbnail (kids picture books use the cover as thumbnail) ----------
async function generateThumbnail(ctx: Ctx): Promise<StepResult> {
  const cover = ctx.ebook.cover_url as string | null;
  if (!cover) throw new Error('cover_url missing — cannot derive thumbnail');
  // Point the thumbnail_url at the cover asset. Storefront can render at any size.
  await ctx.supabase.from('ebooks_kids').update({ thumbnail_url: cover }).eq('id', ctx.ebookId);
  return { output: { thumbnail_url: cover } };
}

// ---------- Preview pages (first N interior illustration URLs) ----------
async function generatePreviews(ctx: Ctx): Promise<StepResult> {
  const illos = Array.isArray(ctx.ebook.interior_illustrations) ? ctx.ebook.interior_illustrations : [];
  const urls = illos.map((x: unknown) => (x as { url?: string })?.url).filter((u): u is string => !!u).slice(0, MIN_PREVIEWS);
  if (urls.length < MIN_PREVIEWS) throw new Error(`only ${urls.length} preview candidates`);
  await ctx.supabase.from('ebooks_kids').update({ preview_page_urls: urls }).eq('id', ctx.ebookId);
  return { output: { count: urls.length, urls } };
}

// ---------- Dispatch multi-stage PDF builder + QC + publish ----------
// This is the proven flow that shipped `The Sneeze-Powered Sock Sorter`.
// We hand off to `kids-build-picture-pdf` which chains itself through
// pdf_prepare → pdf_pages_1_4 → pdf_pages_5_8 → pdf_pages_9_12 → pdf_finalize,
// then invokes `kids-publish-if-qc-passed` which runs measured QC and only
// flips listing_status=live when every critical gate passes. This keeps every
// Edge worker small (avoids WORKER_RESOURCE_LIMIT) and enforces the
// publish-only-on-QC-pass guardrail centrally.
async function dispatchPdfQcPublish(ctx: Ctx): Promise<StepResult> {
  const md = String(ctx.ebook.manuscript_md ?? '');
  if (!md || md.length < 200) throw new Error('manuscript too short to render');
  const coverUrl = ctx.ebook.cover_url as string | null;
  const illos = Array.isArray(ctx.ebook.interior_illustrations) ? ctx.ebook.interior_illustrations : [];
  if (!coverUrl) throw new Error('cover_url required for picture PDF');
  if (illos.length < MIN_INTERIOR) throw new Error(`interior illustrations missing: ${illos.length}/${MIN_INTERIOR}`);

  await ctx.supabase.from('ebooks_kids').update({
    status: 'qc', pipeline_status: 'pdf_building',
  }).eq('id', ctx.ebookId);

  const res = await fetch(`${SUPABASE_URL}/functions/v1/kids-build-picture-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ ebook_id: ctx.ebookId, stage: 'pdf_prepare', publish: true, run_qc_after: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    throw new Error(`pdf builder dispatch failed: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return {
    output: {
      dispatched: true,
      note: 'multi-stage PDF → measured QC → publish-if-qc-passed running asynchronously',
      first_stage: body?.stage ?? 'pdf_prepare',
      next_stage: body?.next_stage ?? 'pdf_pages_1_4',
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

