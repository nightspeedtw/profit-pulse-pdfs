// coloring-v2-autopilot — creates fresh V2 books toward a per-day cap,
// spreading across age bands + a curated theme rotator. Fire-and-forget
// dispatch to coloring-v2-start. Bounded slot count. Never blocks the tick.
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;
declare const EdgeRuntime: any;

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = () => createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const AGE_BANDS = ["2-4", "4-6", "6-8", "8-12", "13-17"];

const THEME_POOL: Record<string, string[]> = {
  "2-4":   ["Friendly Farm Animals", "Chunky Vehicles", "First ABCs", "Playful Sea Creatures", "Cuddly Bears"],
  "4-6":   ["Magical Unicorns", "Brave Dinosaurs", "Enchanted Forest", "Under the Sea Adventure", "Space Explorers"],
  "6-8":   ["Mythic Creatures", "Fairy Garden Kingdom", "Robot Inventors", "Jungle Safari", "Dragon Riders"],
  "8-12":  ["Cyberpunk Cats", "Steampunk Airships", "Deep Sea Discovery", "Fantasy Warriors", "Space Colony"],
  "13-17": ["Neon Rebellion", "Sacred Geometry Mandalas", "Anime Skylines", "Mythic Constellations", "Dystopian Cityscapes"],
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-passcode",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (x: any, s = 200) => new Response(JSON.stringify(x), {
  status: s, headers: { ...CORS, "Content-Type": "application/json" },
});

async function alreadyUsedTitles(c: any, band: string): Promise<Set<string>> {
  const { data } = await c.from("coloring_v2_books")
    .select("theme").eq("age_band", band).limit(200);
  return new Set((data ?? []).map((r: any) => String(r.theme ?? "").toLowerCase().trim()));
}

async function pickTheme(c: any, band: string): Promise<string | null> {
  const pool = THEME_POOL[band] ?? [];
  const used = await alreadyUsedTitles(c, band);
  for (const t of pool) if (!used.has(t.toLowerCase())) return t;
  // fallback: rotate with variant suffix
  const base = pool[Math.floor(Math.random() * pool.length)] ?? "Coloring Adventure";
  return `${base} Volume ${Math.floor(Math.random() * 900) + 100}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const manual = body?.manual === true;
    const overrideBatch: number | null = typeof body?.override_batch === "number" ? body.override_batch : null;

    const c = db();

    // Frozen kill-switch
    const { data: frozenRow } = await c.from("platform_settings").select("value_json").eq("key", "autopilot_frozen").maybeSingle();
    const frozen = frozenRow?.value_json === true || frozenRow?.value_json === "true" || frozenRow?.value_json?.frozen === true;
    if (frozen) return j({ ok: true, frozen: true });

    // Cutover flag
    const { data: flagRow } = await c.from("platform_settings").select("value_json").eq("key", "ENABLE_COLORING_LANE_V2").maybeSingle();
    const flagEnabled = flagRow?.value_json?.enabled !== false;
    if (!flagEnabled) return j({ ok: true, disabled_by_flag: true });

    // Read config (optional row)
    const { data: cfgRow } = await c.from("platform_settings").select("value_json").eq("key", "coloring_v2_autopilot_config").maybeSingle();
    const cfg = {
      enabled: true,
      daily_cap: 10,
      max_in_flight: 6,
      page_count: 32,
      ...(cfgRow?.value_json ?? {}),
    };
    if (!cfg.enabled && !manual) return j({ ok: true, disabled: true });

    // Count created today + currently in-flight
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { count: createdToday } = await c.from("coloring_v2_books")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayStart.toISOString());
    const { count: inFlight } = await c.from("coloring_v2_books")
      .select("id", { count: "exact", head: true })
      .neq("publish_status", "live").neq("stage", "failed");

    const capRemain = Math.max(0, cfg.daily_cap - (createdToday ?? 0));
    const flightRemain = Math.max(0, cfg.max_in_flight - (inFlight ?? 0));
    let slots = Math.min(capRemain, flightRemain);
    if (overrideBatch && manual) slots = Math.min(slots || overrideBatch, overrideBatch);
    if (slots <= 0) return j({ ok: true, skipped: "cap_or_flight_reached", created_today: createdToday, in_flight: inFlight });

    // Pick age bands round-robin from bands with fewest live books, then create.
    const { data: liveByBand } = await c.from("coloring_v2_books")
      .select("age_band").eq("publish_status", "live").limit(500);
    const liveCounts: Record<string, number> = {};
    for (const b of AGE_BANDS) liveCounts[b] = 0;
    for (const r of (liveByBand ?? [])) liveCounts[r.age_band] = (liveCounts[r.age_band] ?? 0) + 1;
    const bandOrder = [...AGE_BANDS].sort((a, b) => liveCounts[a] - liveCounts[b]);

    const dispatched: any[] = [];
    const plan: any[] = [];
    for (let i = 0; i < slots; i++) {
      const band = bandOrder[i % bandOrder.length];
      const theme = await pickTheme(c, band);
      if (!theme) continue;
      plan.push({ age_band: band, theme, page_count: cfg.page_count });
    }

    const dispatchWork = (async () => {
      for (const p of plan) {
        try {
          const res = await fetch(`${SB_URL}/functions/v1/coloring-v2-start`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SB_KEY}`,
              apikey: SB_KEY,
            },
            body: JSON.stringify({
              age_band: p.age_band,
              theme: p.theme,
              page_count: p.page_count,
              autopilot_mode: "full_auto",
              provider_mode: "auto",
              main_character_mode: "auto",
              daily_cost_ceiling_usd: 25,
            }),
            signal: AbortSignal.timeout(4000),
          }).catch((e) => ({ ok: false, _err: String(e) } as any));
          dispatched.push({ ...p, ok: (res as any)?.ok ?? false });
        } catch (e: any) {
          dispatched.push({ ...p, ok: false, error: e?.message ?? String(e) });
        }
      }
    })();
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(dispatchWork);
    } else {
      void dispatchWork;
    }

    return j({
      ok: true, planned: plan.length, created_today: createdToday, in_flight: inFlight,
      plan, elapsed_ms: Date.now() - t0,
    });
  } catch (e: any) {
    return j({ error: e?.message ?? String(e) }, 500);
  }
});
