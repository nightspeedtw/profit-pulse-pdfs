// coloring-v2-start — isolated V2 lane entry.
// Validates input, creates a coloring_v2_books row, opens a run, and
// fire-and-forgets the concept stage. Never touches v1 tables/functions.
// @ts-nocheck
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { FEATURES } from "../_shared/features.ts";

declare const Deno: any;

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const ALLOWED_BANDS = new Set(["4-6", "7-9", "8-12", "13+"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!FEATURES.ENABLE_COLORING_LANE_V2) {
      return json({ error: "coloring_lane_v2_disabled" }, 403);
    }
    const body = await req.json().catch(() => ({}));
    const {
      age_band,
      theme,
      theme_mode = "select",
      page_count = 16,
      language = "en",
      educational_facts = true,
      cover_mood = null,
      main_character_mode = "auto",
      provider_mode = "auto",
      autopilot_mode = "full_auto",
      seed_lock = null,
      max_retry_per_page = 5,
      daily_cost_ceiling_usd = 25,
      complexity_mode = "auto",
    } = body ?? {};

    if (!age_band || !ALLOWED_BANDS.has(age_band)) {
      return json({ error: "invalid_age_band", allowed: [...ALLOWED_BANDS] }, 400);
    }
    if (!theme || typeof theme !== "string" || theme.trim().length < 3) {
      return json({ error: "invalid_theme" }, 400);
    }
    if (![16, 32].includes(page_count)) {
      return json({ error: "invalid_page_count", allowed: [16, 32] }, 400);
    }

    // Verify caller is admin (defense in depth on top of RLS).
    const auth = req.headers.get("authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "");
    let userId: string | null = null;
    if (jwt) {
      const { data: userRes } = await db.auth.getUser(jwt);
      userId = userRes?.user?.id ?? null;
      if (userId) {
        const { data: adm } = await db
          .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
        if (!adm) return json({ error: "admin_only" }, 403);
      }
    }

    const { data: created, error } = await db
      .from("coloring_v2_books")
      .insert({
        age_band,
        theme: theme.trim(),
        theme_mode,
        page_count,
        language,
        educational_facts,
        cover_mood,
        main_character_mode,
        provider_mode,
        autopilot_mode,
        seed_lock,
        max_retry_per_page,
        daily_cost_ceiling_usd,
        complexity_mode,
        generation_status: "queued",
        qc_status: "pending",
        sellability_status: "unknown",
        publish_status: "draft",
        created_by: userId,
        time_started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;

    const bookId = (created as { id: string }).id;

    const { data: run, error: runErr } = await db
      .from("coloring_v2_runs")
      .insert({ book_id: bookId, status: "running" })
      .select("id").single();
    if (runErr) throw runErr;

    // Fire-and-forget concept stage. If the function isn't deployed yet
    // the tick loop (once built) will pick this book up.
    try {
      await fetch(`${SB_URL}/functions/v1/coloring-v2-concept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SB_KEY}`,
          apikey: SB_KEY,
        },
        body: JSON.stringify({ book_id: bookId, run_id: (run as { id: string }).id }),
      }).catch(() => { /* self-advance is best-effort */ });
    } catch { /* noop */ }

    return json({ ok: true, book_id: bookId, run_id: (run as { id: string }).id });
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
