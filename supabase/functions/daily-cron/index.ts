// Daily autopilot cron. When autopilot is enabled:
//   1. Generate fresh ideas (2x quota for QC margin)
//   2. Launch the autopilot orchestrator on the top N approved/idea rows up to daily_quota
//   3. At publish_hour_utc, publish any ebook in `ready_to_publish` state that passes the gate
// Intended to be called once per hour by pg_cron.
import { corsHeaders, admin } from "../_shared/ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const db = admin();
    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).single();
    if (!settings?.autopilot_enabled && !settings?.cron_enabled) {
      return new Response(JSON.stringify({ skipped: "autopilot disabled" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (settings.paused) {
      return new Response(JSON.stringify({ skipped: "autopilot paused" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const quota: number = Math.max(0, Number(settings.daily_quota ?? 0));
    const mode: string = settings.autopilot_mode ?? "safe";
    const publishHour: number = Number(settings.publish_hour_utc ?? 14);

    // Budget guard
    const sinceDay = new Date(); sinceDay.setUTCHours(0, 0, 0, 0);
    const { data: costs } = await db.from("cost_log").select("cost_usd").gte("created_at", sinceDay.toISOString());
    const spent = (costs ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
    const budget = Number(settings.daily_budget_usd ?? 5);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" };

    const result: Record<string, unknown> = { mode, quota, spent, budget };

    // --- A) GENERATE + LAUNCH ---
    if (spent < budget && quota > 0) {
      // How many ebooks did autopilot already start today?
      const { count: startedToday } = await db.from("ebooks")
        .select("id", { count: "exact", head: true })
        .gte("created_at", sinceDay.toISOString())
        .neq("autopilot_state", "idle");
      const remaining = Math.max(0, quota - (startedToday ?? 0));

      if (remaining > 0) {
        // Ensure fresh idea pool
        const { count: ideaPool } = await db.from("ebook_ideas")
          .select("id", { count: "exact", head: true })
          .in("status", ["idea", "approved"]);
        if ((ideaPool ?? 0) < remaining * 2) {
          await fetch(`${url}/functions/v1/generate-idea`, {
            method: "POST", headers: auth, body: JSON.stringify({ count: Math.min(remaining * 2, 20) }),
          }).catch(() => null);
        }

        // Pick top ideas not yet promoted
        const { data: ideas } = await db.from("ebook_ideas")
          .select("id")
          .in("status", ["idea", "approved"])
          .order("total_score", { ascending: false })
          .limit(remaining);

        result.launched = [];
        for (const i of ideas ?? []) {
          try {
            // Use the Milestone-8 pipeline so every step calls the modern
            // generate-outline / write-chapters / final-manuscript-qc /
            // generate-cover / render-pdf / shopify-draft-upload functions.
            const r = await fetch(`${url}/functions/v1/autopilot-pipeline`, {
              method: "POST", headers: auth, body: JSON.stringify({ idea_id: i.id, mode }),
            });
            const j = await r.json().catch(() => ({}));
            (result.launched as any[]).push({ idea_id: i.id, ok: r.ok, response: j });
          } catch (e) {
            (result.launched as any[]).push({ idea_id: i.id, error: String(e) });
          }
        }
      } else {
        result.skipped_launch = "daily quota reached";
      }
    } else if (spent >= budget) {
      result.skipped_launch = `budget exhausted ($${spent.toFixed(3)} ≥ $${budget})`;
    }

    // --- B) SCHEDULED PUBLISH ---
    // Only fire at the chosen UTC hour (idempotent per-hour because we only flip drafts)
    const currentHour = new Date().getUTCHours();
    if (mode === "full" || mode === "safe") {
      if (currentHour === publishHour) {
        const { data: ready } = await db.from("ebooks")
          .select("id,title")
          .eq("autopilot_state", "ready_to_publish")
          .eq("shopify_status", "draft");
        result.published = [];
        for (const e of ready ?? []) {
          try {
            const r = await fetch(`${url}/functions/v1/shopify-publish`, {
              method: "POST", headers: auth, body: JSON.stringify({ ebook_id: e.id }),
            });
            const j = await r.json().catch(() => ({}));
            (result.published as any[]).push({ ebook_id: e.id, title: e.title, ok: r.ok, response: j });
          } catch (err) {
            (result.published as any[]).push({ ebook_id: e.id, error: String(err) });
          }
        }
      } else {
        result.publish_window = `current ${currentHour}:00 UTC, scheduled ${publishHour}:00 UTC`;
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
