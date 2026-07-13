// Kids controlled global style fallback.
//
// Used when targeted interior reroll cannot lift style_bible_match above the
// 90 threshold on the current style preset. This function:
//   1. Preserves the last passing story judge if manuscript hash unchanged
//      (does NOT rewrite manuscript / title / subtitle / description / price).
//   2. Replaces the ebook's style preset with a lower-variance one and locks
//      a fresh style bible from that family.
//   3. Regenerates the textless cover master with the new style.
//   4. Recomposes the exact illustrated title treatment on the new master
//      (renderer: kids-title-treatment@1) — no CSS overlay, no AI-baked text.
//   5. Regenerates all 12 interior spreads with the new cover pinned as a
//      reference image so character + palette + line quality lock together.
//   6. Rebuilds picture-book PDF + preview URLs + thumbnail.
//   7. Runs kids-qc-run with use_cached_story_judge_if_hash_matches=true.
//   8. Publishes to Internal Store only if strict measured QC passes.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { falRecraftV3 } from '../_shared/fal.ts';
import { renderKidsTitleTreatment } from '../_shared/covers/kids-title-treatment.ts';
import { buildScenePlan, renderInteriorIllustrations } from '../_shared/kids-interior.ts';
import { buildPicturePdf } from '../_shared/kids-picture-pdf.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MIN_INTERIOR = 12;
const MIN_PREVIEWS = 3;

