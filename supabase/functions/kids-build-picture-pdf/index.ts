// Multi-stage kids picture-book PDF builder — SQUARE 8.5×8.5 format.
//
// Splits assembly into small stages so a single Edge worker never holds cover
// + 28+ interior images + the pdf-lib doc in memory / CPU wall at once.
//
// Stages (each = one HTTP invocation; the function self-chains until finalize):
//   1. pdf_prepare         -> cover + title + copyright
//   2..K. pdf_pages_<i>    -> next per-stage batch of story pages (JPEG q80)
//   final. pdf_finalize    -> "The End" + promote to book.pdf + pdf_url
//
// Position is tracked by `pdf_repair_job.pages_done` so a change to the
// per-stage batch size never double-appends already-embedded pages.
//
// Heartbeat: every invocation writes `attempt_at` + `attempt_stage` on entry,
// and on failure persists `error` so silent OOM/wall-clock deaths are visible.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Image } from 'https://deno.land/x/imagescript@1.2.17/mod.ts';
import {
  startPicturePdf, appendSpreadsToPdf, finalizePicturePdf, splitManuscriptForSpreads,
} from '../_shared/kids-picture-pdf.ts';
import { KIDS_BOOK_FORMAT } from '../_shared/kids-book-format.ts';
import { computeLuminance } from '../_shared/image-luminance.ts';
import { loadSegments, segmentsToPageTexts } from '../_shared/kids-segments.ts';
import { buildBonusContent } from '../_shared/bonus-pages.ts';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Gate 4: reject placeholder / empty captions that would print "Page 28"
// into the caption panel of story page 31.
const PLACEHOLDER_RX = /^\s*(page\s*\d+|lorem\s+ipsum|placeholder|tbd|todo)\s*$/i;
function isPlaceholderCaption(s: string): boolean {
  if (!s || !s.trim()) return true;
  return PLACEHOLDER_RX.test(s.trim());
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const INPROGRESS_PATH = (id: string) => `kids/${id}/book-inprogress.pdf`;
const FINAL_PATH = (id: string) => `kids/${id}/book.pdf`;

const MIN_INTERIOR = KIDS_BOOK_FORMAT.story_min_pages;
const MAX_INTERIOR = KIDS_BOOK_FORMAT.story_max_pages;
const PER_STAGE = KIDS_BOOK_FORMAT.pdf_pages_per_stage;
const MAX_INTERIOR_PX = 1024;
const JPEG_QUALITY = 80;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readInprogress(db: any, ebook_id: string): Promise<Uint8Array> {
  const dl = await db.storage.from('ebook-pdfs').download(INPROGRESS_PATH(ebook_id));
  if (dl.error || !dl.data) throw new Error(`missing inprogress pdf: ${dl.error?.message ?? 'no data'}`);
  return new Uint8Array(await dl.data.arrayBuffer());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function writeInprogress(db: any, ebook_id: string, bytes: Uint8Array) {
  const up = await db.storage.from('ebook-pdfs').upload(INPROGRESS_PATH(ebook_id), bytes, {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) throw up.error;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function persistJob(db: any, ebook_id: string, scorecardIn: Record<string, unknown> | null, patch: Record<string, unknown>) {
  // Re-read to avoid clobbering concurrent updates.
  const { data: fresh } = await db.from('ebooks_kids').select('qc_scorecard').eq('id', ebook_id).single();
  const base = ((fresh?.qc_scorecard as Record<string, unknown> | null) ?? scorecardIn ?? {}) as Record<string, unknown>;
  const log = ((base.repair_log ?? {}) as Record<string, unknown>);
  const job = ((log.pdf_repair_job ?? {}) as Record<string, unknown>);
  const next = { ...job, ...patch, updated_at: new Date().toISOString() };
  await db.from('ebooks_kids').update({
    qc_scorecard: { ...base, repair_log: { ...log, pdf_repair_job: next } },
  }).eq('id', ebook_id);
  return next;
}

// Double-tap self-chain: fire → wait 5s → if child didn't ack, fire again.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function selfChainDoubleTap(db: any, ebook_id: string, publish: boolean, scorecardIn: Record<string, unknown>) {
  const dispatchedAt = new Date().toISOString();
  const dispatchOnce = async () => {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/kids-build-picture-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ ebook_id, stage: 'resume', publish, dispatched_at: dispatchedAt }),
      });
    } catch (e) {
      console.error('selfChain dispatch failed', (e as Error).message);
    }
  };
  const task = (async () => {
    await persistJob(db, ebook_id, scorecardIn, { next_dispatched_at: dispatchedAt });
    await dispatchOnce();
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const { data } = await db.from('ebooks_kids').select('qc_scorecard').eq('id', ebook_id).single();
      const qc = (data?.qc_scorecard ?? {}) as Record<string, unknown>;
      const job = (((qc.repair_log as Record<string, unknown> | undefined)?.pdf_repair_job as Record<string, unknown> | undefined) ?? {});
      const acked = (job.acked_at as string | undefined) ?? '';
      if (!acked || acked < dispatchedAt) {
        console.warn(`[build-picture-pdf] chain ack missing after 5s (acked=${acked}); double-tapping ebook=${ebook_id}`);
        await dispatchOnce();
      }
    } catch (e) {
      console.warn('selfChain ack check failed', (e as Error).message);
    }
  })();
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(task); else void task;
}

