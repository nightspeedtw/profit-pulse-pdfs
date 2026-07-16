// Central taxonomy for `ebooks_kids.blocker_reason` / autopilot_kids_runs.blocker_reason.
//
// The recurring-failure detector in kids-batch-producer must trigger the
// production pause ONLY when a **code / infrastructure** class recurs — those
// are classes that were fixed and returned (true regressions).
//
// Content-quality verdicts (story_gate, manuscript_qc, final_qc, visual_qc,
// judge scores below threshold, etc.) are the gates working as intended.
// They must never arm the pause; they route to the learn-then-retry cadence.
//
// If you add a new blocker class, put it in exactly one of the two sets.

export const CODE_BLOCKER_CLASSES: ReadonlySet<string> = new Set([
  // Infrastructure / dispatch
  "dispatch_failed",
  "invoke_failed",
  "edge_function_error",
  "pipeline_crash",
  "unknown_step",

  // Persistence / schema contract bugs
  "persistence_contract",
  "missing_column",
  "schema_mismatch",
  "asset_identity",
  "idempotency",

  // State machine / lease bugs
  "state_machine",
  "stall_retire",
  "stuck_lease",
  "concurrency",

  // PDF / build integrity bugs
  "pdf_build_error",
  "pdf_metadata_mismatch",
  "phantom_gate",
  "parse_error",

  // Bare "unknown" is treated as code (safer to investigate than to ignore).
  "unknown",
]);

export const CONTENT_BLOCKER_CLASSES: ReadonlySet<string> = new Set([
  // Editorial / narrative quality verdicts — normal attrition.
  "story_gate",
  "manuscript_qc",
  "final_qc",
  "post_pdf_story_qc",
  "reader_experience_qc",

  // Visual quality verdicts
  "visual_qc",
  "character_consistency",
  "illustration_style",
  "cover_to_interior_match",

  // Metadata / bible checks that are content decisions, not code faults
  "metadata_gate",
  "bible_check",
  "title_treatment",

  // Missing-inputs states that should self-heal, not arm the pause
  "qc_missing",

  // LLM-generation step-name prefixes. Failures here are almost always
  // content quality (writer gates, judge scores, refrain rules) or
  // transient JSON-parse errors from the model — NOT code regressions.
  // A true code regression in these steps would have an explicit class.
  "generate_manuscript",
  "generate_style_bible",
  "generate_idea",
  "generate_outline",
  "generate_cover",
  "generate_interior",
  "generate_interior_visuals",
  "kids_render_interior",
  "concept_batches_exhausted",

  // Terminal-state step names that mean "budget exhausted after honest
  // content attrition" — the correct response is fresh-concept rotation,
  // not a global production pause.
  "dispatch_pdf_qc_publish",
  "publish_gate",
]);

/** Normalize a raw blocker string to the class prefix used by the taxonomy. */
export function classifyBlocker(raw: string | null | undefined): {
  klass: string;
  kind: "code" | "content" | "uncategorized";
} {
  if (!raw) return { klass: "unknown", kind: "code" };
  const klass = (raw.split(":")[0] || "unknown").trim().slice(0, 80);
  if (CODE_BLOCKER_CLASSES.has(klass)) return { klass, kind: "code" };
  if (CONTENT_BLOCKER_CLASSES.has(klass)) return { klass, kind: "content" };
  // Unknown classes are treated as code — surface them for investigation
  // rather than silently discarding a potential regression.
  return { klass, kind: "uncategorized" };
}

/** Does this blocker class arm the regression pause? */
export function armsRegressionPause(raw: string | null | undefined): boolean {
  const { kind } = classifyBlocker(raw);
  return kind === "code" || kind === "uncategorized";
}
