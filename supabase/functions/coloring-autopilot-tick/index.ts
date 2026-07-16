// coloring-autopilot-tick — invoked by the 5-min cron AND by the admin
// "Run now" button. Queues coloring-book rows via coloring-book-start.
//
// Body (all optional):
//   { manual?: boolean, override_batch?: number }
//
// Guards (all must pass unless `manual=true` bypasses schedule):
//   - config.enabled
//   - now UTC ≤ daily_stop_utc
//   - queued+published today < daily_cap
//   - generation_settings.paused=false (cost cap)
//
// Non-goals: does NOT flip P0 lane; coloring rows remain queued behind
// sequential-safe lock. This function only inserts ebooks_kids rows.

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
  topic_mode: "random",
  specific_category_key: null,
  age_band: "4-6",
  page_count: 32,
  batch_size: 1,
  daily_cap: 3,
  daily_stop_utc: "22:00",
};

function titleFor(catName: string, ageBand: string): string {
  const openers = ["Adventures", "Fun", "Wonders", "Friends", "Big Book of"];
  const pick = openers[Math.floor(Math.random() * openers.length)];
  return `${catName} Coloring ${pick} (Ages ${ageBand})`;
}

function weightedPick<T extends { weight?: number }>(items: T[]): T {
  const total = items.reduce((s, x) => s + Math.max(1, x.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= Math.max(1, it.weight ?? 1);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service, { auth: { persistSession: false } });

  const startedAt = new Date().toISOString();
  const result: Record<string, unknown> = { tick_at: startedAt, queued: [], skipped: null };

  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* cron call */ }
    const manual = !!body.manual;

    // If manual invocation, require admin passcode.
    if (manual) {
      const supplied = req.headers.get("x-admin-passcode") ?? body?.passcode ?? "";
      if (supplied !== PASSCODE) return json({ error: "unauthenticated" }, 401);
    }

    const { data: gs } = await db
      .from("generation_settings").select("paused, coloring_autopilot").eq("id", 1).maybeSingle();
    const cfg = { ...DEFAULTS, ...(gs?.coloring_autopilot ?? {}) };
    result.config = cfg;

    // Coloring engine runs on its own queue — independent of the picture-book
    // autopilot pause/cost cap. Only the coloring config controls it.
    if (!manual && !cfg.enabled) { result.skipped = "autopilot_disabled"; return json(result); }

    // Time window (skip for manual).
    if (!manual) {
      const now = new Date();
      const hh = String(now.getUTCHours()).padStart(2, "0");
      const mm = String(now.getUTCMinutes()).padStart(2, "0");
      if (`${hh}:${mm}` > String(cfg.daily_stop_utc)) {
        result.skipped = `past_daily_stop_utc_${cfg.daily_stop_utc}`;
        return json(result);
      }
    }

    // Daily cap: count coloring rows created today UTC.
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { count: todayCount } = await db
      .from("ebooks_kids")
      .select("id", { count: "exact", head: true })
      .eq("book_type", "coloring_book")
      .gte("created_at", dayStart.toISOString());
    result.today_count = todayCount ?? 0;
    const remainingToday = Math.max(0, Number(cfg.daily_cap) - (todayCount ?? 0));
    if (remainingToday === 0 && !manual) {
      result.skipped = "daily_cap_reached";
      return json(result);
    }

    const requested = Number(body.override_batch ?? cfg.batch_size) || 1;
    const slots = manual ? requested : Math.min(requested, remainingToday);
    result.slots = slots;
    if (slots <= 0) { result.skipped = "no_slots"; return json(result); }

    // Load categories.
    const { data: allCats } = await db
      .from("coloring_categories")
      .select("category_key, category_name");
    if (!allCats || allCats.length === 0) {
      result.skipped = "no_categories_seeded";
      return json(result);
    }

    for (let i = 0; i < slots; i++) {
      let cat: { category_key: string; category_name: string };
      if (cfg.topic_mode === "specific" && cfg.specific_category_key) {
        cat = allCats.find((c: any) => c.category_key === cfg.specific_category_key) ?? allCats[0];
      } else {
        cat = weightedPick(allCats as any);
      }
      const title = titleFor(cat.category_name, cfg.age_band);
      const r = await fetch(`${url}/functions/v1/coloring-book-start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${service}`,
          apikey: service,
        },
        body: JSON.stringify({
          category_key: cat.category_key,
          title,
          age_band: cfg.age_band,
          page_count: cfg.page_count,
        }),
      });
      const j = await r.json().catch(() => ({}));
      (result.queued as unknown[]).push({
        ok: r.ok, status: r.status,
        category_key: cat.category_key, title,
        ebook_id: j?.ebook_id ?? null,
        error: j?.error ?? null,
      });
    }
    return json(result);
  } catch (e: any) {
    result.error = e?.message ?? String(e);
    return json(result, 500);
  }
});

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