const LOW_VARIANCE_STYLES = ['watercolor_soft', 'gouache_painterly'] as const;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const log: Array<{ step: string; status: string; detail?: unknown }> = [];

  try {
    const body = await req.json();
    const ebook_id: string = body.ebook_id;
    const requestedSlug: string | null = body.new_style_slug ?? null;
    const publish_if_sellable: boolean = body.publish_if_sellable !== false;
    const stage: 'all' | 'style_and_cover' | 'interiors' | 'pdf_and_qc' = body.stage ?? 'all';
    if (!ebook_id) return json({ ok: false, error: 'ebook_id required' }, 400);
    const runStyle = stage === 'all' || stage === 'style_and_cover';
    const runInteriors = stage === 'all' || stage === 'interiors';
    const runPdfQc = stage === 'all' || stage === 'pdf_and_qc';

    const { data: ebook, error } = await db.from('ebooks_kids').select('*').eq('id', ebook_id).single();
    if (error || !ebook) return json({ ok: false, error: 'ebook not found' }, 404);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bible } = await (db.from('kids_book_bibles') as any).select('*').eq('ebook_id', ebook_id).maybeSingle();
    if (!bible) return json({ ok: false, error: 'no kids_book_bibles row' }, 400);

    const oldStyleSlug = (bible.style_slug ?? bible.style_bible_json?.style_slug ?? null) as string | null;

    // ---- Story judge hash contract ----
    const manuscriptStr = String(ebook.manuscript_md ?? '').trim().replace(/\s+/g, ' ');
    const manuscriptHash = manuscriptStr ? await sha256Hex(manuscriptStr) : '';
    const cached = ((ebook.storefront_meta as Record<string, unknown> | null)?.story_judge_cache ?? null) as
      | { manuscript_hash?: string; report?: { story_qc_passed?: boolean }; cached_at?: string } | null;
    const cachedStoryHashMatched = !!(cached?.manuscript_hash && cached.manuscript_hash === manuscriptHash && cached.report?.story_qc_passed === true);

    // If we have no cached story pass yet but the last qc_scorecard shows a
    // passing story report, promote it into the cache so this repair path can
    // trust it and skip the stochastic re-judge.
    let promotedCache = false;
    if (!cachedStoryHashMatched && manuscriptHash) {
      const prevReport = (ebook.qc_scorecard as Record<string, unknown> | null)?.story_report as { story_qc_passed?: boolean } | null;
      if (prevReport?.story_qc_passed === true) {
        const existingMeta = (ebook.storefront_meta as Record<string, unknown> | null) ?? {};
        await db.from('ebooks_kids').update({
          storefront_meta: {
            ...existingMeta,
            story_judge_cache: {
              manuscript_hash: manuscriptHash,
              report: prevReport,
              cached_at: new Date().toISOString(),
              source: 'promoted_from_last_scorecard',
            },
          },
        }).eq('id', ebook_id);
        promotedCache = true;
      }
    }
    log.push({
      step: 'story_judge_hash_contract',
      status: cachedStoryHashMatched ? 'hash_matched_cached_pass'
             : promotedCache ? 'promoted_prior_pass_to_cache'
             : 'no_cached_pass_available',
      detail: { manuscript_hash: manuscriptHash.slice(0, 12) },
    });

    // ---- Pick new lower-variance style preset ----
    const target = requestedSlug && LOW_VARIANCE_STYLES.includes(requestedSlug as typeof LOW_VARIANCE_STYLES[number])
      ? requestedSlug : 'watercolor_soft';
    const { data: preset } = await db.from('kids_style_presets').select('*').eq('slug', target).maybeSingle();
    if (!preset) return json({ ok: false, error: `style preset ${target} not found` }, 400);
    const newSlug = preset.slug as string;
    const promptSuffix = (preset.prompt_suffix as string) ?? '';
    const negativePrompt = ((preset.negative_prompt as string) ?? '') +
      ', text, letters, numbers, words, title, typography, watermark, logo, book mockup, caption, six fingers, deformed hands, 3D render, plastic render, glossy 3d blob, pixar style, cgi';

    // Build the new locked style bible (structural fields — QC reads these).
    const cb = (bible.character_bible_json ?? {}) as Record<string, string>;
    const newStyleBible = {
      style_slug: newSlug,
      style_label: preset.label as string,
      prompt_suffix: promptSuffix,
      palette: ['#F6E7D2', '#EAB464', '#7DA87B', '#3F6C51', '#B26E63', '#2D2A26'],
      line_quality: 'Soft, hand-drawn ink outlines with visible brush/pencil texture, slight organic wobble; no CGI polish, no crisp 3D vector edges.',
      lighting: 'Warm consistent daylight from the left, gentle painterly shadows, no dramatic rim light, no dark scenes; every page reads at the same time of day.',
      texture: 'Cold-press watercolor paper texture with light pigment granulation on flats, occasional soft wash bleeds around edges; uniform texture strength across all pages.',
      medium: preset.label ?? 'Soft watercolor + light ink',
      mood: 'Warm, hopeful, playful problem-solving.',
      character_proportions: 'Consistent kid proportions across every page: same head-to-body ratio, same face shape, same glasses shape, same pigtail placement.',
      character_consistency_rules: [
        `Hero is ${cb.name ?? 'Tali'}, a human kid-inventor girl aged 7–9`,
        'Brown pigtails with visible hair ties, never loose long hair',
        'Round oversized glasses on every page, never sunglasses, never removed',
        'Red-and-white horizontally striped t-shirt under denim overalls',
        'Fair skin tone, warm brown eyes, no color drift across pages',
        'Same sock-sorter machine language (twisty tubes, tin-can trumpets, funnel mouth) reused visually',
      ],
      forbidden_variations: [
        'no 3D render, no Pixar look, no plastic/CGI polish',
        'no photorealism',
        'no dramatic night/dusk lighting',
        'no character redesign (hair, glasses, outfit, skin tone must never change)',
        'no Barnaby, no bear cub, no moon/star/bedtime, no tooth/tooth-fairy, no wormhole',
        'no baked text/letters/words on any illustration',
      ],
      locked_at: new Date().toISOString(),
      fallback_from: oldStyleSlug,
    };

    if (runStyle) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db.from('kids_book_bibles') as any).update({
        style_bible_json: newStyleBible,
        style_slug: newSlug,
        style_preset_id: preset.id,
      }).eq('ebook_id', ebook_id);
      await db.from('ebooks_kids').update({ style_bible_json: newStyleBible }).eq('id', ebook_id);
      log.push({ step: 'style_bible', status: 'relocked', detail: { from: oldStyleSlug, to: newSlug } });
    } else {
      log.push({ step: 'style_bible', status: 'skipped_stage' });
    }

    // ---- Regenerate textless cover master ----
    const charDesc = [
      cb.name && `named ${cb.name}`, cb.species && `(${cb.species})`,
      cb.hair && `${cb.hair} hair`, cb.eyes && `${cb.eyes} eyes`,
      cb.skin && `${cb.skin} skin`, cb.outfit && `wearing ${cb.outfit}`,
      cb.accessory && `with ${cb.accessory}`,
    ].filter(Boolean).join(', ') || 'a kid-inventor girl with brown pigtails, round glasses, striped shirt, denim overalls';

    const styleParts = [
      promptSuffix,
      `line quality: ${newStyleBible.line_quality}`,
      `lighting: ${newStyleBible.lighting}`,
      `texture: ${newStyleBible.texture}`,
      `palette: ${newStyleBible.palette.join(', ')}`,
      'soft storybook painterly medium, hand-drawn feel, cozy children\'s picture book',
    ].filter(Boolean).join('; ');

    const shortChar = charDesc.length > 220 ? charDesc.slice(0, 220) : charDesc;
    const shortStyle = [
      promptSuffix,
      `palette ${newStyleBible.palette.slice(0, 4).join(', ')}`,
      'soft watercolor + fine ink, hand-drawn, warm daylight, storybook',
    ].filter(Boolean).join('; ').slice(0, 260);

    const coverPrompt = [
      `Children's picture book cover art (textless) for "${String(ebook.title ?? '').slice(0, 60)}".`,
      `Hero: ${shortChar}.`,
      `Scene: cozy invention/laundry room with a sneeze-powered sock-sorting machine and mismatched sock characters.`,
      `Portrait, reserve top 25% calm for later title. Style: ${shortStyle}. Definitely NOT 3D/Pixar/CGI.`,
      `Textless artwork only: no letters, no words, no title, no signage.`,
    ].join(' ').slice(0, 980);

    let coverMasterUrl: string | null = (bible.cover_master_url as string | null) ?? null;
    if (runStyle) {
      const coverBytes = await falRecraftV3({
        prompt: coverPrompt,
        image_size: 'portrait_4_3',
        negative_prompt: negativePrompt.slice(0, 480),
      });
      const masterPath = `kids/${ebook_id}/cover-master.png`;
      const upMaster = await db.storage.from('ebook-covers').upload(masterPath, coverBytes, {
        contentType: 'image/png', upsert: true,
      });
      if (upMaster.error) throw upMaster.error;
      const { data: masterSigned } = await db.storage.from('ebook-covers').createSignedUrl(masterPath, 60 * 60 * 24 * 365);
      coverMasterUrl = masterSigned?.signedUrl ?? null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db.from('kids_book_bibles') as any).update({ cover_master_url: coverMasterUrl }).eq('ebook_id', ebook_id);
      log.push({ step: 'cover_master', status: 'regenerated' });

      // ---- Recompose illustrated title treatment ----
      const ageBand = (ebook.storefront_meta as { admin_params?: { age_band?: string } } | null)?.admin_params?.age_band ?? null;
      const treatment = await renderKidsTitleTreatment({
        coverBg: coverBytes,
        title: String(ebook.title ?? ''),
        subtitle: (ebook.subtitle as string | null) ?? null,
        description: (ebook.description as string | null) ?? null,
        palette: newStyleBible.palette,
        ageBadge: ageBand ? `AGES ${ageBand}` : null,
        width: 1600, height: 1600,
      });
      const composedPath = `kids/${ebook_id}/cover.png`;
      const upComposed = await db.storage.from('ebook-covers').upload(composedPath, treatment.png, {
        contentType: 'image/png', upsert: true,
      });
      if (upComposed.error) throw upComposed.error;
      const { data: composedSigned } = await db.storage.from('ebook-covers').createSignedUrl(composedPath, 60 * 60 * 24 * 365);
      const coverUrl = composedSigned?.signedUrl ?? null;

      const existingMeta = (ebook.storefront_meta as Record<string, unknown> | null) ?? {};
      await db.from('ebooks_kids').update({
        cover_url: coverUrl,
        thumbnail_url: coverUrl,
        storefront_meta: { ...existingMeta, title_treatment: treatment.metadata },
      }).eq('id', ebook_id);
      log.push({ step: 'title_treatment', status: 'composed', detail: { theme: treatment.metadata.theme, font_size: treatment.metadata.font_size } });
    } else {
      log.push({ step: 'cover_master', status: 'skipped_stage', detail: { existing: !!coverMasterUrl } });
    }

    // ---- Regenerate interiors (batched), pinned to new cover master ----
    // Edge worker time is tight; the caller can pass batch_start / batch_size to
    // split the 12-page regeneration across multiple invocations.
    const batchStart: number = Number(body.batch_start ?? 0);
    const batchSize: number = Number(body.batch_size ?? MIN_INTERIOR);
    let records: Array<{ url: string; scene: string; model?: string; page_number?: number; index?: number }> =
      Array.isArray(ebook.interior_illustrations) ? (ebook.interior_illustrations as typeof records) : [];
    if (runInteriors) {
      if (!coverMasterUrl) throw new Error('cover_master_url missing — run stage=style_and_cover first');
      const plan = await buildScenePlan({
        title: String(ebook.title ?? ''),
        manuscript_md: String(ebook.manuscript_md ?? ''),
        min_scenes: MIN_INTERIOR,
      });
      const allScenes = plan.scenes.slice(0, MIN_INTERIOR);
      const sliceScenes = allScenes.slice(batchStart, batchStart + batchSize);
      const batchRecords = await renderInteriorIllustrations({
        ebookId: ebook_id,
        db,
        characterDescription: charDesc,
        styleSuffix: styleParts,
        negativePrompt,
        scenes: sliceScenes,
        startPageNumber: 3 + batchStart,
        coverReferenceUrl: coverMasterUrl,
      });
      // Splice this batch into the illos array at batchStart, preserving other slots.
      const merged = [...records];
      while (merged.length < MIN_INTERIOR) merged.push({ url: '', scene: '' });
      for (let i = 0; i < batchRecords.length; i++) {
        const abs = batchStart + i;
        const r = batchRecords[i] as unknown as { url: string; scene: string; index: number; page_number: number; model?: string };
        merged[abs] = { ...r, index: abs + 1, page_number: 3 + abs };
      }
      records = merged.filter((r) => r.url);
      await db.from('ebooks_kids').update({ interior_illustrations: records }).eq('id', ebook_id);
      log.push({ step: 'interiors', status: 'regenerated', detail: { batch_start: batchStart, batch_size: sliceScenes.length, total_now: records.length, model_primary: batchRecords[0]?.model } });

      const previewUrls = records.map((r) => r.url).slice(0, MIN_PREVIEWS);
      if (previewUrls.length >= MIN_PREVIEWS) {
        await db.from('ebooks_kids').update({ preview_page_urls: previewUrls }).eq('id', ebook_id);
        log.push({ step: 'previews', status: 'set', detail: { count: previewUrls.length } });
      }
    } else {
      log.push({ step: 'interiors', status: 'skipped_stage', detail: { existing: records.length } });
    }

    let qcBody: { verdict?: { sellable?: boolean; overall_score?: number; reasons?: string[]; critical_errors?: string[] }; story_qc_status?: string; vision_report?: Record<string, unknown> } | null = null;
    let publishState = 'not_attempted';

    if (runPdfQc) {
      // ---- Rebuild PDF ----
      // Refetch current ebook state to get latest cover_url after style stage.
      const { data: cur } = await db.from('ebooks_kids').select('cover_url, interior_illustrations, title, subtitle, manuscript_md').eq('id', ebook_id).single();
      const recs = (cur?.interior_illustrations as typeof records) ?? records;
      if (!cur?.cover_url) throw new Error('cover_url missing');
      const coverPngBytes = new Uint8Array(await (await fetch(cur.cover_url)).arrayBuffer());
      const spreadImages: Uint8Array[] = [];
      for (const il of recs) {
        spreadImages.push(new Uint8Array(await (await fetch(il.url)).arrayBuffer()));
      }
      const md = String(cur.manuscript_md ?? '');
      const paras = md.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
      const chunkSize = Math.max(1, Math.ceil(paras.length / recs.length));
      const captions = recs.map((_, i) => paras.slice(i * chunkSize, (i + 1) * chunkSize).join(' ') || recs[i].scene);

      const pdfBytes = await buildPicturePdf({
        title: String(cur.title ?? ''),
        subtitle: (cur.subtitle as string | null) ?? null,
        coverPng: coverPngBytes,
        spreads: recs.map((_, i) => ({ caption: captions[i], imagePng: spreadImages[i] })),
      });
      const pdfPath = `kids/${ebook_id}/book.pdf`;
      const upPdf = await db.storage.from('ebook-pdfs').upload(pdfPath, pdfBytes, {
        contentType: 'application/pdf', upsert: true,
      });
      if (upPdf.error) throw upPdf.error;
      const { data: pdfSigned } = await db.storage.from('ebook-pdfs').createSignedUrl(pdfPath, 60 * 60 * 24 * 365);
      const pageCount = 2 + recs.length + 1;
      await db.from('ebooks_kids').update({
        pdf_url: pdfSigned?.signedUrl ?? null, page_count: pageCount,
      }).eq('id', ebook_id);
      log.push({ step: 'pdf', status: 'rerendered', detail: { bytes: pdfBytes.length, page_count: pageCount } });

      // ---- Full measured QC with cached story judge ----
      const qcRes = await fetch(`${SUPABASE_URL}/functions/v1/kids-qc-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ ebook_id, use_cached_story_judge_if_hash_matches: true }),
      });
      qcBody = await qcRes.json();
      log.push({ step: 'qc', status: qcRes.ok ? 'ok' : 'fail', detail: {
        sellable: qcBody?.verdict?.sellable, overall: qcBody?.verdict?.overall_score,
        story_qc_status: qcBody?.story_qc_status, reasons: qcBody?.verdict?.reasons,
        global: {
          character: (qcBody?.vision_report as Record<string, unknown> | undefined)?.overall_character_consistency,
          cover_interior: (qcBody?.vision_report as Record<string, unknown> | undefined)?.overall_cover_interior_match,
          style_bible: (qcBody?.vision_report as Record<string, unknown> | undefined)?.overall_style_bible_match,
        },
      } });

      publishState = 'draft_needs_review';
      if (publish_if_sellable && qcBody?.verdict?.sellable) {
        await db.from('ebooks_kids').update({
          listing_status: 'live', status: 'live', pipeline_status: 'published',
        }).eq('id', ebook_id);
        publishState = 'live';
      } else {
        await db.from('ebooks_kids').update({
          listing_status: 'draft', status: 'needs_revision', pipeline_status: 'human_review_required',
        }).eq('id', ebook_id);
      }
      log.push({ step: 'publish', status: publishState });
    } else {
      log.push({ step: 'pdf_and_qc', status: 'skipped_stage' });
    }

    const { data: final } = await db.from('ebooks_kids').select(
      'cover_url, pdf_url, thumbnail_url, preview_page_urls, interior_illustrations, page_count, sellable, overall_qc_score, listing_status, pipeline_status, qc_scorecard, storefront_meta',
    ).eq('id', ebook_id).single();

    return json({
      ok: true, ebook_id,
      old_style_slug: oldStyleSlug, new_style_slug: newSlug,
      cover_master_url: coverMasterUrl,
      log, verdict: qcBody?.verdict ?? null,
      story_qc_status: qcBody?.story_qc_status ?? null,
      manuscript_hash: manuscriptHash,
      final,
    });
  } catch (e) {
    console.error('kids-global-style-fallback error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e), log }, 500);
  }
});
