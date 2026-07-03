import { computeQcGates, type GateName, type QcGateReport } from "./qc-gates.ts";
import { lovablePrompt } from "./error-classifier.ts";

export type { GateName } from "./qc-gates.ts";

export type AutoFixGate = GateName | "any";

export const MAX_AUTOFIX_ATTEMPTS = 3;

export function firstBlockingGate(report: QcGateReport): GateName | null {
  return report.blocking_gates[0] ?? null;
}

export function stepForGate(gate: GateName): string {
  switch (gate) {
    case "reader": return "reader_experience_qc";
    case "formatter": return "render-pdf";
    case "cover_pdf": return "render-pdf";
    case "cover_thumb": return "generate-cover";
  }
}

export function producerForGate(gate: GateName): string {
  switch (gate) {
    case "reader": return "supabase/functions/reader-experience-qc/index.ts";
    case "formatter": return "supabase/functions/render-pdf/index.ts and supabase/functions/_shared/pdf-template.ts";
    case "cover_pdf": return "supabase/functions/render-pdf/index.ts and supabase/functions/_shared/pdf-template.ts";
    case "cover_thumb": return "supabase/functions/generate-cover/index.ts";
  }
}

export function actionForGate(gate: GateName): string {
  switch (gate) {
    case "reader": return "Run Reader QC targeted humanize repair, then re-score.";
    case "formatter": return "Re-render PDF with formatter/table/worksheet repairs, then rerun PDF QC.";
    case "cover_pdf": return "Rebuild true full-bleed A4 cover page, rerender PDF, then rerun cover PDF QC.";
    case "cover_thumb": return "Regenerate premium 3D book mockup thumbnail, then rerun thumbnail QC.";
  }
}

export function describeGateFailure(report: QcGateReport, gate: GateName): string {
  const result = report[gate];
  const lines = Object.entries(result.breakdown ?? {})
    .map(([k, v]) => `${k}=${v ?? "n/a"}`)
    .join(", ");
  const missing = report.missing_gates.includes(gate) ? "missing data" : "score below target";
  return `${gate}: ${missing}; score ${result.score ?? "n/a"}/${result.target}; ${lines || "no breakdown"}`;
}

export function failedGateLines(report: QcGateReport): string {
  return report.blocking_gates
    .map((gate) => `- ${describeGateFailure(report, gate)}`)
    .join("\n") || "- no blocking gate reported";
}

export function buildGateStuckPrompt(input: {
  title: string | null | undefined;
  ebookId: string;
  gate: GateName;
  report: QcGateReport;
  attempts: number;
}): string {
  const producer = producerForGate(input.gate);
  return lovablePrompt({
    title: `Autopilot QC gate stuck: ${input.gate}`,
    detected:
      `Autopilot auto-fix ran ${input.attempts}+ times on ebook "${input.title ?? input.ebookId}" but the premium gate still fails.\n\n` +
      `Blocked gate: ${input.gate}\n` +
      `All failing gates:\n${failedGateLines(input.report)}`,
    root_cause:
      `The producer for gate ${input.gate} is not converging to the premium-ebook-master target after automatic repairs. ` +
      `Fix the producer output, not the QC threshold.`,
    files: [
      "supabase/functions/_shared/qc-gates.ts",
      producer,
      "supabase/functions/autopilot-pipeline/index.ts",
      "supabase/functions/autopilot-recovery-worker/index.ts",
    ],
    fix: [
      `Read qc-gates.ts and confirm exactly which score fields gate ${input.gate} consumes.`,
      `Inspect and fix the producer: ${producer}.`,
      `Make the repair loop produce data that reaches the required target: ${input.report[input.gate].target}.`,
      `Persist the repaired QC fields back to ebooks so computeQcGates() reads the new passing score.`,
      `Do not lower thresholds or bypass the gate; premium-ebook-master requires the target.`,
    ],
    test:
      `Run targeted autofix for ebook ${input.ebookId}; gate ${input.gate} must pass and the ebook must proceed to Shopify draft readiness.`,
  });
}

// deno-lint-ignore no-explicit-any
export async function persistQcSnapshot(db: any, ebook: Record<string, unknown>): Promise<QcGateReport> {
  const report = computeQcGates(ebook);
  await db.from("ebooks").update({
    qc_gates_json: report,
    qc_ready_for_shopify: report.ready_for_shopify,
  }).eq("id", ebook.id);
  // Once a producer fix makes a gate pass, retire the old Needs Code Fix row so
  // the dashboard stops showing stale bugs for that ebook. If the gate regresses
  // later, markGateNeedsCodeFix() will reopen/upsert the instruction.
  const ebookId = String(ebook.id ?? "");
  if (ebookId) {
    const resolvedAt = new Date().toISOString();
    await Promise.all((["formatter", "reader", "cover_pdf", "cover_thumb"] as GateName[])
      .filter((gate) => report[gate].pass)
      .map((gate) => db.from("system_fix_instructions")
        .update({ status: "resolved", resolved_at: resolvedAt, last_seen_at: resolvedAt })
        .eq("fingerprint", `autofix_stuck:${gate}:${ebookId}`)));
  }
  return report;
}

