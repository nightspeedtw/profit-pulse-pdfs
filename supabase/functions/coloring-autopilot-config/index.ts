// coloring-autopilot-config — GET/POST the coloring_autopilot settings
// stored on generation_settings.id = 1. Admin-only (has_role check).

// @ts-nocheck
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-passcode",
};

const PASSCODE = Deno.env.get("ADMIN_PASSCODE") ?? "453451";

const DEFAULTS = {
  enabled: false,
  paused: false,
  topic_mode: "random",
  specific_category_key: null,
  age_band: "4-6",
  page_count: 32,
  batch_size: 1,
  daily_cap: 3,
  daily_stop_utc: "22:00",
  max_parallel: 1,
  daily_cost_cap_usd_coloring: 5,
  // Owner pricing law (see supabase/functions/_shared/coloring/pricing.ts).
  // Data-only config; edit here or via generation_settings.coloring_autopilot.pricing.
  pricing: {
    anchors: [
      { pages: 4,  price_cents: 199 },
      { pages: 16, price_cents: 599 },
      { pages: 24, price_cents: 799 },
      { pages: 32, price_cents: 999 },
      { pages: 48, price_cents: 1299 },
    ],
    ceiling_cents: 1699,
    popularity: {
      top10_multiplier: 1.40,
      top25_multiplier: 1.20,
      weights: { view: 1, preview: 3, purchase: 10 },
      lookback_days: 30,
      reprice_cooldown_hours: 24,
    },
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Passcode auth (matches admin-data pattern).
    let body: any = {};
    try { body = await req.clone().json(); } catch { /* GET */ }
    const supplied = req.headers.get("x-admin-passcode") ?? body?.passcode ?? "";
    if (supplied !== PASSCODE) return json({ error: "unauthenticated" }, 401);

    const admin = createClient(url, service, { auth: { persistSession: false } });

    // Determine intent: presence of `config` in body = save; otherwise = load.
    const isSave = body && typeof body === "object" && body.config;
    if (!isSave) {
      const { data } = await admin
        .from("generation_settings").select("coloring_autopilot").eq("id", 1).maybeSingle();
      const { data: cats } = await admin
        .from("coloring_categories").select("category_key, category_name, target_age_min, target_age_max")
        .order("category_key");
      // Status snapshot for the coloring queue only (independent engine).
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
      const [queuedRes, generatingRes, cancelledRes, publishedTodayRes, todayTotalRes, recentRes] = await Promise.all([
        admin.from("ebooks_kids").select("id", { count: "exact", head: true })
          .eq("book_type", "coloring_book").eq("pipeline_status", "queued"),
        admin.from("ebooks_kids").select("id", { count: "exact", head: true })
          .eq("book_type", "coloring_book").eq("pipeline_status", "generating"),
        admin.from("ebooks_kids").select("id", { count: "exact", head: true })
          .eq("book_type", "coloring_book").eq("pipeline_status", "cancelled"),
        admin.from("ebooks_kids").select("id", { count: "exact", head: true })
          .eq("book_type", "coloring_book").eq("listing_status", "live")
          .gte("created_at", dayStart.toISOString()),
        admin.from("ebooks_kids").select("id", { count: "exact", head: true })
          .eq("book_type", "coloring_book").gte("created_at", dayStart.toISOString()),
        admin.from("ebooks_kids")
          .select("id,title,pipeline_status,listing_status,created_at,metadata")
          .eq("book_type", "coloring_book")
          .order("created_at", { ascending: false }).limit(8),
      ]);
      const cfg = { ...DEFAULTS, ...(data?.coloring_autopilot ?? {}) };
      const recent = (recentRes.data ?? []).map((r: any) => ({
        id: r.id,
        title: r.title,
        pipeline_status: r.pipeline_status,
        listing_status: r.listing_status,
        created_at: r.created_at,
        angle: r.metadata?.coloring_angle ?? null,
        variant_number: r.metadata?.coloring_variant ?? null,
        progress_percent: Number(r.metadata?.coloring_progress_percent ?? 0),
        current_step_label: r.metadata?.coloring_current_step_label ?? null,
        awaiting: r.metadata?.awaiting ?? null,
      }));
      const engineAwaitingP0 = recent.some((r) => r.awaiting === "post_p0_coloring_render_engine" || r.awaiting === "p0_close_before_generation");
      return json({
        config: cfg,
        categories: cats ?? [],
        status: {
          queued: queuedRes.count ?? 0,
          generating: generatingRes.count ?? 0,
          cancelled: cancelledRes.count ?? 0,
          published_today: publishedTodayRes.count ?? 0,
          created_today: todayTotalRes.count ?? 0,
          paused: !!cfg.paused,
          engine_awaiting_p0: engineAwaitingP0,
          last_worker_tick_at: cfg.last_worker_tick_at ?? null,
          last_worker_tick_result: cfg.last_worker_tick_result ?? null,
          recent,
        },
      });
    }

    // Save path: preserve internal telemetry fields not sent by client.
    const { data: existingRow } = await admin
      .from("generation_settings").select("coloring_autopilot").eq("id", 1).maybeSingle();
    const existing = existingRow?.coloring_autopilot ?? {};
    const merged = { ...DEFAULTS, ...existing, ...(body.config ?? {}) };
    merged.batch_size = Math.max(1, Math.min(20, Number(merged.batch_size) || 1));
    merged.daily_cap = Math.max(0, Math.min(100, Number(merged.daily_cap) || 0));
    merged.max_parallel = Math.max(1, Math.min(4, Number(merged.max_parallel) || 1));
    merged.daily_cost_cap_usd_coloring = Math.max(0, Math.min(500, Number(merged.daily_cost_cap_usd_coloring) || 0));
    merged.paused = !!merged.paused;
    merged.page_count = [24, 32, 48].includes(Number(merged.page_count)) ? Number(merged.page_count) : 32;
    if (!["2-4", "3-5", "4-6", "6-8", "8-12", "13-17", "all_ages"].includes(merged.age_band)) merged.age_band = "4-6";
    if (!["random", "specific"].includes(merged.topic_mode)) merged.topic_mode = "random";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(merged.daily_stop_utc))) merged.daily_stop_utc = "22:00";
    // Preserve telemetry
    merged.last_worker_tick_at = existing.last_worker_tick_at ?? null;
    merged.last_worker_tick_result = existing.last_worker_tick_result ?? null;
    const { error } = await admin.from("generation_settings")
      .update({ coloring_autopilot: merged }).eq("id", 1);
    if (error) throw error;
    return json({ ok: true, config: merged });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
