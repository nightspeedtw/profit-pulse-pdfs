// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { computeQcGates } from "../_shared/qc-gates.ts";
import {
  appendRepairHistory,
  decideRepairLoop,
  firstBlockingGate,
  markGateAutoFixing,
  markGateNeedsCodeFix,
  MAX_AUTOFIX_ATTEMPTS,
  type AutoFixGate,
  type GateName,
} from "../_shared/autopilot-self-heal.ts";

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
    const { ebook_id, action, gate } = (await req.json()) as {
      ebook_id?: string;
      action?:
        | "retry"
        | "reset"
        | "mark_approved"
        | "reject"
        | "rebuild_pdf"
        | "autofix_gate";
      // Targeted gate for autofix_gate: which premium-ebook-master QC
      // is currently blocking Shopify readiness.
      gate?: "reader" | "cover_pdf" | "cover_thumb" | "formatter" | "any";
    };
    if (!ebook_id || !action) {
      return new Response(JSON.stringify({ error: "ebook_id and action required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const db = admin();

    if (action === "reset" || action === "retry" || action === "autofix_gate") {
      // Clear QC blockers AND re-arm pipeline stages so retry actually
      // re-runs diagnose + targeted repair (not just clears flags).
      const { data: cur } = await db.from("ebooks")
        .select("*")
        .eq("id", ebook_id).single();

      const MAX_ATTEMPTS = MAX_AUTOFIX_ATTEMPTS;
      // If a bug has already been escalated to Needs Code Fix and the code was
      // subsequently changed, a targeted autofix must be allowed to run once
      // again. Otherwise old rows with auto_fix_attempt_count >= 3 immediately
      // re-escalate and can never prove the producer fix works.
      const rawAttempts = Number(cur?.auto_fix_attempt_count ?? 0);
      const codeFixRetry = action === "autofix_gate" &&
        (cur?.autopilot_state === "needs_code_fix" || cur?.canonical_status === "needs_code_fix");
      const currentAttempts = codeFixRetry ? 0 : rawAttempts;
      const report = computeQcGates(cur ?? {});
      const chosen = gate === "any" || !gate ? firstBlockingGate(report) : gate;
      if (action === "autofix_gate" && !chosen) {
        await db.from("ebooks").update({
          qc_gates_json: report,
          qc_ready_for_shopify: report.ready_for_shopify,
          qc_status: report.ready_for_shopify ? "qc_passed" : "pending",
          autopilot_state: report.ready_for_shopify ? "ready_to_publish" : cur?.autopilot_state,
          canonical_status: report.ready_for_shopify ? "ready_to_publish" : cur?.canonical_status,
        }).eq("id", ebook_id);
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no_blocking_gate", report }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const g = (chosen ?? "formatter") as AutoFixGate;
      const gateName = g as GateName;
      const decision = action === "autofix_gate"
        ? decideRepairLoop(cur ?? {}, gateName, report, `targeted_${g}`)
        : null;

      // ESCALATION: if we've already tried MAX times, stop looping and
      // hand off to the "Needs Code Fix" queue with a Lovable prompt so
      // the agent can fix the underlying bug instead of retrying forever.
      if (action === "autofix_gate" && decision?.alreadyInFlight) {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: decision.reason, gate: g }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (action === "autofix_gate" && (decision?.escalate || currentAttempts >= MAX_ATTEMPTS)) {
        await appendRepairHistory(db, cur, decision!, currentAttempts, "escalated");
        await markGateNeedsCodeFix(
          db,
          cur,
          gateName,
          report,
          currentAttempts,
          decision?.reason ?? "max_attempts_exhausted",
        );

        return new Response(JSON.stringify({ ok: true, escalated: true, gate: g, attempts: currentAttempts, reason: decision?.reason ?? "max_attempts_exhausted" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const patch: Record<string, unknown> = {
        qc_status: "auto_fixing",
        failed_gate: null,
        failed_component: null,
        failed_score: null,
        required_score: null,
        admin_review_reason: null,
        next_recommended_action: null,
        blocked_at: null,
        autopilot_state: "auto_fixing",
        canonical_status: "auto_fixing",
        needs_review_reason: null,
        last_auto_fix_action: codeFixRetry ? `code_fix_retry_${g}` : action === "autofix_gate" ? `autofix:${g}` : action,
      };
      if (action !== "autofix_gate") {
        patch.auto_fix_attempt_count = 0;
      } else if (decision?.countAttempt === false) {
        patch.auto_fix_attempt_count = currentAttempts;
      } else {
        patch.auto_fix_attempt_count = currentAttempts + 1;
      }

      // Targeted gate resets — re-arm ONLY the failing stage so the
      // pipeline picks up from the right place instead of restarting.
      if (g === "formatter" || g === "cover_pdf" || g === "any") {
        // Force PDF/cover to be re-rendered; render-pdf regenerates the
        // cover A4 page and thumbnail mockup as part of its output.
        patch.pdf_status = "idle";
      }
      if (action !== "autofix_gate" && cur?.manuscript_qc_status === "needs_review") {
        patch.manuscript_qc_status = "pending";
        patch.manuscript_fix_count = 0;
      }
      if (g === "reader") {
        // Route through manuscript QC path so reader-experience-qc reruns.
        patch.reader_experience_status = "pending";
        patch.reader_experience_fix_count = 0;
        patch.manuscript_qc_status = "pending";
        patch.manuscript_fix_count = 0;
      }
      if (g === "cover_thumb") {
        // Regenerate only the missing/weak thumbnail mockup when possible. Keep
        // approved cover assets intact; generate-cover can build the 3D mockup
        // from the existing cover and then persist cover_qc thumbnail fields.
        patch.pdf_status = "idle";
      }
      patch.next_recommended_action = `autofix:${g}`;
      await db.from("ebooks").update(patch).eq("id", ebook_id);
      if (action === "autofix_gate") {
        await markGateAutoFixing(db, cur, gateName, report, decision?.countAttempt === false ? currentAttempts : currentAttempts + 1);
      }

      if (action === "autofix_gate" && decision) {
        await appendRepairHistory(
          db,
          cur,
          decision,
          decision.countAttempt === false ? currentAttempts : currentAttempts + 1,
          "started",
        );
      } else {
        // Log to auto_fix_history for visibility.
        const { data: hcur } = await db.from("ebooks").select("auto_fix_history").eq("id", ebook_id).single();
        const history = Array.isArray(hcur?.auto_fix_history) ? hcur!.auto_fix_history : [];
        history.push({
          attempt: history.length + 1,
          gate: g,
          action: codeFixRetry ? `code_fix_retry_${g}` : action === "autofix_gate" ? `targeted_${g}` : action,
          result: "kicked",
          at: new Date().toISOString(),
        });
        await db.from("ebooks").update({ auto_fix_history: history }).eq("id", ebook_id);
      }

      // Kick the exact producer immediately, then kick the pipeline so the
      // canonical state machine continues to Shopify readiness.
      if (action === "autofix_gate" && g === "cover_thumb") {
        const coverMode = decision?.missingData ? "overlay" : "spec";
        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-cover`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          },
          body: JSON.stringify({ ebook_id, mode: coverMode }),
        }).catch((e) => console.warn("generate-cover autofix kickoff failed", e?.message ?? e));
      }

      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/autopilot-pipeline`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ ebook_id, mode: "full", resume_gate: g }),
      });
      const body = await r.json().catch(() => ({}));
      return new Response(JSON.stringify({ ok: r.ok, resumed: body, gate: g }), {
        status: r.ok ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else if (action === "rebuild_pdf") {
      // Phase 1: route to render-pdf. Legacy build-pdf only fires when LEGACY_PIPELINE is on.
      const { FEATURES } = await import("../_shared/features.ts");
      const fn = FEATURES.LEGACY_PIPELINE ? "build-pdf" : "render-pdf";
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ ebook_id, force: true }),
      });
      const body = await r.json().catch(() => ({}));
      return new Response(JSON.stringify({ ok: r.ok, rebuilt: body, via: fn }), {
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
