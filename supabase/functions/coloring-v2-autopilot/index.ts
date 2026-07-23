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

// Themes grouped into 5 buckets so rotation forces topic variety across
// the shelf. Every 5 books, all buckets should get hit at least once.
type Bucket = "animals_nature" | "vehicles_city_jobs" | "food_daily_life" | "world_culture_travel" | "imagination_fantasy_space";
const BUCKETS: Bucket[] = ["animals_nature", "vehicles_city_jobs", "food_daily_life", "world_culture_travel", "imagination_fantasy_space"];

const THEME_BUCKETS: Record<string, Record<Bucket, string[]>> = {
  "2-4": {
    animals_nature:        ["Friendly Farm Animals", "Playful Sea Creatures", "Cuddly Bear Cubs", "Backyard Bugs", "Baby Zoo Friends"],
    vehicles_city_jobs:    ["Chunky Vehicles", "Little Firefighters", "Toy Trains", "Busy Builders", "Post Office Day"],
    food_daily_life:       ["Ice Cream Truck", "Bakery Morning", "Pajama Party", "Bath Time Bubbles", "First ABCs"],
    world_culture_travel:  ["Tiny World Passports", "Beach Day Around the World", "Festival Lanterns", "Snowy Village Friends", "Market Day Colors"],
    imagination_fantasy_space: ["Cloud Kingdom", "Dream Balloons", "Tiny Rocket Trip", "Sleepy Moon Friends", "Rainbow Dreams"],
  },
  "4-6": {
    animals_nature:        ["Jungle Safari Friends", "Coral Reef Explorers", "Arctic Adventures", "Rainforest Canopy", "Prairie Wildlife Day"],
    vehicles_city_jobs:    ["Fire Station Heroes", "Robot Workshop", "Chef's Kitchen", "Construction Zone", "Pilot's Sky Tour"],
    food_daily_life:       ["Farmer's Market", "Backyard Garden", "Toy Store Wonders", "Doughnut Diner", "Rainy Day Indoors"],
    world_culture_travel:  ["Tokyo Neon Streets", "Kyoto Cherry Blossom", "Marrakech Market", "Rio Carnival", "Reykjavik Puffins"],
    imagination_fantasy_space: ["Magical Unicorns", "Enchanted Forest", "Space Explorers", "Brave Dinosaurs", "Cosmic Whales"],
  },
  "6-8": {
    animals_nature:        ["Deep Ocean Discoveries", "Savanna Sunset", "Mountain Bear Country", "Desert Cactus Wildlife", "Coral Reef Detectives"],
    vehicles_city_jobs:    ["Skyline Rescue Crew", "Robot Inventors", "Bakery Boss", "Aviation Museum", "Deep Sea Submariner"],
    food_daily_life:       ["Street Food Festival", "Boba Tea Shop", "Farmer's Market Fair", "School Field Day", "Weekend Farmers Fair"],
    world_culture_travel:  ["Kyoto Lantern Night", "Mexican Mercado", "Nordic Aurora", "Sahara Caravan", "Andes Village"],
    imagination_fantasy_space: ["Mythic Creatures", "Fairy Garden Kingdom", "Dragon Riders", "Cosmic Whale Migration", "Time-Machine Tea Party"],
  },
  "8-12": {
    animals_nature:        ["Deep Sea Discovery", "Endangered Species Portraits", "Amazon Canopy", "Arctic Wildlife Journal", "Coral Reef Biome"],
    vehicles_city_jobs:    ["Steampunk Airships", "Space Colony Engineer", "Cyberpunk Repair Shop", "Race Track Pit Crew", "Robotics Lab"],
    food_daily_life:       ["Ramen Alley Night", "Vintage Diner", "Global Street Eats", "Skate Park Weekend", "Backyard Astronomy Night"],
    world_culture_travel:  ["Istanbul Bazaar", "Petra Ancient City", "Icelandic Coast", "Havana Streets", "Kyoto Alleyways"],
    imagination_fantasy_space: ["Cyberpunk Cats", "Fantasy Warriors", "Sky Pirates", "Moon Colony Kids", "Underwater Kingdom"],
  },
  "13-17": {
    animals_nature:        ["Bioluminescent Reefs", "Endangered Portraits", "Rewilding Landscapes", "Botanical Studies", "Aurora Wildlife"],
    vehicles_city_jobs:    ["Neon City Motorcycles", "Formula Circuit", "Space Station Interiors", "Vintage Aviation", "Modern Architecture Studies"],
    food_daily_life:       ["Cafe Aesthetic", "Night Market Neon", "Skateboard Culture", "Vinyl Record Shop", "Coffee Studio"],
    world_culture_travel:  ["Anime Skylines", "Marrakech Souks", "Reykjavik Aurora", "Kyoto Alley Night", "Havana Vintage"],
    imagination_fantasy_space: ["Neon Rebellion", "Sacred Geometry Mandalas", "Mythic Constellations", "Dystopian Cityscapes", "Cosmic Warriors"],
  },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-passcode",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (x: any, s = 200) => new Response(JSON.stringify(x), {
  status: s, headers: { ...CORS, "Content-Type": "application/json" },
});

