// kids-batch-producer
//
// Runs on a schedule (every 10 min via pg_cron) and sequentially produces live
// kids books toward the active kids_batch_orders row.
//
// On each tick:
//   1. Load the newest active batch order. If none, exit.
//   2. Reconcile `produced_live` — count books that reached listing_status='live'
//      since the batch was created (or via counted_ebook_ids).
//   3. If produced_live >= target, mark 'done' and exit.
//   4. Singleton: if any parent run is queued/running, do nothing.
//   5. Pick a theme id + lane distinct from last_used_* (variety guard) and
//      dispatch kids-one-click-build with defaults.
//
// Never lowers quality gates. Never force-publishes. Manual pause honored via
// status='paused'.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { armsRegressionPause, classifyBlocker } from '../_shared/blocker-taxonomy.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const LANE_ROTATION = [
  'food_kitchen_chaos',
  'tiny_detective',
  'animal_buddy_mechanical',
  'neighborhood_micro_adventure',
  'shop_library_museum_logic',
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function reconcile(db: ReturnType<typeof createClient>, order: {
  id: string; created_at: string; counted_ebook_ids: string[]; target_live_books: number;
}) {
  const { data: live } = await db.from('ebooks_kids')
    .select('id')
    .neq('book_type', 'coloring_book') // coloring is a separate lane
    .eq('listing_status', 'live')
    .gte('updated_at', order.created_at);
  const liveIds = new Set<string>((live ?? []).map(r => r.id as string));
  for (const id of order.counted_ebook_ids ?? []) liveIds.add(id);
  const produced_live = liveIds.size;
  const merged = Array.from(liveIds);
  const updates: Record<string, unknown> = { produced_live, counted_ebook_ids: merged };
  if (produced_live >= order.target_live_books) updates.status = 'done';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db.from('kids_batch_orders') as any).update(updates).eq('id', order.id);
  return { produced_live, done: produced_live >= order.target_live_books };
}

async function pickTheme(db: ReturnType<typeof createClient>, lastThemeId: string | null): Promise<string> {
  const { data: themes } = await db.from('kids_themes').select('id').order('slug');
  const all = (themes ?? []).map(t => t.id as string);
  if (all.length === 0) throw new Error('no themes available');
  const candidates = all.filter(id => id !== lastThemeId);
  const pool = candidates.length > 0 ? candidates : all;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickLane(lastLane: string | null): string {
  const pool = LANE_ROTATION.filter(l => l !== lastLane);
  const from = pool.length > 0 ? pool : LANE_ROTATION;
  return from[Math.floor(Math.random() * from.length)];
}

async function tick() {
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: order, error } = await db.from('kids_batch_orders')
    .select('id, target_live_books, produced_live, status, last_used_theme_id, last_used_lane, counted_ebook_ids, created_at')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!order) return { skipped: 'no_active_order' };

  // --- P0 REGRESSION GUARD (one_shot_fix_never_repeat, rule 3) ---
  // Trigger ONLY on code/infrastructure classes that recur (a true regression:
  // something that was fixed and came back). Content-quality verdicts like
  // story_gate are honest gate outputs — normal attrition that routes to the
  // learn-then-retry cadence, NOT a reason to halt production.
  // See supabase/functions/_shared/blocker-taxonomy.ts.
  const { data: recentFails } = await db.from('autopilot_kids_runs')
    .select('ebook_kids_id, blocker_reason')
    .eq('status', 'failed')
    .not('blocker_reason', 'is', null)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(200);
  const classCounts = new Map<string, Set<string>>();
  const contentCounts = new Map<string, Set<string>>();
  for (const r of (recentFails ?? []) as Array<{ ebook_kids_id: string | null; blocker_reason: string }>) {
    if (!r.ebook_kids_id) continue;
    const { klass } = classifyBlocker(r.bookker_reason ?? r.blocker_reason);
    const bucket = armsRegressionPause(r.blocker_reason) ? classCounts : contentCounts;
    const set = bucket.get(klass) ?? new Set<string>();
    set.add(r.ebook_kids_id);
    bucket.set(klass, set);
  }
  const regression = [...classCounts.entries()].find(([, s]) => s.size >= 2);
  if (regression) {
    const [cls, books] = regression;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.from('kids_batch_orders') as any)
      .update({ status: 'paused', notes: `P0 regression pause: CODE-class blocker "${cls}" hit ${books.size} books in 24h. Fix regression before resume.` })
      .eq('id', (order as { id: string }).id);
    console.warn('[batch-producer] P0 REGRESSION PAUSE (code class)', cls, [...books]);
    return { paused: true, reason: 'p0_regression', blocker_class: cls, affected_books: [...books] };
  }
  if (contentCounts.size > 0) {
    // Content attrition is expected. Log for observability; do not pause.
    const summary = [...contentCounts.entries()].map(([k, s]) => `${k}:${s.size}`).join(', ');
    console.log('[batch-producer] content attrition in 24h (no pause):', summary);
  }

  const rec = await reconcile(db, order as {
    id: string; created_at: string; counted_ebook_ids: string[]; target_live_books: number;
  });
  if (rec.done) return { skipped: 'target_reached', produced_live: rec.produced_live };

  // Singleton check.
  const { data: active } = await db.from('autopilot_kids_runs')
    .select('id')
    .in('status', ['queued', 'running'])
    .eq('current_step', 'parent_job')
    .limit(1);
  if ((active?.length ?? 0) > 0) {
    return { skipped: 'parent_run_active', active_id: active![0].id };
  }


  const themeId = await pickTheme(db, (order as { last_used_theme_id: string | null }).last_used_theme_id);
  const lane = pickLane((order as { last_used_lane: string | null }).last_used_lane);

  const r = await fetch(`${SUPABASE_URL}/functions/v1/kids-one-click-build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ age_band: '4-6', theme_ids: [themeId], preferred_lanes: [lane] }),
  });
  const t = await r.text().catch(() => '');
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(t); } catch { parsed = { raw: t.slice(0, 200) }; }

  if (r.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.from('kids_batch_orders') as any)
      .update({ last_used_theme_id: themeId, last_used_lane: lane })
      .eq('id', (order as { id: string }).id);
  }

  console.log('kids-batch-producer dispatched', JSON.stringify({
    order_id: (order as { id: string }).id,
    theme_id: themeId, lane, http: r.status, parsed,
  }));
  return { launched: r.ok, http: r.status, theme_id: themeId, lane, response: parsed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const result = await tick();
    return json({ ok: true, ...result });
  } catch (e) {
    console.error('kids-batch-producer error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
