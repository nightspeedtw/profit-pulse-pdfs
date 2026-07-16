// Autopilot 24/7 tick — runs every 5 min via pg_cron.
//
// Responsibilities (strict QC, no soft-pass):
//  1. Reap stuck pipeline runs (no heartbeat > stuck_run_ttl_min → needs_review).
//  2. Start new runs up to max_parallel_books, capped by max_books_per_day and daily_cost_cap_usd.
//     Generate fresh ideas if the pool is dry.
//  3. Publish ebooks that pass strict live gate (final ≥90, cover ≥85, compliance ≥90,
//     qc_downgraded=false, PDF/thumbnail/price/copy present). Any hour — not gated to publish_hour.
//  4. Record last_tick_at + last_tick_result on generation_settings.
import { corsHeaders, admin } from "../_shared/ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AUTH = { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" };

async function invoke(fn: string, body: unknown) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST", headers: AUTH, body: JSON.stringify(body ?? {}),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body: j };
  } catch (e) {
    return { ok: false, status: 0, body: { error: String(e) } };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = admin();
  const startedAt = new Date().toISOString();
  const result: Record<string, unknown> = { tick_at: startedAt };

  try {
    const { data: s } = await db.from("generation_settings").select("*").eq("id", 1).maybeSingle();
    if (!s) return json({ error: "generation_settings missing" }, 500);

    if (!s.autopilot_enabled) return await finish(db, { ...result, skipped: "autopilot disabled" });
    if (s.paused) return await finish(db, { ...result, skipped: "autopilot paused", reason: s.cost_limit_reason ?? null });
    if (s.tick_enabled === false) return await finish(db, { ...result, skipped: "tick disabled" });

    const mode: string = s.autopilot_mode ?? "safe";
    const maxParallel = Math.max(1, Number(s.max_parallel_books ?? 2));
    const maxPerDay = Math.max(0, Number(s.max_books_per_day ?? s.daily_quota ?? 6));
    const dailyBudget = Number(s.daily_cost_cap_usd ?? s.daily_budget_usd ?? 15);
    const stuckTtlMin = Math.max(5, Number(s.stuck_run_ttl_min ?? 15));

    // ---------- 1. Reap stuck runs ----------
    const staleCutoff = new Date(Date.now() - stuckTtlMin * 60_000).toISOString();
    const { data: stuck } = await db.from("autopilot_pipeline_runs")
      .select("id,ebook_id,current_step,updated_at,last_heartbeat_at")
      .in("status", ["running", "queued"])
      .or(`last_heartbeat_at.lt.${staleCutoff},and(last_heartbeat_at.is.null,updated_at.lt.${staleCutoff})`);
    result.reaped = [];
    for (const r of stuck ?? []) {
      await db.from("autopilot_pipeline_runs").update({
        status: "needs_review",
        blocker_reason: `stuck_no_heartbeat_${stuckTtlMin}m`,
        blocker_class: "stuck_timeout",
        updated_at: new Date().toISOString(),
      }).eq("id", r.id);
      if (r.ebook_id) {
        await db.from("ebooks").update({
          autopilot_state: "needs_review",
          admin_needed_reason: `Run stuck at step ${r.current_step} (no heartbeat > ${stuckTtlMin}m)`,
        }).eq("id", r.ebook_id);
      }
      (result.reaped as unknown[]).push({ run_id: r.id, ebook_id: r.ebook_id, step: r.current_step });
    }

    // ---------- 2. Budget + concurrency guard ----------
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { data: costs } = await db.from("cost_log").select("cost_usd").gte("created_at", dayStart.toISOString());
    const spent = (costs ?? []).reduce((a, c) => a + Number(c.cost_usd ?? 0), 0);
    result.spent_today = Number(spent.toFixed(4));
    result.budget = dailyBudget;

    if (spent >= dailyBudget) {
      await db.from("generation_settings").update({
        paused: true, cost_limit_reached: true, cost_limit_reached_at: new Date().toISOString(),
        cost_limit_reason: `daily_cost_cap_reached ($${spent.toFixed(2)} ≥ $${dailyBudget})`,
      }).eq("id", 1);
      result.auto_paused = "daily_cost_cap_reached";
    }

    const { count: activeRuns } = await db.from("autopilot_pipeline_runs")
      .select("id", { count: "exact", head: true })
      .in("status", ["running", "queued"]);
    result.active_runs = activeRuns ?? 0;

    const { count: startedToday } = await db.from("ebooks")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayStart.toISOString())
      .neq("autopilot_state", "idle");
    result.started_today = startedToday ?? 0;

    // ---------- 3. Start new runs ----------
    const capacity = Math.max(0, Math.min(
      maxParallel - (activeRuns ?? 0),
      maxPerDay - (startedToday ?? 0),
    ));
    result.capacity_to_start = capacity;

    if (capacity > 0 && spent < dailyBudget && !result.auto_paused) {
      // Ensure fresh ideas
      const { count: ideaPool } = await db.from("ebook_ideas")
        .select("id", { count: "exact", head: true })
        .in("status", ["idea", "approved"]);
      if ((ideaPool ?? 0) < capacity * 2) {
        const gen = await invoke("generate-idea", { count: Math.min(capacity * 3, 15) });
        result.ideas_generated = gen.ok;
      }

      const { data: ideas } = await db.from("ebook_ideas")
        .select("id,title")
        .in("status", ["idea", "approved"])
        .order("total_score", { ascending: false, nullsFirst: false })
        .limit(capacity);

      const launched: unknown[] = [];
      for (const i of ideas ?? []) {
        const r = await invoke("autopilot-pipeline", { idea_id: i.id, mode });
        launched.push({ idea_id: i.id, title: i.title, ok: r.ok, status: r.status });
      }
      result.launched = launched;
    }

    // ---------- 4. Publish ready ebooks (strict gate, any hour) ----------
    const minFinal = Math.max(90, Number(s.minimum_qc_pass_rate ?? 90));
    const minCover = 85;
    const minCompliance = 90;
    const { data: candidates } = await db.from("ebooks")
      .select("id,title,pdf_url,cover_url,thumbnail_url,price,product_description,short_hook,selling_hook,final_quality_score,cover_score,compliance_safety_score,qc_downgraded,page_count,listing_status,autopilot_state")
      .in("autopilot_state", ["ready_to_publish"]);
    const published: unknown[] = [];
    const skipped: unknown[] = [];
    for (const e of candidates ?? []) {
      const reasons: string[] = [];
      if (!e.pdf_url) reasons.push("missing_pdf");
      if (!e.cover_url && !e.thumbnail_url) reasons.push("missing_thumbnail");
      if (!e.price || Number(e.price) <= 0) reasons.push("missing_price");
      if (!e.page_count || Number(e.page_count) <= 0) reasons.push("missing_page_count");
      if (!(e.product_description || e.short_hook || e.selling_hook)) reasons.push("missing_listing_copy");
      if (e.listing_status === "listed") reasons.push("already_listed");
      if (e.qc_downgraded === true) reasons.push("qc_soft_pass_blocked_from_live");
      if (Number(e.final_quality_score ?? 0) < minFinal) reasons.push(`final_quality_score<${minFinal}`);
      if (Number(e.cover_score ?? 0) < minCover) reasons.push(`cover_score<${minCover}`);
      if (Number(e.compliance_safety_score ?? 0) < minCompliance) reasons.push(`compliance_safety_score<${minCompliance}`);
      if (reasons.length) { skipped.push({ ebook_id: e.id, title: e.title, reasons }); continue; }
      const r = await invoke("auto-list-ebook", { ebook_id: e.id });
      published.push({ ebook_id: e.id, title: e.title, ok: r.ok, status: r.status });
    }
    result.published = published;
    result.publish_skipped = skipped;

    // ---------- 5. Coloring-book autopilot fan-out (non-blocking) ----------
    try {
      const cb = await invoke("coloring-autopilot-tick", {});
      result.coloring_autopilot = { ok: cb.ok, status: cb.status, body: cb.body };
    } catch (e) {
      result.coloring_autopilot = { ok: false, error: String(e) };
    }

    return await finish(db, result);
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    return await finish(db, result, 500);
  }
});

async function finish(db: ReturnType<typeof admin>, result: Record<string, unknown>, status = 200) {
  try {
    await db.from("generation_settings").update({
      last_tick_at: new Date().toISOString(),
      last_tick_result: result,
    }).eq("id", 1);
  } catch { /* ignore */ }
  return json(result, status);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