// deno-lint-ignore no-explicit-any
export async function markGateAutoFixing(db: any, ebook: Record<string, unknown>, gate: GateName, report: QcGateReport, attempt: number) {
  const now = new Date().toISOString();
  const detail = describeGateFailure(report, gate);
  await db.from("ebooks").update({
    autopilot_state: "auto_fixing",
    canonical_status: "auto_fixing",
    qc_status: "auto_fixing",
    blocker_class: "qc_repairable",
    blocker_reason: `autofix_${gate}`,
    waiting_reason: `Auto-fixing ${gate}: ${detail}`,
    needs_review_reason: null,
    current_step: stepForGate(gate),
    current_step_label: `Auto-fix ${gate}`,
    current_action_message: `Auto-fixing failed QC gate: ${gate}`,
    current_subtask: `${actionForGate(gate)} Attempt ${attempt}/${MAX_AUTOFIX_ATTEMPTS}`,
    current_qc_score: report[gate].score,
    failed_gate: gate,
    failed_score: report[gate].score,
    required_score: report[gate].target,
    auto_fix_attempt_count: attempt,
    max_auto_fix_attempts: MAX_AUTOFIX_ATTEMPTS,
    autofix_attempt: attempt,
    autofix_max: MAX_AUTOFIX_ATTEMPTS,
    last_auto_fix_action: `autofix:${gate}`,
    next_recommended_action: `autofix:${gate}`,
    structured_error: {
      error_type: "qc_repairable",
      affected_step: stepForGate(gate),
      gate,
      detail,
      auto_recovery_action: actionForGate(gate),
      attempt,
      max_attempts: MAX_AUTOFIX_ATTEMPTS,
    },
    qc_gates_json: report,
    qc_ready_for_shopify: report.ready_for_shopify,
    last_heartbeat_at: now,
    updated_at: now,
  }).eq("id", ebook.id);
}

// deno-lint-ignore no-explicit-any
export async function markGateNeedsCodeFix(db: any, ebook: Record<string, unknown>, gate: GateName, report: QcGateReport, attempts: number) {
  const ebookId = String(ebook.id);
  const prompt = buildGateStuckPrompt({ title: ebook.title as string | null, ebookId, gate, report, attempts });
  const fingerprint = `autofix_stuck:${gate}:${ebookId}`;
  await db.from("system_fix_instructions").upsert({
    fingerprint,
    title: `Auto-Fix stuck on ${gate} — ${ebook.title ?? ebookId}`,
    detected_problem: `Ebook ${ebookId} blocked at gate "${gate}" after ${attempts} auto-fix attempts.`,
    root_cause: `Producer for gate ${gate} does not converge to target score.`,
    error_type: "qc_gate_stuck",
    severity: "high",
    affected_files: [
      "supabase/functions/_shared/qc-gates.ts",
      producerForGate(gate),
      "supabase/functions/autopilot-pipeline/index.ts",
    ],
    affected_ebook_id: ebookId,
    required_fix: `Fix producer for gate ${gate} so it consistently reaches the premium target.`,
    acceptance_test: `Re-run auto-fix on ebook ${ebookId}; gate ${gate} passes and pipeline proceeds to Shopify draft readiness.`,
    lovable_prompt: prompt,
    status: "open",
    occurrences: 1,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "fingerprint" });

  await db.from("ebooks").update({
    autopilot_state: "needs_code_fix",
    canonical_status: "needs_code_fix",
    qc_status: "auto_fix_failed",
    blocker_class: "qc_gate_stuck",
    blocker_reason: `autofix_stuck_${gate}`,
    waiting_reason: `Auto-fix ${gate} failed after ${attempts} attempts — Lovable code-fix prompt generated.`,
    needs_review_reason: `Auto-fix stuck on ${gate} after ${attempts} attempts — escalated to Lovable code fix.`,
    current_step: stepForGate(gate),
    current_step_label: `Needs Code Fix: ${gate}`,
    current_action_message: `Needs Code Fix — ${gate} producer is not converging`,
    current_subtask: "Copy the generated Lovable prompt from Needs Code Fix.",
    structured_error: {
      error_type: "qc_gate_stuck",
      gate,
      attempts,
      max_attempts: MAX_AUTOFIX_ATTEMPTS,
      detail: describeGateFailure(report, gate),
      lovable_prompt: prompt,
    },
    next_recommended_action: "code_fix",
    qc_gates_json: report,
    qc_ready_for_shopify: false,
    last_heartbeat_at: new Date().toISOString(),
  }).eq("id", ebookId);
}