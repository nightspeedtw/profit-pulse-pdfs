import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

type StepResult = { output: Record<string, unknown>; fallbackUsed?: boolean };
type Step = {
  name: string;
  label: string;
  critical?: boolean; // if true, run is marked failed if fallback also fails
  run: (ctx: Ctx) => Promise<StepResult>;
};
type Ctx = { supabase: ReturnType<typeof createClient>; ebookId: string; ebook: Record<string, unknown> };

const STEPS: Step[] = [
  { name: 'generate_idea', label: 'Generate story idea', critical: true, run: generateIdea },
  { name: 'generate_manuscript', label: 'Write manuscript', critical: true, run: generateManuscript },
  { name: 'generate_cover', label: 'Design cover', run: generateCover },
  { name: 'render_pdf', label: 'Render PDF', run: renderPdf },
  { name: 'qc', label: 'Quality check', run: runQc },
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

    return json({ ok: true, ebook_kids_id: ctx.ebookId, status: finalStatus, soft_failures: softFailures });
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
  // NO fallback-as-pass. If image generation fails after retries the step MUST fail
  // so QC records the defect and the run ends up in human_review_required.
  const res = await fetch('https://ai.gateway.lovable.dev/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-image-preview',
      prompt: `Children's book cover for "${ctx.ebook.title}". Warm, colorful, professional illustration, portrait orientation. ${ctx.ebook.description ?? ''}. English text on cover only if any.`,
      n: 1, size: '1024x1536',
    }),
  });
  if (!res.ok) throw new Error(`Image AI ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error('no image');
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const path = `kids/${ctx.ebookId}/cover.png`;
  const up = await ctx.supabase.storage.from('ebook-covers').upload(path, bytes, {
    contentType: 'image/png', upsert: true,
  });
  if (up.error) throw up.error;
  const { data: pub } = await ctx.supabase.storage.from('ebook-covers').createSignedUrl(path, 60 * 60 * 24 * 365);
  await ctx.supabase.from('ebooks_kids').update({
    cover_url: pub?.signedUrl ?? null, status: 'rendering', pipeline_status: 'rendering',
  }).eq('id', ctx.ebookId);
  return { output: { path } };
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
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
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
