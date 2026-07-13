import {
  computeQcGates,
  COVER_THUMB_FIELD_TARGETS,
  READER_FIELD_TARGETS,
  type GateName,
  type QcGateReport,
} from "./qc-gates.ts";
import { lovablePrompt } from "./error-classifier.ts";

export type { GateName } from "./qc-gates.ts";

export type AutoFixGate = GateName | "any";

export const MAX_AUTOFIX_ATTEMPTS = 3;

export interface RepairFingerprint {
  gate: GateName;
  failing_fields: string[];
  previous_scores: Record<string, number | null>;
  repair_action: string;
  output_hash: string;
  timestamp: string;
  missing_data: boolean;
}

export interface RepairLoopDecision {
  fingerprint: RepairFingerprint;
  missingData: boolean;
  countAttempt: boolean;
  alreadyInFlight: boolean;
  escalate: boolean;
  reason: "missing_data_repair" | "producer_persist_bug" | "repeated_no_improvement" | "recent_repair_in_flight" | "score_repair";
}

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

function stableHash(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, val]) => [k, normalize(val)]));
    }
    return v;
  };
  const s = JSON.stringify(normalize(value));
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 10);
}

function targetsForGate(gate: GateName): Record<string, number> {
  if (gate === "reader") return READER_FIELD_TARGETS;
  if (gate === "cover_thumb") return COVER_THUMB_FIELD_TARGETS;
  if (gate === "cover_pdf") return { full_a4: 100 };
  return {
    typography: 90,
    reading_comfort: 90,
    table_render: 90,
    worksheet_layout: 90,
    premium_layout: 90,
    raw_markdown: 100,
  };
}

function scorePayload(report: QcGateReport, gate: GateName): Record<string, number | null> {
  const breakdown = report[gate].breakdown ?? {};
  return {
    overall: report[gate].score,
    ...breakdown,
  };
}

export function buildRepairFingerprint(report: QcGateReport, gate: GateName, repairAction: string): RepairFingerprint {
  const scores = scorePayload(report, gate);
  const targets = targetsForGate(gate);
  const failing = Object.entries(targets)
    .filter(([field, target]) => {
      const v = scores[field] ?? null;
      return v == null || v < target;
    })
    .map(([field]) => field);
  if (report[gate].score == null || report[gate].score! < report[gate].target) failing.unshift("overall_score");
  const missingData = report.missing_gates.includes(gate);
  const payload = { gate, scores, failing: [...new Set(failing)].sort(), missingData };
  return {
    gate,
    failing_fields: [...new Set(failing)],
    previous_scores: scores,
    repair_action: repairAction,
    output_hash: stableHash(payload),
    timestamp: new Date().toISOString(),
    missing_data: missingData,
  };
}

function asHistory(ebook: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(ebook.auto_fix_history) ? ebook.auto_fix_history as Array<Record<string, unknown>> : [];
}

// Phase 1 rule: allow up to 2 attempts where the repair produces no measurable
// change (same output hash OR failing-field scores did not improve). On the 2nd
// no-progress attempt, escalate to needs_code_fix instead of looping forever.
const NO_PROGRESS_ATTEMPTS_ALLOWED = 2;

function scoreImproved(prev: Record<string, unknown> | undefined, next: RepairFingerprint): boolean {
  if (!prev) return true;
  const prevScores = (prev.previous_scores ?? {}) as Record<string, number | null>;
  const failing = next.failing_fields;
  for (const field of failing) {
    const before = prevScores[field];
    const after = next.previous_scores[field];
    if (typeof after === "number" && (typeof before !== "number" || after > before)) return true;
  }
  const beforeOverall = prevScores.overall;
  const afterOverall = next.previous_scores.overall;
  if (typeof afterOverall === "number" && (typeof beforeOverall !== "number" || afterOverall > beforeOverall)) return true;
  return false;
}

