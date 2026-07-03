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
        .select("title, manuscript_qc_status, pdf_status, autopilot_state, auto_fix_attempt_count, qc_gates_json")
        .eq("id", ebook_id).single();

      const MAX_ATTEMPTS = 3;
      const currentAttempts = cur?.auto_fix_attempt_count ?? 0;
      const g = gate ?? "any";

      // ESCALATION: if we've already tried MAX times, stop looping and
      // hand off to the "Needs Code Fix" queue with a Lovable prompt so
      // the agent can fix the underlying bug instead of retrying forever.
      if (action === "autofix_gate" && currentAttempts >= MAX_ATTEMPTS) {
        const gates = (cur?.qc_gates_json ?? {}) as Record<string, { score?: number; target?: number; pass?: boolean }>;
        const failed = Object.entries(gates)
          .filter(([, v]) => v && typeof v === "object" && v.pass === false)
          .map(([k, v]) => `- ${k}: score ${v.score ?? "n/a"} / target ${v.target ?? "n/a"}`)
          .join("\n") || `- ${g}`;

        const fingerprint = `autofix_stuck:${g}:${ebook_id}`;
        const lovable_prompt = [
          `Autopilot ran auto-fix ${MAX_ATTEMPTS}+ times on ebook "${cur?.title ?? ebook_id}"`,
          `but the following QC gate(s) still fail:`,
          failed,
          ``,
          `Blocked gate: ${g}`,
          ``,
          `Please:`,
          `1. Read supabase/functions/_shared/qc-gates.ts and the gate's producer function.`,
          `2. Diagnose why the score never reaches the target after retries.`,
          `3. Fix the underlying producer (render-pdf, generate-cover, reader-experience-qc, or _shared/pdf-template.ts) so the score converges.`,
          `4. Do NOT just lower the threshold — the premium-ebook-master contract requires the target.`,
        ].join("\n");

        await db.from("system_fix_instructions").upsert({
          fingerprint,
          title: `Auto-Fix stuck on ${g} — ${cur?.title ?? ebook_id}`,
          detected_problem: `Ebook ${ebook_id} blocked at gate "${g}" after ${currentAttempts} auto-fix attempts.`,
          root_cause: `Producer for gate ${g} does not converge to target score.`,
          error_type: "qc_gate_stuck",
          severity: "high",
          affected_ebook_id: ebook_id,
          required_fix: `Fix producer for gate ${g} so it consistently passes.`,
          acceptance_test: `Re-run auto-fix on this ebook; gate ${g} passes on first attempt.`,
          lovable_prompt,
          status: "open",
          occurrences: 1,
          last_seen_at: new Date().toISOString(),
        }, { onConflict: "fingerprint" });

        await db.from("ebooks").update({
          qc_status: "needs_code_fix",
          needs_review_reason: `Auto-fix stuck on ${g} after ${currentAttempts} attempts — escalated to Lovable.`,
          admin_review_reason: `Auto-fix stuck on ${g} after ${currentAttempts} attempts — escalated to Lovable.`,
          next_recommended_action: "code_fix",
        }).eq("id", ebook_id);

        return new Response(JSON.stringify({ ok: true, escalated: true, gate: g, attempts: currentAttempts }), {
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
        autopilot_state: "running",
        needs_review_reason: null,
        last_auto_fix_action: action === "autofix_gate" ? `autofix:${g}` : action,
      };
      if (action !== "autofix_gate") {
        patch.auto_fix_attempt_count = 0;
      } else {
        patch.auto_fix_attempt_count = currentAttempts + 1;
      }

      // Targeted gate resets — re-arm ONLY the failing stage so the
      // pipeline picks up from the right place instead of restarting.
      if (g === "formatter" || g === "cover_pdf" || g === "cover_thumb" || g === "any") {
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
        patch.manuscript_qc_status = "pending";
        patch.manuscript_fix_count = 0;
      }
      patch.next_recommended_action = `autofix:${g}`;
      await db.from("ebooks").update(patch).eq("id", ebook_id);

      // Log to auto_fix_history for visibility.
      const { data: hcur } = await db.from("ebooks").select("auto_fix_history").eq("id", ebook_id).single();
      const history = Array.isArray(hcur?.auto_fix_history) ? hcur!.auto_fix_history : [];
      history.push({
        attempt: history.length + 1,
        gate: g,
        action: action === "autofix_gate" ? `targeted_${g}` : action,
        result: "kicked",
        at: new Date().toISOString(),
      });
      await db.from("ebooks").update({ auto_fix_history: history }).eq("id", ebook_id);

      // Kick the pipeline so the retry actually does work.
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
