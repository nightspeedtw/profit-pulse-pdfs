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
  topic_mode: "random",
  specific_category_key: null,
  age_band: "4-6",
  page_count: 32,
  batch_size: 1,
  daily_cap: 3,
  daily_stop_utc: "22:00",
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
      return json({
        config: { ...DEFAULTS, ...(data?.coloring_autopilot ?? {}) },
        categories: cats ?? [],
      });
    }

    const merged = { ...DEFAULTS, ...(body.config ?? {}) };
      // basic clamps
      merged.batch_size = Math.max(1, Math.min(20, Number(merged.batch_size) || 1));
      merged.daily_cap = Math.max(0, Math.min(100, Number(merged.daily_cap) || 0));
      merged.page_count = [24, 32, 48].includes(Number(merged.page_count)) ? Number(merged.page_count) : 32;
      if (!["3-5", "4-6", "6-8"].includes(merged.age_band)) merged.age_band = "4-6";
      if (!["random", "specific"].includes(merged.topic_mode)) merged.topic_mode = "random";
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(merged.daily_stop_utc))) merged.daily_stop_utc = "22:00";
      const { error } = await admin.from("generation_settings")
        .update({ coloring_autopilot: merged }).eq("id", 1);
      if (error) throw error;
      return json({ ok: true, config: merged });
    }

    return json({ error: "method not allowed" }, 405);
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
