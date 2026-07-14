// Kids storefront copy generator — conversion-optimized.
//
// Produces the fields a parent scans on a paid-ad landing:
//   selling_hook, short_hook, product_description, shopping_card_description,
//   preview_blurb, benefit_bullets[], storefront_meta.ad_promise
//
// Uses the CONVERSION_TITLE_HOOK + CONVERSION_DESCRIPTION skills from the
// pipeline_skills table (auto-learned upgrades apply here too).

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { loadStoryCraftBlock } from '../_shared/story-craft-skill.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface CopyOut {
  selling_hook: string;
  short_hook: string;
  product_description: string;
  shopping_card_description: string;
  preview_blurb: string;
  benefit_bullets: string[];
  ad_promise: {
    theme: string;
    hook_line: string;
    primary_benefit: string;
  };
}

async function callGemini(system: string, user: string): Promise<string> {
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return String(j?.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const { ebook_id, age_band } = await req.json();
    if (!ebook_id) return json({ ok: false, error: 'ebook_id required' }, 400);

    const { data: e, error } = await db.from('ebooks_kids')
      .select('id, title, subtitle, description, manuscript_md, storefront_meta, page_count, price_cents')
      .eq('id', ebook_id).single();
    if (error || !e) return json({ ok: false, error: 'ebook not found' }, 404);

    const meta = (e.storefront_meta as Record<string, unknown> | null) ?? {};
    const concept: any = meta.concept_brief ?? meta.locked_concept ?? {};

    const skillBlock = await loadStoryCraftBlock(db, age_band ?? '4-6');

    const manuscript = String(e.manuscript_md ?? '').slice(0, 8000);
    const pages = Number(e.page_count ?? 32);
    const readAloudMin = Math.max(4, Math.min(12, Math.round(pages * 0.4)));
    const priceUsd = (Number(e.price_cents ?? 799) / 100).toFixed(2);

    const system = `You are a world-class direct-response copywriter for children's-book paid ads and Shopify-style product pages.
Your ONLY job is to make a parent who lands from a paid ad click BUY. Follow the CONVERSION skills below EXACTLY.

${skillBlock}

Return STRICT JSON matching:
{
  "selling_hook": "eyebrow line, <=14 words, the parent-recognition hook (question or scenario)",
  "short_hook": "same hook but <=12 words, for grid cards",
  "product_description": "Full block: HOOK line \\n\\n STORY PROMISE (2-3 short lines with concrete imagery from the book — refrain / funniest moment / callback object) \\n\\n OUTCOME line (what the parent gets) \\n\\n SPECS line: Perfect for ages [X-Y] · [theme] · read-aloud ~${readAloudMin} min · ${pages} pages",
  "shopping_card_description": "HOOK + STORY PROMISE lines only, <=60 words",
  "preview_blurb": "one warm line hinting at the payoff, <=20 words",
  "benefit_bullets": ["3 to 4 benefit-led bullets (not features). Each <=14 words."],
  "ad_promise": {
    "theme": "the single developmental theme (must match parent_hook)",
    "hook_line": "the same selling_hook — reused verbatim in future ads for message-match",
    "primary_benefit": "what the parent gets in one short sentence"
  }
}

RULES:
- HOOK is a QUESTION or SCENARIO a parent instantly recognizes ("Does your little one melt down when plans change?"). Never plot summary.
- Emotional recognition beats cleverness.
- STORY PROMISE names the hero + the concrete refrain or callback object from the actual book.
- OUTCOME names the felt at-home benefit (giggles, easier bedtime, easier conversation about X).
- NEVER include fake reviews, fake scarcity, or made-up awards.
- Language: English only.`;

    const user = `TITLE: ${e.title}
SUBTITLE: ${e.subtitle ?? ''}
DEVELOPMENTAL THEME (parent_hook): ${concept.parent_hook ?? ''}
HERO: ${concept.hero ?? ''}
REFRAIN: ${concept.refrain ?? ''}
CALLBACK OBJECTS: ${concept.callback_1 ?? ''} / ${concept.callback_2 ?? ''}
FINAL PAGE PAYOFF: ${concept.final_page_payoff ?? ''}
PARENT BUYER HOOK: ${concept.parent_buyer_hook ?? ''}
PAGES: ${pages}  ·  READ-ALOUD: ~${readAloudMin} min  ·  PRICE: $${priceUsd}

MANUSCRIPT (excerpt):
${manuscript}

Return STRICT JSON only.`;

    const raw = await callGemini(system, user);
    let copy: CopyOut;
    try { copy = JSON.parse(raw) as CopyOut; }
    catch {
      const s = raw.indexOf('{'); const t = raw.lastIndexOf('}');
      copy = JSON.parse(raw.slice(s, t + 1)) as CopyOut;
    }

    const bullets = Array.isArray(copy.benefit_bullets) ? copy.benefit_bullets.slice(0, 4).map(String) : [];

    const nextMeta: Record<string, unknown> = {
      ...meta,
      ad_promise: copy.ad_promise ?? null,
      conversion_copy_generated_at: new Date().toISOString(),
      read_aloud_minutes: readAloudMin,
    };

    // ebooks_kids has only {title, subtitle, description, storefront_meta} for
    // copy today, so stash the extended conversion copy inside storefront_meta.
    // Product/Kids UI reads it from storefront_meta.conversion_copy.
    const nextMeta2: Record<string, unknown> = {
      ...nextMeta,
      conversion_copy: {
        selling_hook: (copy.selling_hook ?? '').slice(0, 180),
        short_hook: (copy.short_hook ?? copy.selling_hook ?? '').slice(0, 140),
        product_description: (copy.product_description ?? '').slice(0, 2000),
        shopping_card_description: (copy.shopping_card_description ?? '').slice(0, 320),
        preview_blurb: (copy.preview_blurb ?? '').slice(0, 200),
        benefit_bullets: bullets,
        read_aloud_minutes: readAloudMin,
        pages,
      },
    };

    await db.from('ebooks_kids').update({
      description: (copy.product_description ?? '').slice(0, 2000),
      storefront_meta: nextMeta2,
    }).eq('id', ebook_id);

    return json({ ok: true, ebook_id, copy });
  } catch (e) {
    console.error('kids-generate-storefront-copy error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
