// kids-fixture-rehydrate
// One-shot admin utility for the P0 acceptance fixture.
//
// Purpose: when a kids ebook row cannot be repaired in place
// (identity_guard fires because manuscript/story_bible are locked, or
// ever_live=true), insert a FRESH row seeded from the same concept and
// launch the autopilot pipeline against it. The original row remains as
// permanent evidence.
//
// The fresh row is written with manuscript_md = NULL so identity_guard
// permits the pipeline to legitimately populate manuscript/story_bible on
// its first pass, at which point identity locks on the NEW row.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { source_ebook_id } = await req.json();
    if (!source_ebook_id || typeof source_ebook_id !== 'string') {
      return json({ error: 'source_ebook_id required' }, 400);
    }

    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: source, error: srcErr } = await db
      .from('ebooks_kids')
      .select('id, title, subtitle, description, age_group_id, theme_ids, price_cents, storefront_meta')
      .eq('id', source_ebook_id)
      .single();
    if (srcErr || !source) {
      return json({ error: 'source ebook not found', details: srcErr?.message }, 404);
    }

    // Insert fresh row. manuscript_md/story_bible left NULL so the
    // pipeline can write them and identity_guard locks the NEW row on
    // first legitimate manuscript write.
    const { data: fresh, error: insErr } = await db
      .from('ebooks_kids')
      .insert({
        title: source.title,
        subtitle: source.subtitle,
        description: source.description,
        age_group_id: source.age_group_id,
        theme_ids: source.theme_ids,
        price_cents: source.price_cents,
        storefront_meta: source.storefront_meta,
        status: 'draft',
        listing_status: 'draft',
        pipeline_status: 'queued',
        sellable: false,
        ever_live: false,
        rehydrated_from: source.id,
      })
      .select('id')
      .single();
    if (insErr || !fresh) {
      return json({ error: 'insert failed', details: insErr?.message }, 500);
    }

    // Create autopilot run
    const { data: run, error: runErr } = await db
      .from('autopilot_kids_runs')
      .insert({
        ebook_kids_id: fresh.id,
        status: 'queued',
        current_step: 'boot',
        current_step_label: 'Queued (fixture rehydrate)',
        progress_percent: 0,
        metadata: {
          source: 'kids-fixture-rehydrate',
          rehydrated_from: source.id,
          rehydrated_at: new Date().toISOString(),
        },
      })
      .select('id')
      .single();
    if (runErr || !run) {
      return json({ error: 'run insert failed', details: runErr?.message, ebook_id: fresh.id }, 500);
    }

    // Fire-and-forget invoke of the autopilot pipeline.
    fetch(`${SUPABASE_URL}/functions/v1/autopilot-kids-pipeline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ run_id: run.id }),
    }).catch((e) => console.error('autopilot dispatch failed', e));

    return json({
      ok: true,
      source_ebook_id: source.id,
      new_ebook_id: fresh.id,
      run_id: run.id,
      dispatched: true,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