export function decideRepairLoop(
  ebook: Record<string, unknown>,
  gate: GateName,
  report: QcGateReport,
  repairAction: string,
): RepairLoopDecision {
  const fingerprint = buildRepairFingerprint(report, gate, repairAction);
  // After a Lovable/code fix has changed the producer, stale fingerprints from
  // the previous broken code must not immediately re-escalate the ebook. Allow
  // one fresh producer repair from needs_code_fix, then normal loop protection
  // applies again because the ebook moves back to auto_fixing with a new history
  // row for this code version.
  const codeFixRetry = ebook.autopilot_state === "needs_code_fix" || ebook.canonical_status === "needs_code_fix";
  const history = codeFixRetry
    ? []
    : asHistory(ebook).filter((h) => h.gate === gate || h.gate_name === gate);
  const last = history[history.length - 1];
  const lastAt = last?.at || last?.timestamp;
  const recentMs = lastAt ? Date.now() - new Date(String(lastAt)).getTime() : Number.POSITIVE_INFINITY;
  const sameHashHistory = history.filter((h) => h.output_hash === fingerprint.output_hash || h.repair_fingerprint === fingerprint.output_hash);
  const alreadyInFlight =
    (ebook.autopilot_state === "auto_fixing" || ebook.canonical_status === "auto_fixing") &&
    sameHashHistory.length > 0 &&
    recentMs >= 0 &&
    recentMs < 90_000;

  if (alreadyInFlight) {
    return { fingerprint, missingData: fingerprint.missing_data, countAttempt: false, alreadyInFlight: true, escalate: false, reason: "recent_repair_in_flight" };
  }
  if (fingerprint.missing_data) {
    // Missing data gets one producer repair that does not spend the 3 score-fix
    // attempts. If the same gate is still n/a on the next pass, the producer is
    // not persisting fields where computeQcGates() reads them.
    const priorMissing = history.some((h) => h.missing_data === true || h.reason === "missing_data_repair");
    return {
      fingerprint,
      missingData: true,
      countAttempt: false,
      alreadyInFlight: false,
      escalate: priorMissing,
      reason: priorMissing ? "producer_persist_bug" : "missing_data_repair",
    };
  }
  // Count "no-progress" attempts: identical output hash OR scores did not improve
  // vs the immediately preceding attempt on the same gate + repair action.
  const sameActionHistory = history.filter((h) => h.action === repairAction || h.repair_action === repairAction);
  const noProgressCount = sameActionHistory.filter((h, idx) => {
    const prev = idx > 0 ? sameActionHistory[idx - 1] : undefined;
    const identicalHash = h.output_hash === fingerprint.output_hash || h.repair_fingerprint === fingerprint.output_hash;
    return identicalHash || !scoreImproved(prev as Record<string, unknown> | undefined, {
      ...fingerprint,
      previous_scores: (h.previous_scores ?? {}) as Record<string, number | null>,
    });
  }).length;
  if (noProgressCount >= NO_PROGRESS_ATTEMPTS_ALLOWED || sameHashHistory.length >= NO_PROGRESS_ATTEMPTS_ALLOWED) {
    return { fingerprint, missingData: false, countAttempt: false, alreadyInFlight: false, escalate: true, reason: "repeated_no_improvement" };
  }
  return { fingerprint, missingData: false, countAttempt: true, alreadyInFlight: false, escalate: false, reason: "score_repair" };
}

export async function appendRepairHistory(
  // deno-lint-ignore no-explicit-any
  db: any,
  ebook: Record<string, unknown>,
  decision: RepairLoopDecision,
  attempt: number,
  result: "started" | "pass" | "fail" | "escalated" = "started",
) {
  const history = asHistory(ebook);
  history.push({
    attempt,
    gate: decision.fingerprint.gate,
    action: decision.fingerprint.repair_action,
    result,
    reason: decision.reason,
    failing_fields: decision.fingerprint.failing_fields,
    previous_scores: decision.fingerprint.previous_scores,
    output_hash: decision.fingerprint.output_hash,
    repair_fingerprint: decision.fingerprint.output_hash,
    missing_data: decision.missingData,
    counted_attempt: decision.countAttempt,
    at: decision.fingerprint.timestamp,
  });
  await db.from("ebooks").update({ auto_fix_history: history }).eq("id", ebook.id);
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
  reason?: string;
}): string {
  const producer = producerForGate(input.gate);
  return lovablePrompt({
    title: `Autopilot QC gate stuck: ${input.gate}`,
    detected:
      `Autopilot auto-fix ran ${input.attempts}+ times on ebook "${input.title ?? input.ebookId}" but the premium gate still fails.\n\n` +
      `Blocked gate: ${input.gate}\n` +
      `All failing gates:\n${failedGateLines(input.report)}`,
    root_cause:
      `${input.reason ? `Repair loop stopped because: ${input.reason}. ` : ""}` +
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
      `Run targeted autofix for ebook ${input.ebookId}; gate ${input.gate} must pass and the ebook must proceed to Storefront draft readiness.`,
  });
}

