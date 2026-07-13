// Multi-stage kids picture-book PDF builder.
//
// Splits PDF assembly into 5 small stages so a single Edge worker never has
// to hold cover + 12 interior PNGs + full pdf-lib doc in memory at once.
// Stages (each is one HTTP invocation; the function self-chains via
// EdgeRuntime.waitUntil until finalize):
//   1. pdf_prepare      -> cover + title pages   -> book-inprogress.pdf
//   2. pdf_pages_1_4    -> interior pages 1..4   -> book-inprogress.pdf
//   3. pdf_pages_5_8    -> interior pages 5..8   -> book-inprogress.pdf
//   4. pdf_pages_9_12   -> interior pages 9..12  -> book-inprogress.pdf
//   5. pdf_finalize     -> add "The End", promote to book.pdf, set pdf_url
//
// Progress is persisted at qc_scorecard.repair_log.pdf_repair_job.
// Idempotent: safe to resume any stage.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  startPicturePdf,
  appendSpreadsToPdf,
  finalizePicturePdf,
  splitManuscriptForSpreads,
} from '../_shared/kids-picture-pdf.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const INPROGRESS_PATH = (id: string) => `kids/${id}/book-inprogress.pdf`;
const FINAL_PATH = (id: string) => `kids/${id}/book.pdf`;

type Stage =
  | 'pdf_prepare'
  | 'pdf_pages_1_4'
  | 'pdf_pages_5_8'
  | 'pdf_pages_9_12'
  | 'pdf_finalize';

const NEXT_STAGE: Record<Stage, Stage | null> = {
  pdf_prepare: 'pdf_pages_1_4',
  pdf_pages_1_4: 'pdf_pages_5_8',
  pdf_pages_5_8: 'pdf_pages_9_12',
  pdf_pages_9_12: 'pdf_finalize',
  pdf_finalize: null,
};

const VALID_STAGES = new Set<Stage>([
  'pdf_prepare', 'pdf_pages_1_4', 'pdf_pages_5_8', 'pdf_pages_9_12', 'pdf_finalize',
]);

function resolveStage(requested: string | undefined, scorecard: Record<string, unknown>): Stage {
  if (requested && requested !== 'resume' && VALID_STAGES.has(requested as Stage)) {
    return requested as Stage;
  }
  const job = ((scorecard.repair_log as Record<string, unknown> | undefined)?.pdf_repair_job ?? null) as
    { stage?: Stage; next_stage?: Stage | null } | null;
  if (job?.next_stage && VALID_STAGES.has(job.next_stage)) return job.next_stage;
  if (job?.stage && VALID_STAGES.has(job.stage) && NEXT_STAGE[job.stage]) return NEXT_STAGE[job.stage]!;
  return 'pdf_prepare';
}

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
async function persistJob(db: any, ebook_id: string, scorecard: Record<string, unknown> | null, patch: Record<string, unknown>) {
  const base = (scorecard ?? {}) as Record<string, unknown>;
  const log = ((base.repair_log ?? {}) as Record<string, unknown>);
  const job = ((log.pdf_repair_job ?? {}) as Record<string, unknown>);
  const next = { ...job, ...patch, updated_at: new Date().toISOString() };
  await db.from('ebooks_kids').update({
    qc_scorecard: { ...base, repair_log: { ...log, pdf_repair_job: next } },
  }).eq('id', ebook_id);
  return next;
}

