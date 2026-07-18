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
// generic_story_risk_max: RECALIBRATED 2026-07-19 (v5.2) to 60 via the
// corpus method — owner's 5 published/selling books scored generic_risk
// 16/38/42/53/65 under the v3-2026-07-14 judge; corpus max 65 minus a
// 5-point tightening margin. The previous <=25 lock would reject 4 of 5
// sellable books and produced 0% first-pass yield on 6 fresh diverse
// drafts (scores 29-57). Clone defense is now handled deterministically
// upstream (name-ban regex, possessive-template ban, SIGNATURE_QUIRK_WORDS,
// lane bans, anti-anchoring list of last 25 concepts) — the numeric gate
// no longer needs to double as a clone catcher.
//
// Do NOT edit these floors without re-running kids-story-judge-replay
// against the current live corpus AND recording the new benchmark table
// in pipeline_skills.
// Method: published_corpus_generic_risk_max_minus_5.
export const STORY_GATE = {
  age_appropriateness: 88,   // corpus min 90, -2 margin
  story_coherence: 78,       // corpus min 80, -2 margin
  emotional_payoff: 78,      // corpus min 80, -2 margin
  reread_value: 73,          // corpus min 75, -2 margin
  language_level: 78,        // corpus min 80, -2 margin
  parent_buyer_value: 83,    // corpus min 85, -2 margin
  generic_story_risk_max: 60, // corpus max 65, -5 tightening margin (v5.2)
} as const;

export const STORY_GATE_VERSION = "v5.2-2026-07-19-generic-risk-corpus-max-minus-5";