async function chainQcAndPublish(ebook_id: string, publish: boolean) {
  await fetch(`${SUPABASE_URL}/functions/v1/kids-publish-if-qc-passed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ ebook_id, publish }),
  });
}

function isDeterministicGateFailure(msg: string): boolean {
  return /cover_dead_image_gate|dead_page_gate|text_mapping_gate|PDF_WRONG_TRIM|PDF_PAGE_COUNT_OUT_OF_RANGE|FAKE_PDF_MIME_TYPE|INVALID_PDF|MISSING_PAGE/i.test(msg);
}

function dispatchSupervisorForGate(ebook_id: string, error: string) {
  const task = fetch(`${SUPABASE_URL}/functions/v1/kids-repair-supervisor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ ebook_id, source: 'kids-build-picture-pdf', async: true, gate_error: error }),
  }).then((r) => r.text()).catch((e) => console.error('pdf gate supervisor dispatch failed', e));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(task); else void task;
}

async function fetchImage(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`image fetch ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// Downscale to ≤1024px and re-encode as JPEG q80. Cuts embedded stream size
// ~70% vs full PNG with no visible quality loss on a 612pt (8.5") square page.
async function toJpegBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const img = await Image.decode(bytes);
  const maxSide = Math.max(img.width, img.height);
  if (maxSide > MAX_INTERIOR_PX) {
    const scale = MAX_INTERIOR_PX / maxSide;
    img.resize(Math.round(img.width * scale), Math.round(img.height * scale));
  }
  return await img.encodeJPEG(JPEG_QUALITY);
}

// Figure out where we are: pages_done (preferred), else last_result.range[1],
// else 0. Determines whether we're on prepare / an interior batch / finalize.
function resolvePosition(job: Record<string, unknown> | null, requestedStage: string | undefined) {
  const pagesDoneRaw = job?.pages_done as number | undefined;
  const rangeEnd = ((job?.last_result as { range?: [number, number] } | undefined)?.range?.[1]) as number | undefined;
  const pagesDone = Number.isFinite(pagesDoneRaw as number)
    ? Number(pagesDoneRaw)
    : (Number.isFinite(rangeEnd as number) ? Number(rangeEnd) : 0);
  const prepared = Boolean(job?.prepared) || pagesDone > 0;
  const finalized = Boolean(job?.finalized);
  // Requested override — explicit stage forces that lane (rare).
  if (requestedStage && requestedStage !== 'resume') {
    if (requestedStage === 'pdf_prepare') return { lane: 'prepare' as const, pages_done: 0 };
    if (requestedStage === 'pdf_finalize') return { lane: 'finalize' as const, pages_done: pagesDone };
    return { lane: 'interior' as const, pages_done: pagesDone };
  }
  if (finalized) return { lane: 'done' as const, pages_done: pagesDone };
  if (!prepared) return { lane: 'prepare' as const, pages_done: 0 };
  return { lane: 'interior' as const, pages_done: pagesDone };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  let ebook_id = '';
  let scorecard: Record<string, unknown> = {};
  try {
    const body = await req.json();
    ebook_id = body.ebook_id;
    const publish: boolean = body.publish !== false;
    const runQcAfter: boolean = body.run_qc_after !== false;
    const requestedStage: string | undefined = body.stage;
    if (!ebook_id) return json({ ok: false, error: 'ebook_id required' }, 400);

    const { data: ebook, error } = await db.from('ebooks_kids').select(
      'id, title, subtitle, cover_url, interior_illustrations, manuscript_md, qc_scorecard, storefront_meta',
    ).eq('id', ebook_id).single();
    if (error || !ebook) return json({ ok: false, error: 'ebook not found' }, 404);

    // Handoff ack: mark that this child actually started so the parent's
    // double-tap retry can skip. Covers both intra-stage self-chain (writes
    // pdf_repair_job.acked_at) and cross-function handoff from render-interior
    // (writes pdf_handoff.acked_at). Fire-and-forget.
    {
      const ackedAt = new Date().toISOString();
      const scIn = (ebook.qc_scorecard as Record<string, unknown> | null) ?? {};
      void persistJob(db, ebook_id, scIn, { acked_at: ackedAt });
      if (requestedStage === 'pdf_prepare') {
        const h = (scIn.pdf_handoff as Record<string, unknown> | undefined) ?? {};
        void db.from('ebooks_kids').update({
          qc_scorecard: { ...scIn, pdf_handoff: { ...h, acked_at: ackedAt } },
        }).eq('id', ebook_id);
      }
    }

    const allRecs: Array<{ url: string; scene?: string }> = Array.isArray(ebook.interior_illustrations)
      ? (ebook.interior_illustrations as Array<{ url: string; scene?: string }>) : [];
    if (allRecs.length < MIN_INTERIOR) {
      return json({ ok: false, error: `need ${MIN_INTERIOR} interior pages, have ${allRecs.length}` }, 400);
    }
    if (!ebook.cover_url) return json({ ok: false, error: 'cover_url missing' }, 400);

    const recs = allRecs.slice(0, MAX_INTERIOR);
    const numStoryPages = recs.length;

    // KILLER 2: prefer structured segments (1:1 with story pages). The legacy
    // splitter is kept only as a safety net for pre-segment books.
    const segs = loadSegments(ebook as Record<string, unknown>);
    let rawCaptions: string[];
    let captionsSource: 'segments' | 'splitter';
    if (segs && segs.pages.length >= numStoryPages) {
      rawCaptions = segmentsToPageTexts(segs).slice(0, numStoryPages);
      captionsSource = 'segments';
    } else {
      rawCaptions = splitManuscriptForSpreads(String(ebook.manuscript_md ?? ''), numStoryPages);
      captionsSource = 'splitter';
    }
    // Safety net: this should never fire on segmented books.
    const badIdx: number[] = [];
    rawCaptions.forEach((c, i) => { if (isPlaceholderCaption(c)) badIdx.push(i); });
    if (badIdx.length) {
      throw new Error(`text_mapping_gate[${captionsSource}]: ${badIdx.length} pages have empty/placeholder captions (indices ${badIdx.slice(0,5).join(',')}${badIdx.length>5?'…':''}). Manuscript has ${rawCaptions.filter(c=>c && c.trim()).length}/${numStoryPages} usable segments — repair manuscript before assembly.`);
    }
    const captions = rawCaptions;
    console.log(`[build-picture-pdf] captions source=${captionsSource} pages=${numStoryPages}`);

    scorecard = (ebook.qc_scorecard as Record<string, unknown> | null) ?? {};
    const job = ((scorecard.repair_log as Record<string, unknown> | undefined)?.pdf_repair_job ?? null) as Record<string, unknown> | null;

    // Gate 1 (cover splice): if the cover bytes changed since the in-progress
    // PDF was prepared, discard it and rebuild from prepare so the current
    // cover ends up on page 1.
    const currentCoverBytes = await fetchImage(ebook.cover_url as string);
    const currentCoverHash = await sha256Hex(currentCoverBytes);
    const priorCoverHash = (job?.cover_bytes_hash as string | undefined) ?? null;

    // Auto-heal: if we thought we were mid-interior but the file is gone, restart.
    let pos = resolvePosition(job, requestedStage);
    if (pos.lane !== 'prepare') {
      const exists = await db.storage.from('ebook-pdfs').download(INPROGRESS_PATH(ebook_id));
      if (exists.error || !exists.data) {
        console.warn(`kids-build-picture-pdf: lane=${pos.lane} but no in-progress pdf; restarting from prepare`);
        pos = { lane: 'prepare', pages_done: 0 };
      } else if (priorCoverHash && priorCoverHash !== currentCoverHash) {
        console.warn(`kids-build-picture-pdf: cover changed (${priorCoverHash?.slice(0,8)} -> ${currentCoverHash.slice(0,8)}); rebuilding from prepare to splice new cover`);
        try { await db.storage.from('ebook-pdfs').remove([INPROGRESS_PATH(ebook_id)]); } catch { /* ignore */ }
        pos = { lane: 'prepare', pages_done: 0 };
      }
    }

    // Compute stage label + range for logging/persistence.
    let stageLabel: string;
    let range: [number, number] | null = null;
    if (pos.lane === 'prepare') stageLabel = 'pdf_prepare';
    else if (pos.lane === 'finalize' || pos.pages_done >= numStoryPages) {
      stageLabel = 'pdf_finalize';
      pos = { lane: 'finalize', pages_done: pos.pages_done };
    } else {
      const start = pos.pages_done;
      const end = Math.min(start + PER_STAGE, numStoryPages);
      range = [start, end];
      const batchIndex = Math.floor(start / PER_STAGE) + 1;
      stageLabel = `pdf_pages_${batchIndex}`;
    }

    // HEARTBEAT — record the attempt before the heavy work.
    await persistJob(db, ebook_id, scorecard, {
      ebook_id,
      attempt_at: new Date().toISOString(),
      attempt_stage: stageLabel,
      attempt_range: range,
      total_story_pages: numStoryPages,
      pages_done: pos.pages_done,
      per_stage: PER_STAGE,
      error: null,
      started_at: (job?.started_at as string | undefined) ?? new Date().toISOString(),
    });

    let stageResult: Record<string, unknown> = {};
    let newPagesDone = pos.pages_done;
    let finalized = false;

    if (pos.lane === 'prepare') {
      // Gate 2: cover must be a real image, not a dead / near-monochrome tile.
      const coverLum = await computeLuminance(currentCoverBytes);
      if (coverLum.dead) {
        throw new Error(`cover_dead_image_gate: cover is ${coverLum.reason} (mean=${coverLum.mean.toFixed(1)}, var=${coverLum.variance.toFixed(0)}). Regenerate cover before assembly.`);
      }
      const bytes = await startPicturePdf({
        title: String(ebook.title ?? ''),
        subtitle: (ebook.subtitle as string | null) ?? null,
        coverPng: currentCoverBytes,
      });
      await writeInprogress(db, ebook_id, bytes);
      stageResult = { pdf_size: bytes.length, pages_added: 3, format: 'square_612', cover_bytes_hash: currentCoverHash, cover_luminance: coverLum };
    } else if (pos.lane === 'finalize') {
      const existing = await readInprogress(db, ebook_id);
      const bytes = await finalizePicturePdf(existing);
      if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
        throw new Error('PDF byte validation failed (%PDF- missing)');
      }
      const up = await db.storage.from('ebook-pdfs').upload(FINAL_PATH(ebook_id), bytes, {
        contentType: 'application/pdf', upsert: true,
      });
      if (up.error) throw up.error;
      const { data: signed } = await db.storage.from('ebook-pdfs').createSignedUrl(FINAL_PATH(ebook_id), 60 * 60 * 24 * 365);
      const pageCount = 3 + numStoryPages + 1;
      await db.from('ebooks_kids').update({
        pdf_url: signed?.signedUrl ?? null, page_count: pageCount,
      }).eq('id', ebook_id);
      try { await db.storage.from('ebook-pdfs').remove([INPROGRESS_PATH(ebook_id)]); } catch { /* ignore */ }
      stageResult = { pdf_size: bytes.length, page_count: pageCount, pdf_url: signed?.signedUrl ?? null, format: 'square_612', cover_bytes_hash: currentCoverHash };
      finalized = true;
    } else {
      // Interior batch — fetch, downscale to JPEG, embed, save.
      const [start, end] = range!;
      const slice = recs.slice(start, end);
      const spreads: Array<{ caption: string; imagePng: Uint8Array }> = [];
      const deadPages: Array<{ index: number; reason: string; mean: number; variance: number }> = [];
      for (let i = 0; i < slice.length; i++) {
        const abs = start + i;
        const raw = await fetchImage(slice[i].url);
        // Gate 2 (dead-page): fail hard on solid black/white/gray interiors.
        const lum = await computeLuminance(raw);
        if (lum.dead) {
          deadPages.push({ index: abs, reason: lum.reason ?? 'dead', mean: lum.mean, variance: lum.variance });
        }
        const jpeg = await toJpegBytes(raw);
        spreads.push({ caption: captions[abs], imagePng: jpeg });
      }
      if (deadPages.length) {
        throw new Error(`dead_page_gate: ${deadPages.length} dead page(s) in batch ${range![0]}..${range![1]}: ${JSON.stringify(deadPages)}`);
      }
      const existing = await readInprogress(db, ebook_id);
      const bytes = await appendSpreadsToPdf(existing, spreads);
      await writeInprogress(db, ebook_id, bytes);
      newPagesDone = end;
      stageResult = { pdf_size: bytes.length, pages_added: spreads.length, range: [start, end], encoding: 'jpeg_q80_1024' };
    }

    const nextLane = finalized ? 'done' : (newPagesDone >= numStoryPages ? 'finalize' : 'interior');
    const nextStageLabel = nextLane === 'done' ? null
      : nextLane === 'finalize' ? 'pdf_finalize'
      : `pdf_pages_${Math.floor(newPagesDone / PER_STAGE) + 1}`;

    await persistJob(db, ebook_id, scorecard, {
      stage: stageLabel,
      last_result: stageResult,
      next_stage: nextStageLabel,
      pages_done: newPagesDone,
      prepared: pos.lane === 'prepare' ? true : (Boolean(job?.prepared) || newPagesDone > 0),
      finalized,
      total_story_pages: numStoryPages,
      per_stage: PER_STAGE,
      // Persist cover hash on prepare so future runs can detect a regenerated
      // cover and rebuild page 1 (Gate 1).
      cover_bytes_hash: pos.lane === 'prepare' ? currentCoverHash : (job?.cover_bytes_hash ?? currentCoverHash),
      error: null,
    });

    if (nextLane !== 'done') {
      selfChainDoubleTap(db, ebook_id, publish, scorecard);
      return json({ ok: true, stage: stageLabel, next_stage: nextStageLabel, result: stageResult });
    }

    if (runQcAfter) {
      // @ts-expect-error EdgeRuntime
      EdgeRuntime.waitUntil(chainQcAndPublish(ebook_id, publish));
    }
    return json({ ok: true, stage: stageLabel, next_stage: null, result: stageResult, qc_dispatched: runQcAfter });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 500);
    console.error('kids-build-picture-pdf error', e);
    // Persist failure to job so silent deaths become visible.
    if (ebook_id) {
      try {
        await persistJob(db, ebook_id, scorecard, {
          error: msg, failed_at: new Date().toISOString(),
        });
      } catch { /* ignore persistence failures */ }
      if (isDeterministicGateFailure(msg)) dispatchSupervisorForGate(ebook_id, msg);
    }
    return json({ ok: false, error: msg }, 500);
  }
});
