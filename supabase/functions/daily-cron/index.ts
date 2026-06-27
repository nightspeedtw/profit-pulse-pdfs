// Daily cron — invoked manually or by scheduled job. Generates ideas + promotes top ones + runs QC.
import { corsHeaders, admin } from "../_shared/ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const db = admin();
    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).single();
    if (!settings?.cron_enabled) {
      return new Response(JSON.stringify({ skipped: "cron disabled" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const quota: number = Math.max(0, Number(settings.daily_quota ?? 0));
    if (quota === 0) return new Response(JSON.stringify({ skipped: "quota 0" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Budget check
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const { data: costs } = await db.from("cost_log").select("cost_usd").gte("created_at", since.toISOString());
    const spent = (costs ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
    if (spent >= Number(settings.daily_budget_usd ?? 5)) {
      return new Response(JSON.stringify({ skipped: "daily budget exhausted", spent }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Queue a job batch — top-level cron uses service role to invoke other functions via fetch
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Generate ideas: ~2x quota so QC has a margin
    const r1 = await fetch(`${url}/functions/v1/generate-idea`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", apikey: serviceKey },
      body: JSON.stringify({ count: Math.min(quota * 2, 20) }),
    });
    const ideaRes = await r1.json().catch(() => ({}));

    // Promote top N ideas (by score) — only score >= 48/60 (~80/100), the Auto-Approve threshold.
    const { data: topIdeas } = await db.from("ebook_ideas")
      .select("id").eq("status", "idea").gte("total_score", 48).order("total_score", { ascending: false }).limit(quota);

    const promoted: string[] = [];
    for (const i of (topIdeas ?? [])) {
      try {
        const rp = await fetch(`${url}/functions/v1/promote-idea`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", apikey: serviceKey },
          body: JSON.stringify({ idea_id: i.id }),
        });
        const pr = await rp.json();
        if (pr?.ebook_id) {
          promoted.push(pr.ebook_id);
          // QC each
          await fetch(`${url}/functions/v1/qc-check`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", apikey: serviceKey },
            body: JSON.stringify({ ebook_id: pr.ebook_id }),
          });
        }
      } catch (_) { /* continue */ }
    }

    return new Response(JSON.stringify({ ideas: ideaRes, promoted_count: promoted.length, ebook_ids: promoted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
