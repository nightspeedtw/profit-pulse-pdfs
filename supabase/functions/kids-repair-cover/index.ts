// Kids cover title repair.
// 1. Extract hero + setting + hero-moment from the FINAL manuscript (Gate 6:
//    cover must match the story, not the concept draft).
// 2. Generate a fresh TEXTLESS cover master via Fal.
// 3. Composite the exact title + subtitle deterministically via Browserless.
// 4. Persist cover_prompt_source=manuscript@<hash>.
// 5. Fire-and-forget kids-build-picture-pdf so page 1 gets spliced (Gate 1).

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { falRecraftV3 } from '../_shared/fal.ts';
import { composeCoverTitle } from '../_shared/cover-title-overlay.ts';
import { uploadAndSignImage, versionedKidsAssetPath } from '../_shared/versioned-assets.ts';
import '../_shared/gateway-guard.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface CoverBrief {
  hero: string;      // "a small brown mouse in a red scarf"
  setting: string;   // "a sunlit farmyard"
  moment: string;    // "trying to squeak loudly enough to be heard"
  subtitle: string;  // "A tiny voice, a big farm concert"
}

async function briefFromManuscript(title: string, manuscript: string): Promise<CoverBrief> {
  const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are a picture-book cover art director. Return JSON only.' },
        { role: 'user', content: `Book title: "${title}"

Manuscript:
"""
${manuscript.slice(0, 6000)}
"""

Write a cover brief STRICTLY from this manuscript (not from the title alone).
Return JSON only, no fences:
{
  "hero": "concise visual description of the main character (species, key features, outfit)",
  "setting": "the ACTUAL setting the story takes place in",
  "moment": "one visually strong hero moment from the story",
  "subtitle": "short 4-7 word marketing subtitle that reflects the actual story"
}` },
      ],
    }),
  });
  if (!r.ok) throw new Error(`brief ${r.status}`);
  const j = await r.json();
  const raw = (j.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const parsed = JSON.parse(raw) as CoverBrief;
  return parsed;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const { ebook_id, regenerate_master = true, rebuild_pdf = true } = await req.json();
    if (!ebook_id) return json({ ok: false, error: 'ebook_id required' }, 400);

    const { data: eb } = await db.from('ebooks_kids').select('*').eq('id', ebook_id).single();
    if (!eb) return json({ ok: false, error: 'ebook not found' }, 404);

    const manuscript = String(eb.manuscript_md ?? '').trim();
    if (!manuscript) return json({ ok: false, error: 'cover_from_manuscript_gate: manuscript_md is empty; write the story before regenerating the cover' }, 400);

    // Gate 6 — cover brief built from FINAL manuscript, not concept draft.
    let brief: CoverBrief;
    try {
      brief = await briefFromManuscript(String(eb.title ?? ''), manuscript);
    } catch (e) {
      return json({ ok: false, error: `cover brief failed: ${(e as Error).message}` }, 500);
    }
    const manuscriptHash = (await sha1Hex(manuscript.replace(/\s+/g, ' '))).slice(0, 16);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bible } = await (db.from('kids_book_bibles') as any).select('*').eq('ebook_id', ebook_id).maybeSingle();

    // ----- Step 1: textless master (Recraft caps prompt at 1000 chars) -----
    let masterUrl: string | null = null;
    if (regenerate_master || !bible?.cover_master_url) {
      const masterPrompt = [
        `Whimsical illustrated children's picture book cover artwork — full-bleed background scene only.`,
        `Hero: ${brief.hero.slice(0, 260)}.`,
        `Setting: ${brief.setting.slice(0, 200)}.`,
        `Hero moment: ${brief.moment.slice(0, 200)}.`,
        `Warm painterly storybook illustration, soft golden lighting, cozy atmosphere, expressive character face.`,
        `Portrait orientation. Reserve the top 25% as calm sky so a title can be added later.`,
        `Textless artwork only — no letters, no words, no title, no signage, no writing anywhere.`,
      ].join(' ').slice(0, 990);
      const masterBytes = await falRecraftV3({
        prompt: masterPrompt,
        image_size: 'portrait_4_3',
        negative_prompt: 'text, letters, numbers, words, title, subtitle, typography, watermark, logo, signature, caption, book, sign, writing, speech bubble, calligraphy, gibberish, garbled text, deformed hands, six fingers, extra fingers, stock photo, glossy 3d blob',
      });
      const masterPath = versionedKidsAssetPath(ebook_id, 'cover-master');
      const signed = await uploadAndSignImage(db, 'ebook-covers', masterPath, masterBytes);
      masterUrl = signed.signedUrl;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db.from('kids_book_bibles') as any).update({ cover_master_url: masterUrl }).eq('ebook_id', ebook_id);
    } else {
      masterUrl = bible.cover_master_url;
    }
    if (!masterUrl) throw new Error('no cover master URL after upload');

    // ----- Step 2: subtitle from manuscript; deterministic overlay -----
    const subtitle = (brief.subtitle ?? '').trim() || (eb.subtitle as string | null) || null;
    const composed = await composeCoverTitle({
      coverImageUrl: masterUrl,
      title: eb.title as string,
      subtitle,
      width: 800,
      height: 1200,
      titlePosition: 'top',
    });
    const finalPath = versionedKidsAssetPath(ebook_id, 'cover');
    const finalSigned = await uploadAndSignImage(db, 'ebook-covers', finalPath, composed);

    const existingMeta = (eb.storefront_meta as Record<string, unknown> | null) ?? {};
    await db.from('ebooks_kids').update({
      cover_url: finalSigned.signedUrl,
      thumbnail_url: finalSigned.signedUrl,
      subtitle,
      storefront_meta: {
        ...existingMeta,
        cover_prompt_source: `manuscript@${manuscriptHash}`,
        cover_brief: brief,
      },
    }).eq('id', ebook_id);

    // Gate 1 — force PDF rebuild so page 1 uses the new cover bytes.
    if (rebuild_pdf) {
      // @ts-expect-error EdgeRuntime is a Deno Deploy global
      EdgeRuntime.waitUntil(fetch(`${SUPABASE_URL}/functions/v1/kids-build-picture-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ ebook_id, stage: 'pdf_prepare', publish: true }),
      }).catch(() => {}));
    }

    return json({
      ok: true,
      ebook_id,
      cover_master_url: masterUrl,
      cover_url: finalSigned.signedUrl,
      subtitle,
      cover_prompt_source: `manuscript@${manuscriptHash}`,
      brief,
      pdf_rebuild_dispatched: rebuild_pdf,
    });
  } catch (e) {
    console.error('kids-repair-cover error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
