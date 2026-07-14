// Final text-only repair for kids picture books.
// Fixes story reread-value via hash-matched cache reconciliation first, then a
// targeted manuscript rewrite if no passing cached judge exists. Never touches
// cover, interiors, previews, title, subtitle, description, price, Shopify, or reviews.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { aiJSON, logCost } from '../_shared/ai.ts';
import { runKidsStoryJudge, type StoryReport } from '../_shared/kids-story-judge.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

type CacheEntry = { manuscript_hash: string; report: StoryReport; cached_at: string; source?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function manuscriptHash(s: string): Promise<string> {
  const normalized = String(s ?? '').trim().replace(/\s+/g, ' ');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getCachedPassing(meta: Record<string, unknown>, hash: string): CacheEntry | null {
  const cache = (meta.story_judge_cache ?? null) as Record<string, unknown> | null;
  if (!cache || !hash) return null;
  const direct = cache[hash] as CacheEntry | undefined;
  if (direct?.report?.story_qc_passed === true) return { ...direct, manuscript_hash: direct.manuscript_hash ?? hash };
  const byHash = (cache.by_hash as Record<string, CacheEntry> | undefined)?.[hash];
  if (byHash?.report?.story_qc_passed === true) return { ...byHash, manuscript_hash: byHash.manuscript_hash ?? hash };
  const legacyReport = cache.report as StoryReport | undefined;
  if (cache.manuscript_hash === hash && legacyReport?.story_qc_passed === true) {
    return { manuscript_hash: hash, report: legacyReport, cached_at: String(cache.cached_at ?? ''), source: 'legacy' };
  }
  return null;
}

function promoteCache(meta: Record<string, unknown>, hash: string, report: StoryReport, source: string): Record<string, unknown> {
  const existing = ((meta.story_judge_cache ?? null) as Record<string, unknown> | null) ?? {};
  const byHash = ((existing.by_hash ?? null) as Record<string, unknown> | null) ?? {};
  const entry: CacheEntry = { manuscript_hash: hash, report, cached_at: new Date().toISOString(), source };
  return {
    ...meta,
    story_judge_cache: {
      ...existing,
      [hash]: entry,
      by_hash: { ...byHash, [hash]: entry },
      manuscript_hash: hash,
      report,
      cached_at: entry.cached_at,
    },
  };
}

function validateRewrite(text: string, paragraphCount: number, original: string) {
  const paras = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const errors: string[] = [];
  if (paras.length !== paragraphCount) errors.push(`paragraph_count ${paras.length} != ${paragraphCount}`);
  if (text.length < Math.min(original.length * 0.85, original.length - 40)) errors.push('rewrite_shrank_too_much');
  const originalTerms = new Set((original.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).slice(0, 40));
  const missingTerms = [...originalTerms].filter((w) => !new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text));
  if (missingTerms.length > Math.max(4, originalTerms.size * 0.35)) errors.push(`lost_too_many_story_terms:${missingTerms.slice(0, 8).join(',')}`);
  return { ok: errors.length === 0, errors, paragraphs: paras };
}

async function callPdfBuilder(ebook_id: string, publish: boolean) {
  return await fetch(`${SUPABASE_URL}/functions/v1/kids-build-picture-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ ebook_id, stage: 'pdf_prepare', publish, run_qc_after: true }),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    const body = await req.json().catch(() => ({}));
    const ebook_id = String(body.ebook_id ?? '');
    const publish = body.publish !== false;
    const stage = String(body.stage ?? 'queue');
    if (!ebook_id) return json({ ok: false, error: 'ebook_id required' }, 400);

    if (stage === 'queue') {
      // @ts-expect-error EdgeRuntime is a Deno Deploy global.
      EdgeRuntime.waitUntil(fetch(`${SUPABASE_URL}/functions/v1/kids-final-text-repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ ebook_id, publish, stage: 'run' }),
      }));
      return json({ ok: true, queued: true, ebook_id, note: 'text-only repair queued; art untouched' });
    }

    const { data: ebook, error } = await db.from('ebooks_kids').select(
      'id,title,subtitle,description,price_cents,manuscript_md,story_bible,interior_illustrations,cover_url,thumbnail_url,preview_page_urls,qc_scorecard,storefront_meta',
    ).eq('id', ebook_id).single();
    if (error || !ebook) return json({ ok: false, error: 'ebook not found' }, 404);

    const meta = ((ebook.storefront_meta ?? null) as Record<string, unknown> | null) ?? {};
    const scorecard = ((ebook.qc_scorecard ?? null) as Record<string, unknown> | null) ?? {};
    const manuscript = String(ebook.manuscript_md ?? '').trim();
    const currentHash = await manuscriptHash(manuscript);
    const artSnapshot = {
      cover_url: ebook.cover_url,
      thumbnail_url: ebook.thumbnail_url,
      preview_count: Array.isArray(ebook.preview_page_urls) ? ebook.preview_page_urls.length : 0,
      interior_count: Array.isArray(ebook.interior_illustrations) ? ebook.interior_illustrations.length : 0,
    };

    const cached = getCachedPassing(meta, currentHash);
    if (cached) {
      const storefront_meta = promoteCache(meta, currentHash, cached.report, 'prior_hash_matched_cache');
      const repairLog = { cache_status: 'promoted_prior_hash_match', manuscript_changed: false, art_untouched: true, art_snapshot: artSnapshot, updated_at: new Date().toISOString() };
      await db.from('ebooks_kids').update({
        storefront_meta,
        sellable: false,
        listing_status: 'draft',
        status: 'qc',
        pipeline_status: 'pdf_building',
        qc_scorecard: {
          ...scorecard,
          story_qc_status: 'hash_matched_cached_pass',
          manuscript_hash: currentHash,
          story_report: cached.report,
          final_text_repair: repairLog,
        },
      }).eq('id', ebook_id);
      const pdfRes = await callPdfBuilder(ebook_id, publish);
      return json({ ok: true, action: 'cache_promoted_pdf_rebuild_started', pdf_builder_status: pdfRes.status, story_qc_status: 'hash_matched_cached_pass', manuscript_changed: false, art_untouched: true });
    }

    const paragraphs = manuscript.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    const interiorScenes = Array.isArray(ebook.interior_illustrations)
      ? (ebook.interior_illustrations as Array<Record<string, unknown>>).map((x, i) => `${i + 1}. ${String(x.scene ?? '').slice(0, 240)}`).join('\n')
      : '';
    const targetParagraphCount = Math.max(paragraphs.length, Array.isArray(ebook.interior_illustrations) ? (ebook.interior_illustrations as unknown[]).length : paragraphs.length);
    const user = `Repair ONLY the page-caption mapping for this existing ages 4-6 picture-book manuscript.

Title must remain exactly: ${ebook.title}
Subtitle must remain exactly: ${ebook.subtitle ?? '(none)'}

Do not change metadata, title, subtitle, price, premise, hero, or page count.
Return exactly ${targetParagraphCount} paragraph blocks separated by blank lines so every existing illustration receives real caption text.
Preserve the current story order, character names, refrain/callback language, and scene beats.
If the current manuscript has fewer than ${targetParagraphCount} paragraphs, split an overlong paragraph or add a short final caption that matches the corresponding final illustration.
If it has more, merge only adjacent beats.
Keep age 4-6 language: 1-3 short read-aloud sentences per paragraph, no placeholders, no labels like "Page 28".

Return JSON: {"manuscript_md":"..."}

EXISTING ILLUSTRATION SCENES (${targetParagraphCount} total):
${interiorScenes}

CURRENT MANUSCRIPT:
"""
${manuscript}
"""`;

    const ai = await aiJSON<{ manuscript_md: string }>({
      model: 'google/gemini-2.5-flash',
      system: 'You are a careful children\'s picture-book line editor. Return valid JSON only. Edit minimally and preserve scene/art alignment.',
      user,
      maxTokens: 5000,
      timeoutMs: 180_000,
    });
    await logCost(db, { ebook_id, step: 'kids_final_reread_value_rewrite', model: ai.model, ...ai.usage });
    const candidate = String(ai.data.manuscript_md ?? '').trim();
    const validation = validateRewrite(candidate, targetParagraphCount, manuscript);
    if (!validation.ok) {
      const repairLog = { cache_status: 'none', rewrite_status: 'validation_failed', validation_errors: validation.errors, manuscript_changed: false, art_untouched: true, art_snapshot: artSnapshot, updated_at: new Date().toISOString() };
      await db.from('ebooks_kids').update({
        sellable: false, listing_status: 'draft', status: 'needs_revision', pipeline_status: 'retired',
        qc_scorecard: { ...scorecard, final_text_repair: repairLog },
      }).eq('id', ebook_id);
      return json({ ok: false, action: 'rewrite_validation_failed', errors: validation.errors, manuscript_changed: false, art_untouched: true }, 422);
    }

    const storyReport = await runKidsStoryJudge({
      title: String(ebook.title ?? ''),
      subtitle: (ebook.subtitle as string | null) ?? null,
      ageBand: '4-6',
      manuscript_md: candidate,
      page_texts: Array.isArray(ebook.interior_illustrations)
        ? (ebook.interior_illustrations as Array<Record<string, unknown>>).map((x) => String(x.scene ?? '')).filter(Boolean)
        : [],
    });

    if (!storyReport.story_qc_passed) {
      const repairLog = { cache_status: 'none', rewrite_status: 'story_judge_failed', story_report: storyReport, manuscript_changed: false, art_untouched: true, art_snapshot: artSnapshot, updated_at: new Date().toISOString() };
      await db.from('ebooks_kids').update({
        sellable: false, listing_status: 'draft', status: 'needs_revision', pipeline_status: 'retired',
        qc_scorecard: { ...scorecard, final_text_repair: repairLog },
      }).eq('id', ebook_id);
      return json({ ok: false, action: 'rewrite_story_judge_failed_original_preserved', story_report: storyReport, manuscript_changed: false, art_untouched: true });
    }

    const newHash = await manuscriptHash(candidate);
    const storefront_meta = promoteCache(meta, newHash, storyReport, 'targeted_reread_value_rewrite');
    const repairLog = {
      cache_status: 'none', rewrite_status: 'passed_and_applied', old_hash: currentHash, new_hash: newHash,
      manuscript_changed: true, art_untouched: true, art_snapshot: artSnapshot, model: ai.model, updated_at: new Date().toISOString(),
    };
    await db.from('ebooks_kids').update({
      manuscript_md: candidate,
      word_count: candidate.split(/\s+/).filter(Boolean).length,
      storefront_meta,
      sellable: false,
      listing_status: 'draft',
      status: 'qc',
      pipeline_status: 'pdf_building',
      qc_scorecard: {
        ...scorecard,
        story_qc_status: 'hash_matched_cached_pass',
        manuscript_hash: newHash,
        story_report: storyReport,
        final_text_repair: repairLog,
      },
    }).eq('id', ebook_id);

    const pdfRes = await callPdfBuilder(ebook_id, publish);
    return json({ ok: true, action: 'rewrite_applied_pdf_rebuild_started', pdf_builder_status: pdfRes.status, story_qc_status: 'hash_matched_cached_pass', story_report: storyReport, manuscript_changed: true, art_untouched: true });
  } catch (e) {
    console.error('kids-final-text-repair error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});