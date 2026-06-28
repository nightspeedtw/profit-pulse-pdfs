// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { ebook_id, action } = (await req.json()) as {
      ebook_id?: string;
      action?:
        | "retry"
        | "reset"
        | "mark_approved"
        | "reject"
        | "rebuild_pdf";
    };
    if (!ebook_id || !action) {
      return new Response(JSON.stringify({ error: "ebook_id and action required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const db = admin();

    if (action === "reset" || action === "retry") {
      // Clear QC blockers AND re-arm pipeline stages so retry actually
      // re-runs diagnose + targeted repair (not just clears flags).
      const { data: cur } = await db.from("ebooks")
        .select("manuscript_qc_status, pdf_status, autopilot_state")
        .eq("id", ebook_id).single();

      const patch: Record<string, unknown> = {
        qc_status: "qc_pending",
        failed_gate: null,
        failed_component: null,
        failed_score: null,
        required_score: null,
        auto_fix_attempt_count: 0,
        admin_review_reason: null,
        next_recommended_action: null,
        blocked_at: null,
        autopilot_state: "running",
        needs_review_reason: null,
      };
      // If manuscript QC is the blocker, force the pipeline to re-run it.
      if (cur?.manuscript_qc_status === "needs_review") {
        patch.manuscript_qc_status = "pending";
        patch.manuscript_fix_count = 0;
      }
      await db.from("ebooks").update(patch).eq("id", ebook_id);

      // Kick the pipeline so the retry actually does work.
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/autopilot-pipeline`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ ebook_id, mode: "full" }),
      });
      const body = await r.json().catch(() => ({}));
      return new Response(JSON.stringify({ ok: r.ok, resumed: body }), {
        status: r.ok ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else if (action === "rebuild_pdf") {
      // Invoke build-pdf inline.
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/build-pdf`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ ebook_id }),
      });
      const body = await r.json().catch(() => ({}));
      return new Response(JSON.stringify({ ok: r.ok, rebuilt: body }), {
        status: r.ok ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else if (action === "mark_approved") {
      const { data: cur } = await db.from("ebooks").select("auto_fix_history").eq("id", ebook_id).single();
      const history = Array.isArray(cur?.auto_fix_history) ? cur!.auto_fix_history : [];
      history.push({
        attempt: history.length + 1,
        gate: "manual_override",
        action: "admin_marked_approved",
        result: "pass",
        at: new Date().toISOString(),
      });
      await db.from("ebooks").update({
        qc_status: "qc_passed",
        admin_review_reason: null,
        next_recommended_action: null,
        resolved_at: new Date().toISOString(),
        auto_fix_history: history,
      }).eq("id", ebook_id);
    } else if (action === "reject") {
      await db.from("ebooks").update({
        qc_status: "auto_fix_failed",
        admin_review_reason: "Rejected by admin.",
      }).eq("id", ebook_id);
    }

    const { data: row } = await db.from("ebooks").select(
      "qc_status, failed_gate, failed_component, failed_score, required_score, auto_fix_attempt_count, max_auto_fix_attempts, last_auto_fix_action, admin_review_reason, next_recommended_action, auto_fix_history, blocked_at, resolved_at",
    ).eq("id", ebook_id).single();

    return new Response(JSON.stringify({ ok: true, ebook: row }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message ?? String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
