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

function validateRewrite(text: string, paragraphCount: number) {
  const paras = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const blob = text.toLowerCase();
  const errors: string[] = [];
  if (paras.length !== paragraphCount) errors.push(`paragraph_count ${paras.length} != ${paragraphCount}`);
  if (!/\btali\b/i.test(text)) errors.push('missing Tali');
  if (!/whizz, pop, plop!/i.test(text)) errors.push('missing refrain');
  if (!/(sort|sorting) by story/i.test(text)) errors.push('missing sort by story callback');
  if (!/(sock|socks)/i.test(text)) errors.push('missing socks');
  if (!/(gizmo|sorter|machine)/i.test(text)) errors.push('missing machine/gizmo');
  if (blob.includes('luna') || blob.includes('bear cub')) errors.push('stale wrong-book terms');
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
    if (!ebook_id) return json({ ok: false, error: 'ebook_id required' }, 400);

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
      await db.from('ebooks_kids').update({
        storefront_meta,
        sellable: false,
        listing_status: 'draft',
        status: 'needs_revision',
        pipeline_status: 'human_review_required',
        qc_scorecard: {
          ...scorecard,
          story_qc_status: 'hash_matched_cached_pass',
          manuscript_hash: currentHash,
          story_report: cached.report,
          final_text_repair: { cache_status: 'promoted_prior_hash_match', manuscript_changed: false, art_untouched: true, art_snapshot, updated_at: new Date().toISOString() },
        },
      }).eq('id', ebook_id);
      const pdfRes = await callPdfBuilder(ebook_id, publish);
      return json({ ok: true, action: 'cache_promoted_pdf_rebuild_started', pdf_builder_status: pdfRes.status, story_qc_status: 'hash_matched_cached_pass', manuscript_changed: false, art_untouched: true });
    }

    const paragraphs = manuscript.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    const user = `Improve ONLY reread value for this existing ages 4-6 picture-book manuscript.

Title must remain exactly: ${ebook.title}
Subtitle must remain exactly: ${ebook.subtitle ?? '(none)'}

Do not change metadata, title, subtitle, price, premise, hero, or page count.
Keep the same ${paragraphs.length} paragraph/page-caption structure and same scene beats so existing art still matches.

Must preserve:
- Hero: Tali, a human kid-inventor
- Sneeze-powered sock-sorting machine / Wobbly Gizmo
- Mismatched sock characters
- Theme: sort by story, not sameness
- Exact refrain: Whizz, pop, plop!

Targeted reread improvements only:
- strengthen the recurring callback in several paragraphs
- add a tiny final-page visual joke in the last paragraph (text only) that still matches the sock-room ending
- keep age 4-6 language, short read-aloud sentences, no padding
- keep all story beats aligned with current illustrations

Return JSON: {"manuscript_md":"..."}

CURRENT MANUSCRIPT:
"""
${manuscript}
"""`;

    const ai = await aiJSON<{ manuscript_md: string }>({
      model: 'google/gemini-3.1-pro-preview',
      system: 'You are a careful children\'s picture-book line editor. Return valid JSON only. Edit minimally and preserve scene/art alignment.',
      user,
      maxTokens: 5000,
      timeoutMs: 180_000,
    });
    await logCost(db, { ebook_id, step: 'kids_final_reread_value_rewrite', model: ai.model, ...ai.usage });
    const candidate = String(ai.data.manuscript_md ?? '').trim();
    const validation = validateRewrite(candidate, paragraphs.length);
    if (!validation.ok) {
      await db.from('ebooks_kids').update({
        sellable: false, listing_status: 'draft', status: 'needs_revision', pipeline_status: 'human_review_required',
        qc_scorecard: { ...scorecard, final_text_repair: { cache_status: 'none', rewrite_status: 'validation_failed', validation_errors: validation.errors, manuscript_changed: false, art_untouched: true, art_snapshot, updated_at: new Date().toISOString() } },
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
      await db.from('ebooks_kids').update({
        sellable: false, listing_status: 'draft', status: 'needs_revision', pipeline_status: 'human_review_required',
        qc_scorecard: { ...scorecard, final_text_repair: { cache_status: 'none', rewrite_status: 'story_judge_failed', story_report: storyReport, manuscript_changed: false, art_untouched: true, art_snapshot, updated_at: new Date().toISOString() } },
      }).eq('id', ebook_id);
      return json({ ok: false, action: 'rewrite_story_judge_failed_original_preserved', story_report: storyReport, manuscript_changed: false, art_untouched: true });
    }

    const newHash = await manuscriptHash(candidate);
    const storefront_meta = promoteCache(meta, newHash, storyReport, 'targeted_reread_value_rewrite');
    await db.from('ebooks_kids').update({
      manuscript_md: candidate,
      word_count: candidate.split(/\s+/).filter(Boolean).length,
      storefront_meta,
      sellable: false,
      listing_status: 'draft',
      status: 'needs_revision',
      pipeline_status: 'human_review_required',
      qc_scorecard: {
        ...scorecard,
        story_qc_status: 'hash_matched_cached_pass',
        manuscript_hash: newHash,
        story_report: storyReport,
        final_text_repair: {
          cache_status: 'none', rewrite_status: 'passed_and_applied', old_hash: currentHash, new_hash: newHash,
          manuscript_changed: true, art_untouched: true, art_snapshot: artSnapshot, model: ai.model, updated_at: new Date().toISOString(),
        },
      },
    }).eq('id', ebook_id);

    const pdfRes = await callPdfBuilder(ebook_id, publish);
    return json({ ok: true, action: 'rewrite_applied_pdf_rebuild_started', pdf_builder_status: pdfRes.status, story_qc_status: 'hash_matched_cached_pass', story_report: storyReport, manuscript_changed: true, art_untouched: true });
  } catch (e) {
    console.error('kids-final-text-repair error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});