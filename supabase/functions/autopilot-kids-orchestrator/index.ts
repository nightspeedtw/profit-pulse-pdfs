import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // 1. Load weights
    const { data: weights, error: wErr } = await supabase
      .from('kids_category_weights')
      .select('age_group_id, theme_id, weight, sales_last_30d')
      .gt('weight', 0);
    if (wErr) throw wErr;
    if (!weights || weights.length === 0) {
      return json({ ok: false, reason: 'no_weights' });
    }

    // 2. Weighted-random pick (weight + sales boost)
    const scored = weights.map(w => ({ ...w, score: w.weight + w.sales_last_30d * 5 }));
    const total = scored.reduce((s, w) => s + w.score, 0);
    let r = Math.random() * total;
    let pick = scored[0];
    for (const w of scored) { r -= w.score; if (r <= 0) { pick = w; break; } }

    // 3. Check concurrency: skip if already 2 active runs
    const { count: active } = await supabase
      .from('autopilot_kids_runs')
      .select('id', { count: 'exact', head: true })
      .in('status', ['queued', 'running']);
    if ((active ?? 0) >= 2) {
      return json({ ok: true, skipped: 'max_concurrency', active });
    }

    // 4. Create ebook + queue + run
    const { data: eb, error: ebErr } = await supabase
      .from('ebooks_kids')
      .insert({
        age_group_id: pick.age_group_id,
        theme_ids: [pick.theme_id],
        status: 'idea',
        pipeline_status: 'idea',
        title: 'Untitled Kids Book',
      })
      .select('id')
      .single();
    if (ebErr) throw ebErr;

    await supabase.from('kids_production_queue').insert({
      ebook_kids_id: eb.id,
      age_group_id: pick.age_group_id,
      theme_id: pick.theme_id,
      status: 'queued',
    });

    const { data: run, error: rErr } = await supabase
      .from('autopilot_kids_runs')
      .insert({ ebook_kids_id: eb.id, status: 'queued', current_step: 'generate_idea', progress_percent: 0 })
      .select('id')
      .single();
    if (rErr) throw rErr;

    // 5. Invoke pipeline (fire-and-forget)
    fetch(`${SUPABASE_URL}/functions/v1/autopilot-kids-pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ run_id: run.id }),
    }).catch((e) => console.error('pipeline invoke failed', e));

    return json({ ok: true, ebook_kids_id: eb.id, run_id: run.id, pick });
  } catch (e) {
    console.error('orchestrator error', e);
    return json({ ok: false, error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
