// Single source of truth for story-gate score thresholds.
//
// CALIBRATION v5 (2026-07-18, ONE-ROUND FINAL):
// Owner directive — "ลดได้แต่ต้องขายได้": the calibrated floor IS the
// sellable bar by definition since it is derived from books he approved
// and sells. Benchmarked against the owner-approved sellable picture-book
// corpus (Detective Pip / Petal Paths, Sneeze-Powered Sock Sorter, Chef
// Pip / Pop-Up Pancakes, Chef Pip / Pudding Plop, Barnaby Bear's Bouncy
// Bell) using the v3-2026-07-14 judge.
//
// Corpus minimums (owner-approved): age=90, coh=80, emo=80, rer=75,
// lang=80, buyer=85. Applying a -2 sensible margin (still bounded by
// what the approved corpus actually scores) so a fresh book that matches
// our best-sellers PASSES the gate without oscillation on judge quantization.
//
// generic_story_risk_max: LOCKED at 25 per owner directive — never
// relaxed. Self-plagiarism is caught upstream by concept-preflight and
// again here at the story gate.
//
// Do NOT edit these floors without re-running kids-story-judge-replay
// against the current live corpus AND recording the new benchmark table
// in pipeline_skills (calibration_method='published_corpus_minimum_minus_2').
export const STORY_GATE = {
  age_appropriateness: 88,   // corpus min 90, -2 margin
  story_coherence: 78,       // corpus min 80, -2 margin
  emotional_payoff: 78,      // corpus min 80, -2 margin
  reread_value: 73,          // corpus min 75, -2 margin
  language_level: 78,        // corpus min 80, -2 margin
  parent_buyer_value: 83,    // corpus min 85, -2 margin
  generic_story_risk_max: 25, // LOCKED — owner directive, never relaxed
} as const;

export const STORY_GATE_VERSION = "v5-2026-07-18-corpus-min-minus-2";
