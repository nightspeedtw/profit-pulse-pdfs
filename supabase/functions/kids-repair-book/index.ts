// Kids book repair — brings an existing ebook up to sellable standard.
//
// For a given ebook_id, this function:
//   1. Ensures a locked style bible exists (infers from cover + character bible).
//   2. Generates at least 12 interior illustrations if missing.
//   3. Points thumbnail_url at the cover.
//   4. Populates preview_page_urls from the first 3 interiors.
//   5. Rerenders a real picture-book PDF embedding the cover + interiors.
//   6. Runs measured QC.
//   7. Publishes only if measured QC returns sellable=true.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildScenePlan, renderInteriorIllustrations } from '../_shared/kids-interior.ts';
import { buildPicturePdf } from '../_shared/kids-picture-pdf.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

const MIN_INTERIOR = 28; // square picture-book default: 28-36 story pages
const MIN_PREVIEWS = 3;

async function callAI(prompt: string, system: string): Promise<string> {
  const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: `${system}\n\nEnglish only. JSON only. No markdown fences.` },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!r.ok) throw new Error(`ai ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const log: Array<{ step: string; status: string; detail?: unknown }> = [];

  try {
    const { ebook_id, publish_if_sellable = true } = await req.json();
    if (!ebook_id) return json({ ok: false, error: 'ebook_id required' }, 400);

    const { data: ebook } = await db.from('ebooks_kids').select('*').eq('id', ebook_id).single();
    if (!ebook) return json({ ok: false, error: 'ebook not found' }, 404);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bible } = await (db.from('kids_book_bibles') as any).select('*').eq('ebook_id', ebook_id).maybeSingle();
    if (!bible) return json({ ok: false, error: 'no kids_book_bibles row — run cover step first' }, 400);

    // ---------- 1. Style bible ----------
    let styleBible = (bible.style_bible_json ?? {}) as Record<string, unknown>;
    const hasStructure = styleBible && (styleBible.line_quality || styleBible.palette || styleBible.lighting);
    if (!hasStructure) {
      const cb = (bible.character_bible_json ?? {}) as Record<string, string>;
      const raw = await callAI(
        `Lock a style bible for "${ebook.title}". Character bible: ${JSON.stringify(cb)}. Existing hint: ${JSON.stringify(styleBible)}.
Return JSON: {"line_quality":"","palette":["#","#","#","#","#"],"lighting":"","medium":"","mood":"","character_proportions":"","forbidden":["no text","no photorealism"]}`,
        "You are locking a picture-book style bible.",
      );
      styleBible = { ...styleBible, ...JSON.parse(raw), locked_at: new Date().toISOString() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db.from('kids_book_bibles') as any).update({ style_bible_json: styleBible }).eq('ebook_id', ebook_id);
      await db.from('ebooks_kids').update({ style_bible_json: styleBible }).eq('id', ebook_id);
      log.push({ step: 'style_bible', status: 'created' });
    } else {
      log.push({ step: 'style_bible', status: 'already_locked' });
    }

    // ---------- 2. Interior illustrations ----------
    let illos = Array.isArray(ebook.interior_illustrations) ? ebook.interior_illustrations as Array<{ url: string; scene?: string }> : [];
    if (illos.length < MIN_INTERIOR) {
      const cb = (bible.character_bible_json ?? {}) as Record<string, string>;
      const charDesc = [
        cb.name && `named ${cb.name}`,
        cb.species && `(${cb.species})`,
        cb.hair && `${cb.hair} hair`,
        cb.eyes && `${cb.eyes} eyes`,
        cb.skin && `${cb.skin} skin`,
        cb.outfit && `wearing ${cb.outfit}`,
        cb.accessory && `with ${cb.accessory}`,
      ].filter(Boolean).join(', ') || 'the story hero';

      const { data: preset } = await db.from('kids_style_presets')
        .select('prompt_suffix, negative_prompt').eq('slug', bible.style_slug ?? '').maybeSingle();
      const styleParts = [
        preset?.prompt_suffix as string | undefined,
        styleBible.line_quality && `line quality: ${styleBible.line_quality}`,
        styleBible.lighting && `lighting: ${styleBible.lighting}`,
        styleBible.mood && `mood: ${styleBible.mood}`,
        styleBible.medium && `medium: ${styleBible.medium}`,
        Array.isArray(styleBible.palette) && (styleBible.palette as string[]).length
          ? `palette: ${(styleBible.palette as string[]).join(', ')}` : null,
      ].filter(Boolean).join('; ') || "warm whimsical storybook illustration, cozy painterly, soft edges";
      const negativePrompt = (preset?.negative_prompt as string | undefined) ?? 'text, watermark, scary, photorealistic';

      const plan = await buildScenePlan({
        title: String(ebook.title ?? ''),
        manuscript_md: String(ebook.manuscript_md ?? ''),
        min_scenes: MIN_INTERIOR,
      });
      const records = await renderInteriorIllustrations({
        ebookId: ebook_id,
        db,
        characterDescription: charDesc,
        styleSuffix: styleParts,
        negativePrompt,
        scenes: plan.scenes.slice(0, MIN_INTERIOR),
        startPageNumber: 3,
      });
      illos = records;
      await db.from('ebooks_kids').update({ interior_illustrations: records }).eq('id', ebook_id);
      log.push({ step: 'interior', status: 'generated', detail: { count: records.length } });
    } else {
      log.push({ step: 'interior', status: 'already_present', detail: { count: illos.length } });
    }

    // ---------- 3. Thumbnail ----------
    if (!ebook.thumbnail_url && ebook.cover_url) {
      await db.from('ebooks_kids').update({ thumbnail_url: ebook.cover_url }).eq('id', ebook_id);
      log.push({ step: 'thumbnail', status: 'set_from_cover' });
    }

    // ---------- 4. Preview pages ----------
    const previewUrls = illos.map(i => i.url).slice(0, MIN_PREVIEWS);
    if (previewUrls.length >= MIN_PREVIEWS) {
      await db.from('ebooks_kids').update({ preview_page_urls: previewUrls }).eq('id', ebook_id);
      log.push({ step: 'previews', status: 'set', detail: { count: previewUrls.length } });
    }

    // ---------- 5. Rerender picture PDF ----------
    if (!ebook.cover_url) throw new Error('cover_url missing');
    const coverBytes = new Uint8Array(await (await fetch(ebook.cover_url)).arrayBuffer());
    const spreadImages: Uint8Array[] = [];
    for (const il of illos) {
      spreadImages.push(new Uint8Array(await (await fetch(il.url)).arrayBuffer()));
    }
    const md = String(ebook.manuscript_md ?? '');
    const paras = md.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    const chunkSize = Math.max(1, Math.ceil(paras.length / illos.length));
    const captions = illos.map((_, i) => paras.slice(i * chunkSize, (i + 1) * chunkSize).join(' ') || (illos[i].scene ?? ''));

    const pdfBytes = await buildPicturePdf({
      title: String(ebook.title ?? ''),
      subtitle: (ebook.subtitle as string | null) ?? null,
      coverPng: coverBytes,
      spreads: illos.map((_, i) => ({ caption: captions[i], imagePng: spreadImages[i] })),
    });
    const path = `kids/${ebook_id}/book.pdf`;
    const up = await db.storage.from('ebook-pdfs').upload(path, pdfBytes, {
      contentType: 'application/pdf', upsert: true,
    });
    if (up.error) throw up.error;
    const { data: pub } = await db.storage.from('ebook-pdfs').createSignedUrl(path, 60 * 60 * 24 * 365);
    const pageCount = 2 + illos.length + 1;
    await db.from('ebooks_kids').update({
      pdf_url: pub?.signedUrl ?? null,
      page_count: pageCount,
    }).eq('id', ebook_id);
    log.push({ step: 'pdf', status: 'rerendered', detail: { bytes: pdfBytes.length, page_count: pageCount } });

    // ---------- 6. Measured QC (vision + story + preflight) ----------
    async function runQc() {
      const qcRes = await fetch(`${SUPABASE_URL}/functions/v1/kids-qc-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ ebook_id }),
      });
      return { ok: qcRes.ok, body: await qcRes.json() };
    }
    let qc = await runQc();
    log.push({ step: 'qc', status: qc.ok ? 'ok' : 'fail', detail: qc.body });

    // ---------- 6b. Targeted repair — regen up to 3 failing pages ----------
    const vision = qc.body?.vision_report as { pages?: Array<{ index: number; page_number: number; character_match_score: number; protagonist_face_body_score: number; cover_interior_match_score: number; scene?: string }> } | null;
    const failingPages = (vision?.pages ?? []).filter((p) => {
      const pc = Math.round((p.character_match_score + p.protagonist_face_body_score) / 2);
      return pc < 82 || p.cover_interior_match_score < 82;
    });
    if (failingPages.length > 0 && failingPages.length <= 3 && illos.length >= MIN_INTERIOR) {
      const cb = (bible.character_bible_json ?? {}) as Record<string, string>;
      const charDesc = [cb.name && `named ${cb.name}`, cb.species && `(${cb.species})`, cb.outfit && `wearing ${cb.outfit}`, cb.accessory && `with ${cb.accessory}`].filter(Boolean).join(', ') || 'the story hero';
      const styleParts = [styleBible.line_quality && `line quality: ${styleBible.line_quality}`, styleBible.lighting && `lighting: ${styleBible.lighting}`, styleBible.mood && `mood: ${styleBible.mood}`, Array.isArray(styleBible.palette) ? `palette: ${(styleBible.palette as string[]).join(', ')}` : null].filter(Boolean).join('; ') || 'warm whimsical storybook illustration';
      const { renderInteriorIllustrations } = await import('../_shared/kids-interior.ts');
      const regenScenes = failingPages.map((p) => ({ scene: p.scene ?? `Story beat ${p.index}`, emotion: 'warm', setting: 'storybook world' }));
      const regen = await renderInteriorIllustrations({
        ebookId: ebook_id, db, characterDescription: charDesc, styleSuffix: styleParts,
        negativePrompt: 'text, watermark, off-model character, deformed hands',
        scenes: regenScenes, startPageNumber: failingPages[0].page_number,
      });
      // Splice replacements into the illos array by index.
      const updated = [...illos];
      for (let i = 0; i < failingPages.length; i++) {
        const idxInArray = updated.findIndex((x) => (x as { index: number }).index === failingPages[i].index);
        if (idxInArray >= 0) {
          const orig = updated[idxInArray] as Record<string, unknown>;
          updated[idxInArray] = { ...regen[i], index: orig.index as number, page_number: orig.page_number as number };
        }
      }
      illos = updated as typeof illos;
      await db.from('ebooks_kids').update({ interior_illustrations: illos }).eq('id', ebook_id);
      log.push({ step: 'targeted_repair', status: 'regenerated', detail: { count: failingPages.length, pages: failingPages.map((p) => p.page_number) } });

      // Re-render PDF with new spreads.
      const spreadImages2: Uint8Array[] = [];
      for (const il of illos) spreadImages2.push(new Uint8Array(await (await fetch((il as { url: string }).url)).arrayBuffer()));
      const pdfBytes2 = await buildPicturePdf({
        title: String(ebook.title ?? ''), subtitle: (ebook.subtitle as string | null) ?? null,
        coverPng: coverBytes,
        spreads: illos.map((_, i) => ({ caption: captions[i], imagePng: spreadImages2[i] })),
      });
      const up2 = await db.storage.from('ebook-pdfs').upload(path, pdfBytes2, { contentType: 'application/pdf', upsert: true });
      if (up2.error) throw up2.error;
      const { data: pub2 } = await db.storage.from('ebook-pdfs').createSignedUrl(path, 60 * 60 * 24 * 365);
      await db.from('ebooks_kids').update({ pdf_url: pub2?.signedUrl ?? null }).eq('id', ebook_id);

      qc = await runQc();
      log.push({ step: 'qc_rerun', status: qc.ok ? 'ok' : 'fail', detail: qc.body });
    } else if (failingPages.length > 3) {
      log.push({ step: 'targeted_repair', status: 'skipped_too_many_failures', detail: { count: failingPages.length } });
    }

    const qcBody = qc.body;
    let publishState = 'not_attempted';
    if (publish_if_sellable && qcBody?.verdict?.sellable) {
      await db.from('ebooks_kids').update({
        listing_status: 'live', status: 'live', pipeline_status: 'published',
      }).eq('id', ebook_id);
      publishState = 'live';
    } else if (qcBody?.verdict?.sellable) {
      publishState = 'sellable_but_publish_skipped';
    } else {
      publishState = 'draft_needs_review';
      await db.from('ebooks_kids').update({
        listing_status: 'draft', status: 'needs_revision', pipeline_status: 'human_review_required',
      }).eq('id', ebook_id);
    }
    log.push({ step: 'publish', status: publishState });

    const { data: final } = await db.from('ebooks_kids').select(
      'cover_url, pdf_url, thumbnail_url, preview_page_urls, interior_illustrations, page_count, sellable, overall_qc_score, listing_status, pipeline_status, qc_scorecard',
    ).eq('id', ebook_id).single();

    return json({ ok: true, ebook_id, log, final, verdict: qcBody?.verdict ?? null });
  } catch (e) {
    console.error('kids-repair-book error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e), log }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