// deno-lint-ignore no-explicit-any
export async function persistQcSnapshot(db: any, ebook: Record<string, unknown>): Promise<QcGateReport> {
  // Always compute from the FRESH row to avoid stale-writer clobber: callers
  // may hand us an outdated `ebook` object that missed a recent cover_qc /
  // pdf_qc write, which would produce a false-negative gate result.
  const ebookId = String(ebook.id ?? "");
  let source: Record<string, unknown> = ebook;
  if (ebookId) {
    const { data: fresh } = await db.from("ebooks").select("*").eq("id", ebookId).maybeSingle();
    if (fresh) source = fresh as Record<string, unknown>;
  }
  const report = computeQcGates(source);
  await db.from("ebooks").update({
    qc_gates_json: report,
    qc_ready_for_shopify: report.ready_for_storefront,
  }).eq("id", ebookId || (ebook.id as string));
  // Once a producer fix makes a gate pass, retire the old Needs Code Fix row so
  // the dashboard stops showing stale bugs for that ebook. If the gate regresses
  // later, markGateNeedsCodeFix() will reopen/upsert the instruction.
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
  // Stale-write protection: before marking a gate as auto-fixing (which sets
  // qc_ready_for_shopify=false and downstream blocker flags), re-read the row
  // and recompute. If the fresh gates all pass, the caller was working from
  // a stale snapshot — do not clobber the passing state.
  const ebookId = String(ebook.id ?? "");
  if (ebookId) {
    const { data: fresh } = await db.from("ebooks").select("*").eq("id", ebookId).maybeSingle();
    if (fresh) {
      const freshReport = computeQcGates(fresh as Record<string, unknown>);
      if (freshReport.ready_for_storefront) {
        await db.from("ebooks").update({
          qc_gates_json: freshReport,
          qc_ready_for_shopify: true,
        }).eq("id", ebookId);
        return;
      }
      report = freshReport;
    }
  }
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
    qc_ready_for_shopify: report.ready_for_storefront,
    last_heartbeat_at: now,
    updated_at: now,
  }).eq("id", ebook.id);
}

export async function markGateNeedsCodeFix(db: any, ebook: Record<string, unknown>, gate: GateName, report: QcGateReport, attempts: number, reason = "max_attempts_exhausted") {
  const ebookId = String(ebook.id);
  // Stale-write protection: if the fresh row now passes all gates, do not
  // escalate to needs_code_fix on a stale snapshot.
  const { data: fresh } = await db.from("ebooks").select("*").eq("id", ebookId).maybeSingle();
  if (fresh) {
    const freshReport = computeQcGates(fresh as Record<string, unknown>);
    if (freshReport.ready_for_storefront) {
      await db.from("ebooks").update({
        qc_gates_json: freshReport,
        qc_ready_for_shopify: true,
      }).eq("id", ebookId);
      return;
    }
    report = freshReport;
  }
  const prompt = buildGateStuckPrompt({ title: ebook.title as string | null, ebookId, gate, report, attempts, reason });
  const fingerprint = `autofix_stuck:${gate}:${ebookId}`;
  await db.from("system_fix_instructions").upsert({
    fingerprint,
    title: `Auto-Fix stuck on ${gate} — ${ebook.title ?? ebookId}`,
    detected_problem: `Ebook ${ebookId} blocked at gate "${gate}" after ${attempts} auto-fix attempts.`,
    root_cause: reason === "producer_persist_bug"
      ? `Producer for gate ${gate} did not persist required QC fields where computeQcGates() reads them.`
      : reason === "repeated_no_improvement"
        ? `Producer for gate ${gate} repeated the same failing score fingerprint with no improvement.`
        : `Producer for gate ${gate} does not converge to target score.`,
    error_type: reason === "producer_persist_bug" ? "producer_persist_bug" : "qc_gate_stuck",
    severity: "high",
    affected_files: [
      "supabase/functions/_shared/qc-gates.ts",
      producerForGate(gate),
      "supabase/functions/autopilot-pipeline/index.ts",
    ],
    affected_ebook_id: ebookId,
    required_fix: `Fix producer for gate ${gate} so it writes the exact gate contract fields and reaches the premium target without lowering thresholds.`,
    acceptance_test: `Re-run auto-fix on ebook ${ebookId}; gate ${gate} passes and pipeline proceeds to Storefront draft readiness.`,
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
      error_type: reason === "producer_persist_bug" ? "producer_persist_bug" : "qc_gate_stuck",
      gate,
      attempts,
      max_attempts: MAX_AUTOFIX_ATTEMPTS,
      stop_reason: reason,
      detail: describeGateFailure(report, gate),
      lovable_prompt: prompt,
    },
    next_recommended_action: "code_fix",
    qc_gates_json: report,
    qc_ready_for_shopify: false,
    last_heartbeat_at: new Date().toISOString(),
  }).eq("id", ebookId);
}