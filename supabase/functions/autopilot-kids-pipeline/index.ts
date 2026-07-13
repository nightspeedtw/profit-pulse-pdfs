import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { falFluxSchnell, falRecraftV3 } from '../_shared/fal.ts';
import { pickStyle, markStyleUsed } from '../_shared/style-picker.ts';
import { buildScenePlan, renderInteriorIllustrations } from '../_shared/kids-interior.ts';
import { buildPicturePdf } from '../_shared/kids-picture-pdf.ts';
import { runKidsStoryJudge } from '../_shared/kids-story-judge.ts';
import { detectBibleStoryMismatch, BIBLE_STORY_MISMATCH } from '../_shared/bible-story-mismatch.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

// Sentinel error that the pipeline loop recognizes to short-circuit before art.
const STORY_GATE_BLOCK = 'STORY_GATE_BLOCK';

const MIN_INTERIOR = 12;
const MIN_PREVIEWS = 3;

type StepResult = { output: Record<string, unknown>; fallbackUsed?: boolean };
type Step = {
  name: string;
  label: string;
  critical?: boolean;
  run: (ctx: Ctx) => Promise<StepResult>;
};
type Ctx = { supabase: ReturnType<typeof createClient>; ebookId: string; ebook: Record<string, unknown> };

const STEPS: Step[] = [
  { name: 'generate_idea', label: 'Generate story idea', critical: true, run: generateIdea },
  { name: 'generate_manuscript', label: 'Write manuscript', critical: true, run: generateManuscript },
  { name: 'story_gate', label: 'Story judge gate (before art)', critical: true, run: storyGate },
  { name: 'bible_check', label: 'Bible/story hero match check', critical: true, run: bibleCheck },
  { name: 'generate_cover', label: 'Design cover', run: generateCover },
  { name: 'generate_style_bible', label: 'Lock style bible', critical: true, run: generateStyleBible },
  { name: 'generate_interior', label: 'Illustrate interior', critical: true, run: generateInterior },
  { name: 'generate_thumbnail', label: 'Store thumbnail', run: generateThumbnail },
  { name: 'generate_previews', label: 'Preview pages', run: generatePreviews },
  { name: 'render_pdf', label: 'Render picture PDF', critical: true, run: renderPdf },
  { name: 'qc', label: 'Measured QC', run: runQc },
  { name: 'publish_live', label: 'Publish live', run: publishLive },
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
    const ctx: Ctx = { supabase, ebookId: run.ebook_kids_id as string, ebook: ebook ?? {} };

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
      // This prevents baseline from spending image cost on a story the judge rejects.
      if (step.name === 'story_gate' && outcome.status === 'failed') {
        await supabase.from('ebooks_kids').update({
          listing_status: 'draft',
          status: 'needs_revision',
          pipeline_status: 'human_review_required',
        }).eq('id', ctx.ebookId);
        console.log(`story_gate blocked pipeline; skipping remaining ${STEPS.length - i - 1} steps`);
        break;
      }

      // Hard stop: bible/story mismatch means any downstream art would use the
      // wrong character. Halt and require human_review so we do not spend image cost.
      if (step.name === 'bible_check' && outcome.status === 'failed') {
        await supabase.from('ebooks_kids').update({
          listing_status: 'draft',
          status: 'needs_revision',
          pipeline_status: 'human_review_required',
          human_review_reason: outcome.error ?? 'BIBLE_STORY_MISMATCH',
        }).eq('id', ctx.ebookId);
        console.log(`bible_check blocked pipeline: ${outcome.error}`);
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
  if (ctx.ebook.manuscript_md) return { output: { skipped: true } };
  const md = await callAI(
    `Write a warm, age-appropriate children's story titled "${ctx.ebook.title}". Description: ${ctx.ebook.description}. 600-900 words in English. Return the story only, no preamble.`,
    'You are an award-winning children\'s author. English only. Return markdown.'
  );
  const word_count = md.split(/\s+/).filter(Boolean).length;
  await ctx.supabase.from('ebooks_kids').update({
    manuscript_md: md, word_count, status: 'illustrating', pipeline_status: 'illustrating',
  }).eq('id', ctx.ebookId);
  return { output: { word_count } };
}

// Story gate — runs BEFORE any art/PDF step so baseline never spends image cost on a rejected story.
// Throws when the strict story judge does not pass; the pipeline loop then short-circuits.
async function storyGate(ctx: Ctx): Promise<StepResult> {
  const manuscript = String(ctx.ebook.manuscript_md ?? '').trim();
  if (!manuscript) throw new Error(`${STORY_GATE_BLOCK}: manuscript missing`);
  const ageBand = (ctx.ebook.storefront_meta as { admin_params?: { age_band?: string } } | null)?.admin_params?.age_band ?? '4-6';
  const sb = (ctx.ebook.story_bible ?? {}) as { spreads?: Array<{ text?: string }> };
  const pageTexts = Array.isArray(sb.spreads) ? sb.spreads.map((s) => String(s?.text ?? '')) : [];

  const report = await runKidsStoryJudge({
    title: String(ctx.ebook.title ?? ''),
    subtitle: (ctx.ebook.subtitle as string | null) ?? null,
    ageBand,
    manuscript_md: manuscript,
    page_texts: pageTexts,
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
    const bibleText = await callAI(
      `Create a character bible JSON for the hero of "${ctx.ebook.title}". Description: ${ctx.ebook.description}. Reply as JSON only: {"name":"","species":"","age":"","hair":"","eyes":"","skin":"","outfit":"","accessory":"","personality":"","forbidden_changes":["never change hair color","never change outfit"]}`,
      "You are a picture-book art director. English only. JSON only, no markdown."
    );
    const cbJson = JSON.parse(bibleText.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
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

  // Step: character reference sheet (only if we don't have one yet)
  let refUrl = bible!.character_reference_image_url as string | null;
  if (!refUrl) {
    const refPrompt = `Character reference sheet: a friendly children's book hero ${charDesc}. Full body, front view, neutral pose, plain white background, clear features, ${styleSuffix}`;
    const refBytes = await falFluxSchnell({ prompt: refPrompt, image_size: 'square_hd' });
    const refPath = `kids/${ctx.ebookId}/character-ref.png`;
    const up = await db.storage.from('ebook-covers').upload(refPath, refBytes, {
      contentType: 'image/png', upsert: true,
    });
    if (up.error) throw up.error;
    const { data: refSigned } = await db.storage.from('ebook-covers').createSignedUrl(refPath, 60 * 60 * 24 * 365);
    refUrl = refSigned?.signedUrl ?? null;
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

  const coverBytes = await falRecraftV3({
    prompt: coverPrompt,
    image_url: refUrl ?? undefined,
    strength: 0.6,
    image_size: 'portrait_4_3',
    negative_prompt: `${negativePrompt}, text, letters, numbers, words, title, typography, watermark, logo, book mockup, ui, caption, subtitle, spine, gradient on white, glossy 3d blob, stock photo, six fingers, deformed hands, generic ai look`,
  });

  const path = `kids/${ctx.ebookId}/cover.png`;
  const up = await db.storage.from('ebook-covers').upload(path, coverBytes, {
    contentType: 'image/png', upsert: true,
  });
  if (up.error) throw up.error;
  const { data: pub } = await db.storage.from('ebook-covers').createSignedUrl(path, 60 * 60 * 24 * 365);
  const coverUrl = pub?.signedUrl ?? null;

  // Store as cover master on the bible so interior generation uses the same visual anchor.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db.from('kids_book_bibles') as any).update({
    cover_master_url: coverUrl,
  }).eq('ebook_id', ctx.ebookId);

  await db.from('ebooks_kids').update({
    cover_url: coverUrl, status: 'rendering', pipeline_status: 'rendering',
  }).eq('id', ctx.ebookId);
  return { output: { path, style: styleSlug, ref_used: !!refUrl } };
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
async function generateInterior(ctx: Ctx): Promise<StepResult> {
  const db = ctx.supabase;
  const existing = Array.isArray(ctx.ebook.interior_illustrations) ? ctx.ebook.interior_illustrations : [];
  if (existing.length >= MIN_INTERIOR) {
    return { output: { skipped: true, count: existing.length } };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bible } = await (db.from('kids_book_bibles') as any).select('*').eq('ebook_id', ctx.ebookId).maybeSingle();
  if (!bible) throw new Error('no bible — cover step must run first');
  const cb = (bible.character_bible_json ?? {}) as Record<string, string>;
  const sb = (bible.style_bible_json ?? ctx.ebook.style_bible_json ?? {}) as Record<string, unknown>;
  const styleSlug = bible.style_slug as string | null;
  const { data: stylePreset } = await db.from('kids_style_presets')
    .select('prompt_suffix, negative_prompt').eq('slug', styleSlug ?? '').maybeSingle();

  const styleParts = [
    stylePreset?.prompt_suffix as string | undefined,
    sb.line_quality && `line quality: ${sb.line_quality}`,
    sb.lighting && `lighting: ${sb.lighting}`,
    sb.mood && `mood: ${sb.mood}`,
    sb.medium && `medium: ${sb.medium}`,
    Array.isArray(sb.palette) && (sb.palette as string[]).length ? `palette: ${(sb.palette as string[]).join(', ')}` : null,
  ].filter(Boolean).join('; ') || "warm whimsical storybook illustration, cozy painterly, soft edges";
  const negativePrompt = (stylePreset?.negative_prompt as string | undefined) ?? 'text, watermark, scary, photorealistic';

  const charDesc = [
    cb.name && `named ${cb.name}`,
    cb.species && `(${cb.species})`,
    cb.hair && `${cb.hair} hair`,
    cb.eyes && `${cb.eyes} eyes`,
    cb.skin && `${cb.skin} skin`,
    cb.outfit && `wearing ${cb.outfit}`,
    cb.accessory && `with ${cb.accessory}`,
  ].filter(Boolean).join(', ') || 'the story hero';

  const plan = await buildScenePlan({
    title: String(ctx.ebook.title ?? ''),
    manuscript_md: String(ctx.ebook.manuscript_md ?? ''),
    min_scenes: MIN_INTERIOR,
  });

  const records = await renderInteriorIllustrations({
    ebookId: ctx.ebookId,
    db,
    characterDescription: charDesc,
    styleSuffix: styleParts,
    negativePrompt,
    scenes: plan.scenes.slice(0, MIN_INTERIOR),
    startPageNumber: 3,
  });

  await db.from('ebooks_kids').update({
    interior_illustrations: records,
    pipeline_status: 'illustrating',
  }).eq('id', ctx.ebookId);
  return { output: { count: records.length } };
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

// ---------- Real picture-book PDF (cover + title + illustrated spreads) ----------
async function renderPdf(ctx: Ctx): Promise<StepResult> {
  const md = (ctx.ebook.manuscript_md as string) ?? '';
  if (!md || md.length < 200) throw new Error('manuscript too short to render');
  const coverUrl = ctx.ebook.cover_url as string | null;
  const illos = (Array.isArray(ctx.ebook.interior_illustrations) ? ctx.ebook.interior_illustrations : []) as Array<{ url: string; scene?: string }>;
  if (!coverUrl) throw new Error('cover_url required for picture PDF');
  if (illos.length < MIN_INTERIOR) throw new Error(`interior illustrations missing: ${illos.length}/${MIN_INTERIOR}`);

  const coverBytes = new Uint8Array(await (await fetch(coverUrl)).arrayBuffer());
  const spreadImages: Uint8Array[] = [];
  for (const il of illos) {
    const b = new Uint8Array(await (await fetch(il.url)).arrayBuffer());
    spreadImages.push(b);
  }

  // Split manuscript into N caption blocks matching the spread count.
  const paras = md.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const chunkSize = Math.max(1, Math.ceil(paras.length / illos.length));
  const captions: string[] = [];
  for (let i = 0; i < illos.length; i++) {
    captions.push(paras.slice(i * chunkSize, (i + 1) * chunkSize).join(' ') || (illos[i].scene ?? ''));
  }

  const pdfBytes = await buildPicturePdf({
    title: String(ctx.ebook.title ?? ''),
    subtitle: (ctx.ebook.subtitle as string | null) ?? null,
    coverPng: coverBytes,
    spreads: illos.map((_, i) => ({ caption: captions[i], imagePng: spreadImages[i] })),
  });

  const path = `kids/${ctx.ebookId}/book.pdf`;
  const up = await ctx.supabase.storage.from('ebook-pdfs').upload(path, pdfBytes, {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) throw up.error;
  const { data: pub } = await ctx.supabase.storage.from('ebook-pdfs').createSignedUrl(path, 60 * 60 * 24 * 365);
  const pageCount = 2 + illos.length + 1; // cover + title + spreads + end
  await ctx.supabase.from('ebooks_kids').update({
    pdf_url: pub?.signedUrl ?? null,
    page_count: pageCount,
    status: 'qc', pipeline_status: 'pdf_preflight',
  }).eq('id', ctx.ebookId);
  return { output: { path, byte_size: pdfBytes.length, page_count: pageCount } };
}

async function runQc(ctx: Ctx): Promise<StepResult> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/kids-qc-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ ebook_id: ctx.ebookId }),
  });
  const body = await res.json();
  if (!res.ok || !body?.ok) throw new Error(`qc failed: ${JSON.stringify(body).slice(0, 300)}`);
  const verdict = body.verdict;
  await ctx.supabase.from('ebooks_kids').update({
    pipeline_status: verdict.sellable ? 'sellable' : 'human_review_required',
    status: verdict.sellable ? 'ready' : 'needs_revision',
  }).eq('id', ctx.ebookId);
  if (!verdict.sellable) throw new Error(`NOT_SELLABLE: ${verdict.reasons.join('; ')}`);
  return { output: verdict };
}

async function publishLive(ctx: Ctx): Promise<StepResult> {
  const { data: fresh } = await ctx.supabase.from('ebooks_kids')
    .select('sellable, cover_url, pdf_url, thumbnail_url, interior_illustrations, preview_page_urls')
    .eq('id', ctx.ebookId).single();
  if (!fresh?.sellable) throw new Error('refuse_publish: not sellable');
  // Belt-and-braces asset check even after QC.
  if (!fresh.cover_url || !fresh.pdf_url || !fresh.thumbnail_url) throw new Error('refuse_publish: missing assets');
  const illoCount = Array.isArray(fresh.interior_illustrations) ? fresh.interior_illustrations.length : 0;
  const previewCount = Array.isArray(fresh.preview_page_urls) ? fresh.preview_page_urls.length : 0;
  if (illoCount < MIN_INTERIOR || previewCount < MIN_PREVIEWS) throw new Error('refuse_publish: missing illustrations/previews');
  await ctx.supabase.from('ebooks_kids').update({
    listing_status: 'live', status: 'live', pipeline_status: 'published',
  }).eq('id', ctx.ebookId);
  return { output: { published: true } };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
