// Canonical current repair-regime version for the coloring lane.
//
// Bumping this constant IS the "learn-then-retry" signal:
//   1. Whenever the calibration engineer commits a new corrective
//      regime (e.g. num_inference_steps bump, new prompt clauses,
//      new sharpness floor), bump the version below.
//   2. The coloring worker-tick watchdog then auto-requeues any
//      coloring row currently in pipeline_status='failed' whose
//      metadata.coloring_last_requeued_regime_version is behind
//      this constant. Attempts on dead pages are reset to 0, the
//      row is flipped back to 'queued', and the render function
//      picks it up next tick — EXACTLY ONCE per version bump.
//   3. Failed rows never rest silently: either they publish under
//      the new regime, or they fail again and get dead-flagged
//      with fresh evidence (surface-level, not idle).
//
// v1: original schnell steps=4 + basic clauses
// v2: schnell steps=8 for repair renders + crisp-line clauses (2026-07-16)
// v3: sharpness floor lowered to 13.0 (accepted-set consistency)
// v4: sharpness metric replaced with sparsity-invariant boundary-edge
//     strength (SHARPNESS_GATE_VERSION v5). Root-cause fix: prior whole-
//     image mean-neighbor-diff false-failed replanned sparse portraits
//     (Ocean Friends p3) because the simplify ladder deliberately makes
//     pages sparser. Watchdog auto-requeues rows behind this version so
//     dead pages under the old metric get re-measured under the new one.
export const CURRENT_COLORING_REPAIR_REGIME = "v4:boundary-edge-strength-min140";