async function selfChain(nextStage: Stage, ebook_id: string, publish: boolean) {
  await fetch(`${SUPABASE_URL}/functions/v1/kids-build-picture-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ ebook_id, stage: nextStage, publish }),
  });
}

async function chainQcAndPublish(ebook_id: string, publish: boolean) {
  await fetch(`${SUPABASE_URL}/functions/v1/kids-publish-if-qc-passed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ ebook_id, publish }),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json();
    const ebook_id: string = body.ebook_id;
    const publish: boolean = body.publish !== false;
    const runQcAfter: boolean = body.run_qc_after !== false;
    if (!ebook_id) return json({ ok: false, error: 'ebook_id required' }, 400);

    const { data: ebook, error } = await db.from('ebooks_kids').select(
      'id, title, subtitle, cover_url, interior_illustrations, manuscript_md, qc_scorecard',
    ).eq('id', ebook_id).single();
    if (error || !ebook) return json({ ok: false, error: 'ebook not found' }, 404);

    const recs: Array<{ url: string; scene?: string }> = Array.isArray(ebook.interior_illustrations)
      ? (ebook.interior_illustrations as Array<{ url: string; scene?: string }>) : [];
    if (recs.length < 12) return json({ ok: false, error: `need 12 interiors, have ${recs.length}` }, 400);
    if (!ebook.cover_url) return json({ ok: false, error: 'cover_url missing' }, 400);

    // Manuscript captions split once, referenced by page index.
    const captions = splitManuscriptForSpreads(String(ebook.manuscript_md ?? ''), recs.length)
      .map((c, i) => c || recs[i].scene || `Page ${i + 1}`);

    const scorecard = (ebook.qc_scorecard as Record<string, unknown> | null) ?? {};

    let stage: Stage = resolveStage(body.stage as string | undefined, scorecard);
    if (stage !== 'pdf_prepare') {
      const exists = await db.storage.from('ebook-pdfs').download(INPROGRESS_PATH(ebook_id));
      if (exists.error || !exists.data) {
        console.warn(`kids-build-picture-pdf: resolved stage ${stage} but no in-progress pdf exists for ${ebook_id}; restarting from pdf_prepare`);
        stage = 'pdf_prepare';
      }
    }

    async function fetchImage(url: string): Promise<Uint8Array> {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`image fetch ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    }

    let stageResult: Record<string, unknown> = {};

    if (stage === 'pdf_prepare') {
      const coverBytes = await fetchImage(ebook.cover_url as string);
      const bytes = await startPicturePdf({
        title: String(ebook.title ?? ''),
        subtitle: (ebook.subtitle as string | null) ?? null,
        coverPng: coverBytes,
      });
      await writeInprogress(db, ebook_id, bytes);
      stageResult = { pdf_size: bytes.length, pages_added: 2 };
    } else if (stage === 'pdf_pages_1_4' || stage === 'pdf_pages_5_8' || stage === 'pdf_pages_9_12') {
      const range: Record<Stage, [number, number]> = {
        pdf_prepare: [0, 0], pdf_finalize: [0, 0],
        pdf_pages_1_4: [0, 4], pdf_pages_5_8: [4, 8], pdf_pages_9_12: [8, 12],
      };
      const [start, end] = range[stage];
      const slice = recs.slice(start, end);
      const spreads: Array<{ caption: string; imagePng: Uint8Array }> = [];
      for (let i = 0; i < slice.length; i++) {
        const abs = start + i;
        spreads.push({ caption: captions[abs], imagePng: await fetchImage(slice[i].url) });
      }
      const existing = await readInprogress(db, ebook_id);
      const bytes = await appendSpreadsToPdf(existing, spreads);
      await writeInprogress(db, ebook_id, bytes);
      stageResult = { pdf_size: bytes.length, pages_added: spreads.length, range: [start, end] };
    } else if (stage === 'pdf_finalize') {
      const existing = await readInprogress(db, ebook_id);
      const bytes = await finalizePicturePdf(existing);
      // Byte validation.
      if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
        throw new Error('PDF byte validation failed (%PDF- missing)');
      }
      const up = await db.storage.from('ebook-pdfs').upload(FINAL_PATH(ebook_id), bytes, {
        contentType: 'application/pdf', upsert: true,
      });
      if (up.error) throw up.error;
      const { data: signed } = await db.storage.from('ebook-pdfs').createSignedUrl(FINAL_PATH(ebook_id), 60 * 60 * 24 * 365);
      const pageCount = 2 + recs.length + 1; // cover + title + N + end
      await db.from('ebooks_kids').update({
        pdf_url: signed?.signedUrl ?? null, page_count: pageCount,
      }).eq('id', ebook_id);
      // Clean up in-progress file (best-effort).
      try { await db.storage.from('ebook-pdfs').remove([INPROGRESS_PATH(ebook_id)]); } catch { /* ignore */ }
      stageResult = { pdf_size: bytes.length, page_count: pageCount, pdf_url: signed?.signedUrl ?? null };
    } else {
      return json({ ok: false, error: `unknown stage ${stage}` }, 400);
    }

    const nextStage = NEXT_STAGE[stage];
    const job = await persistJob(db, ebook_id, scorecard, {
      stage, ebook_id, last_result: stageResult, next_stage: nextStage,
      started_at: ((scorecard.repair_log as Record<string, unknown> | undefined)?.pdf_repair_job as Record<string, unknown> | undefined)?.started_at ?? new Date().toISOString(),
    });

    if (nextStage) {
      // @ts-expect-error EdgeRuntime is a Deno Deploy global
      EdgeRuntime.waitUntil(selfChain(nextStage, ebook_id, publish));
      return json({ ok: true, stage, next_stage: nextStage, job, result: stageResult });
    }

    // Finalize path — optionally kick off QC + publish.
    if (runQcAfter) {
      // @ts-expect-error EdgeRuntime
      EdgeRuntime.waitUntil(chainQcAndPublish(ebook_id, publish));
    }
    return json({ ok: true, stage, next_stage: null, job, result: stageResult, qc_dispatched: runQcAfter });
  } catch (e) {
    console.error('kids-build-picture-pdf error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
