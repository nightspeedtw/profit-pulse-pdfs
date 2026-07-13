import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { falFluxSchnell, falRecraftV3 } from '../_shared/fal.ts';
import { pickStyle, markStyleUsed } from '../_shared/style-picker.ts';
import { buildScenePlan, renderInteriorIllustrations } from '../_shared/kids-interior.ts';
import { buildPicturePdf } from '../_shared/kids-picture-pdf.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

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

      // Never break the loop — keep pushing forward. Later steps decide what to do given prior state.
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

async function renderPdf(ctx: Ctx): Promise<StepResult> {
  // Build a REAL PDF (not HTML with a lying content-type).
  const md = (ctx.ebook.manuscript_md as string) ?? '';
  if (!md || md.length < 200) throw new Error('manuscript too short to render');
  const paragraphs = md.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const pdfBytes = buildMinimalPdf(String(ctx.ebook.title ?? ''), paragraphs);
  const path = `kids/${ctx.ebookId}/book.pdf`;
  const up = await ctx.supabase.storage.from('ebook-pdfs').upload(path, pdfBytes, {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) throw up.error;
  const { data: pub } = await ctx.supabase.storage.from('ebook-pdfs').createSignedUrl(path, 60 * 60 * 24 * 365);
  await ctx.supabase.from('ebooks_kids').update({
    pdf_url: pub?.signedUrl ?? null, status: 'qc', pipeline_status: 'pdf_preflight',
  }).eq('id', ctx.ebookId);
  return { output: { path, byte_size: pdfBytes.length } };
}

async function runQc(ctx: Ctx): Promise<StepResult> {
  // Evidence-based: delegate to kids-qc-run.
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
  if (!verdict.sellable) {
    // Bubble up as a hard failure so publish_live is skipped and the run is
    // marked failed → operator can inspect the QC report and repair.
    throw new Error(`NOT_SELLABLE: ${verdict.reasons.join('; ')}`);
  }
  return { output: verdict };
}

async function publishLive(ctx: Ctx): Promise<StepResult> {
  // Real gate: read the latest sellable flag from the DB. Never publish otherwise.
  const { data: fresh } = await ctx.supabase.from('ebooks_kids').select('sellable, cover_url, pdf_url').eq('id', ctx.ebookId).single();
  if (!fresh?.sellable) throw new Error('refuse_publish: not sellable');
  await ctx.supabase.from('ebooks_kids').update({
    listing_status: 'live', status: 'live', pipeline_status: 'published',
  }).eq('id', ctx.ebookId);
  return { output: { published: true } };
}

// -------- Minimal real PDF builder (avoids the fake-mime-type defect) --------
// Emits a genuine %PDF-1.4 with one page per paragraph chunk, using the built-in
// Helvetica font. Content is embedded as text operators — good enough to pass the
// preflight header/pages checks; visual QC still enforces typography rules.
function buildMinimalPdf(title: string, paragraphs: string[]): Uint8Array {
  const pageWidth = 612;   // 8.5in @ 72dpi
  const pageHeight = 792;  // 11in
  const marginX = 72;      // 1in
  const marginY = 72;
  const bodySize = 18;
  const lineHeight = bodySize * 1.4;
  const maxCharsPerLine = 60;
  const linesPerPage = Math.floor((pageHeight - marginY * 2) / lineHeight) - 3;

  const pages: string[][] = [];
  let current: string[] = [`${title}`, ""];
  for (const p of paragraphs) {
    const wrapped = wrap(p, maxCharsPerLine);
    for (const line of wrapped) {
      if (current.length >= linesPerPage) { pages.push(current); current = []; }
      current.push(line);
    }
    if (current.length >= linesPerPage) { pages.push(current); current = []; }
    else current.push("");
  }
  if (current.length) pages.push(current);
  if (!pages.length) pages.push([title]);

  const objects: string[] = [];
  const push = (s: string) => { objects.push(s); return objects.length; };

  // 1: catalog, 2: pages, then per page: page object + contents. Font last.
  const catalogId = 1;
  const pagesId = 2;
  objects.push("", ""); // reserve

  const pageIds: number[] = [];
  const contentIds: number[] = [];
  for (const lines of pages) {
    const stream = pageStream(lines, pageWidth, pageHeight, marginX, marginY, bodySize, lineHeight);
    const contentId = push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    contentIds.push(contentId);
    const pageId = push(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 999 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  const fontId = push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  // fixup page /F1 999 → real font id
  for (const pid of pageIds) {
    objects[pid - 1] = objects[pid - 1].replace("999 0 R", `${fontId} 0 R`);
  }

  objects[0] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  // Assemble
  const header = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n";
  let body = header;
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(body);
}

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max) { if (line) out.push(line); line = w; }
    else line = (line ? line + " " : "") + w;
  }
  if (line) out.push(line);
  return out;
}

function pageStream(lines: string[], pw: number, _ph: number, mx: number, my: number, size: number, lh: number): string {
  const startY = _ph - my;
  // Normalize non-ASCII Unicode (curly quotes, em-dashes, ellipses) to WinAnsi-safe
  // ASCII BEFORE PDF escaping. Base-14 Helvetica can't render curly quotes and
  // silently substitutes /florin (ƒ), which is why the live book showed
  // "littleƒ" instead of "little,". Fix at the encoder, not the model.
  const normalize = (s: string) => s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // curly single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')   // curly double quotes
    .replace(/[\u2013\u2014]/g, "-")               // en/em dash
    .replace(/\u2026/g, "...")                     // ellipsis
    .replace(/[\u00A0\u2007\u202F]/g, " ")         // non-breaking spaces
    .replace(/[^\x20-\x7E]/g, "");                 // drop any remaining non-ASCII
  const escape = (s: string) => normalize(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  let s = `BT /F1 ${size} Tf ${mx} ${startY} Td ${lh} TL\n`;
  for (const line of lines) {
    s += `(${escape(line)}) Tj T*\n`;
  }
  s += "ET";
  return s;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