const ADJECTIVES = ["Sparkling", "Mighty", "Cozy", "Radiant", "Whimsical", "Golden", "Twilight", "Sunny", "Dreamy", "Bold"];

function themeToBucket(band: string, theme: string): Bucket | null {
  const t = String(theme ?? "").toLowerCase().trim();
  const bands = THEME_BUCKETS[band] ?? {};
  for (const b of BUCKETS) {
    if ((bands[b] ?? []).some((x) => x.toLowerCase() === t)) return b;
  }
  return null;
}

async function pickTheme(c: any, band: string): Promise<{ theme: string; bucket: Bucket } | null> {
  const bands = THEME_BUCKETS[band];
  if (!bands) return null;

  // Look at the last 10 books in this age band to compute bucket distribution.
  const { data: recent } = await c.from("coloring_v2_books")
    .select("theme").eq("age_band", band).order("created_at", { ascending: false }).limit(10);
  const bucketCounts: Record<Bucket, number> = {
    animals_nature: 0, vehicles_city_jobs: 0, food_daily_life: 0,
    world_culture_travel: 0, imagination_fantasy_space: 0,
  };
  for (const r of (recent ?? [])) {
    const b = themeToBucket(band, r.theme ?? "");
    if (b) bucketCounts[b]++;
  }
  // Pick bucket with fewest hits (ties broken randomly)
  const minCount = Math.min(...BUCKETS.map((b) => bucketCounts[b]));
  const candidates = BUCKETS.filter((b) => bucketCounts[b] === minCount);
  const chosenBucket = candidates[Math.floor(Math.random() * candidates.length)];

  // Used titles overall in this band
  const { data: usedRows } = await c.from("coloring_v2_books")
    .select("theme").eq("age_band", band).limit(500);
  const used = new Set((usedRows ?? []).map((r: any) => String(r.theme ?? "").toLowerCase().trim()));

  const pool = bands[chosenBucket] ?? [];
  const unused = pool.filter((t) => !used.has(t.toLowerCase()));
  if (unused.length) {
    return { theme: unused[Math.floor(Math.random() * unused.length)], bucket: chosenBucket };
  }
  // Compound fallback (no "Volume N" numeric suffixes)
  const base = pool[Math.floor(Math.random() * Math.max(1, pool.length))] ?? "Coloring Adventure";
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  return { theme: `${adj} ${base}`, bucket: chosenBucket };
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

    // Read config (optional row). Defaults are UNLIMITED (0) so a missing/
    // unreadable row can never impose a stealth cap.
    const { data: cfgRow, error: cfgErr } = await c.from("platform_settings").select("value_json").eq("key", "coloring_v2_autopilot_config").maybeSingle();
    const cfg = {
      enabled: true,
      daily_cap: 0,
      max_in_flight: 0,
      page_count: 32,
      legacy_overlay_sweep: true,
      ...(cfgRow?.value_json ?? {}),
    };
    console.log("[v2-autopilot] cfg", { daily_cap: cfg.daily_cap, max_in_flight: cfg.max_in_flight, cfgRowPresent: !!cfgRow, cfgErr: cfgErr?.message });

    // ── LEGACY COVER SWEEP (cover_bake_only_v6) ───────────────────────
    // Any cover asset whose meta.overlay !== the current bake-only contract
    // is legacy (SVG-overlay text was composited on top). Reset its book to
    // stage 'cover' so this tick regenerates it with title + age fully baked.
    const CURRENT_OVERLAY = "cover_bake_only_v6_no_overlay_ever";
    const sweptBookIds: string[] = [];
    if (cfg.legacy_overlay_sweep !== false) {
      const { data: liveBooks } = await c.from("coloring_v2_books")
        .select("id, approved_cover_asset_id")
        .eq("publish_status", "live")
        .not("approved_cover_asset_id", "is", null)
        .limit(50);
      const assetIds = (liveBooks ?? []).map((b: any) => b.approved_cover_asset_id).filter(Boolean);
      if (assetIds.length) {
        const { data: assets } = await c.from("coloring_v2_assets")
          .select("id, meta").in("id", assetIds);
        const legacyAssetIds = new Set(
          (assets ?? [])
            .filter((a: any) => (a.meta?.overlay ?? null) !== CURRENT_OVERLAY)
            .map((a: any) => a.id)
        );
        for (const b of (liveBooks ?? [])) {
          if (legacyAssetIds.has(b.approved_cover_asset_id)) sweptBookIds.push(b.id);
        }
        if (sweptBookIds.length) {
          await c.from("coloring_v2_books").update({
            stage: "cover", stage_updated_at: new Date().toISOString(),
            stage_attempt_count: 0, last_error: null,
          }).in("id", sweptBookIds);
          // fire-and-forget cover regen dispatches (does not consume slots)
          for (const id of sweptBookIds) {
            fetch(`${SB_URL}/functions/v1/coloring-v2-cover`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY },
              body: JSON.stringify({ book_id: id }),
              signal: AbortSignal.timeout(4000),
            }).catch(() => {});
          }
        }
      }
    }
    if (!cfg.enabled && !manual) return j({ ok: true, disabled: true });

    // Count created today + currently in-flight
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { count: createdToday } = await c.from("coloring_v2_books")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayStart.toISOString());
    const { count: inFlight } = await c.from("coloring_v2_books")
      .select("id", { count: "exact", head: true })
      .neq("publish_status", "live").neq("stage", "failed");

    // daily_cap = 0 means unlimited; same for max_in_flight
    const capRemain = cfg.daily_cap > 0 ? Math.max(0, cfg.daily_cap - (createdToday ?? 0)) : Number.POSITIVE_INFINITY;
    const flightRemain = cfg.max_in_flight > 0 ? Math.max(0, cfg.max_in_flight - (inFlight ?? 0)) : Number.POSITIVE_INFINITY;
    let slots = Math.min(capRemain, flightRemain);
    if (!Number.isFinite(slots)) slots = overrideBatch && manual ? overrideBatch : 25;
    if (overrideBatch && manual) slots = Math.min(slots || overrideBatch, overrideBatch);
    if (slots <= 0) return j({ ok: true, skipped: "cap_or_flight_reached", created_today: createdToday, in_flight: inFlight, legacy_covers_swept: sweptBookIds.length, swept_book_ids: sweptBookIds });

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
      const picked = await pickTheme(c, band);
      if (!picked) continue;
      plan.push({ age_band: band, theme: picked.theme, bucket: picked.bucket, page_count: cfg.page_count });
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
      legacy_covers_swept: sweptBookIds.length, swept_book_ids: sweptBookIds,
      plan, elapsed_ms: Date.now() - t0,
    });
  } catch (e: any) {
    return j({ error: e?.message ?? String(e) }, 500);
  }
});
