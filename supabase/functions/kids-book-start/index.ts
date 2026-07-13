// Admin-triggered kids picture book run with explicit parameters.
// Creates ebooks_kids + queue + run rows, then fires the pipeline.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      age_group_slug,      // e.g. "picture-book-4-6" (optional; else weighted pick)
      theme_slugs = [],    // string[] (optional; else weighted pick)
      language = 'en',
      target_market = 'US',
      tone = 'warm, whimsical, emotionally reassuring',
      book_length = 'standard',       // short | standard | long
      illustration_intensity = 'high',
      price_tier = 'standard',
      mode = 'full',                  // safe | full
    } = body ?? {};

    // Resolve age group + themes
    let age_group_id: string | null = null;
    if (age_group_slug && age_group_slug !== 'all') {
      const { data } = await db.from('kids_age_groups').select('id').eq('slug', age_group_slug).maybeSingle();
      age_group_id = data?.id ?? null;
    }
    if (!age_group_id) {
      // Fallback: pick the 4-6 picture-book band or the first available.
      const { data } = await db.from('kids_age_groups').select('id, slug').order('sort_order', { ascending: true });
      const preferred = (data ?? []).find(a => /picture|4.?6/i.test(a.slug)) ?? (data ?? [])[0];
      age_group_id = preferred?.id ?? null;
    }
    if (!age_group_id) return json({ ok: false, error: 'no age group available' }, 400);

    let theme_ids: string[] = [];
    if (theme_slugs.length > 0) {
      const { data } = await db.from('kids_themes').select('id, slug').in('slug', theme_slugs);
      theme_ids = (data ?? []).map(t => t.id);
    }
    if (theme_ids.length === 0) {
      const { data } = await db.from('kids_themes').select('id').limit(1);
      theme_ids = (data ?? []).map(t => t.id);
    }

    // Concurrency guard (mirror orchestrator)
    const { count: active } = await db
      .from('autopilot_kids_runs')
      .select('id', { count: 'exact', head: true })
      .in('status', ['queued', 'running']);
    if ((active ?? 0) >= 3) {
      return json({ ok: false, error: `max concurrency (${active} active)` }, 429);
    }

    // Create ebook
    const { data: eb, error: ebErr } = await db.from('ebooks_kids').insert({
      age_group_id,
      theme_ids,
      status: 'idea',
      pipeline_status: 'idea',
      title: 'Untitled Kids Book',
    }).select('id').single();
    if (ebErr) throw ebErr;

    await db.from('kids_production_queue').insert({
      ebook_kids_id: eb.id,
      age_group_id,
      theme_id: theme_ids[0] ?? null,
      status: 'queued',
    });

    const paramsMeta = { language, target_market, tone, book_length, illustration_intensity, price_tier, mode };
    const { data: run, error: rErr } = await db.from('autopilot_kids_runs').insert({
      ebook_kids_id: eb.id,
      status: 'queued',
      current_step: 'generate_idea',
      progress_percent: 0,
      // Best-effort: stash params as blocker_reason preview if schema doesn't have params_json
      blocker_reason: null,
    }).select('id').single();
    if (rErr) throw rErr;

    // Persist params inside the ebook's storefront_meta so the pipeline can read them
    await db.from('ebooks_kids').update({
      storefront_meta: { admin_params: paramsMeta },
    }).eq('id', eb.id);

    // Fire-and-forget pipeline
    fetch(`${SUPABASE_URL}/functions/v1/autopilot-kids-pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ run_id: run.id }),
    }).catch(e => console.error('pipeline invoke failed', e));

    return json({ ok: true, ebook_kids_id: eb.id, run_id: run.id, params: paramsMeta, age_group_id, theme_ids });
  } catch (e) {
    console.error('kids-book-start error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
