## cover-category-gate-bypass-v1 (2026-07-17)

Class: `persistence_contract_bug` + `content_quality_failure`.

Symptom: 13 live coloring books shipped with mismatched backgrounds
(unicorn on ocean waves, dinosaur in sea, princess on waves, etc.). Root
cause = two defects compounding:

1. `generateIdeogramIntegratedCover` prompt lacked negative scene / forbidden
   background clauses, so Ideogram happily painted whichever environment its
   priors preferred (often ocean waves).
2. Ideogram accept path hard-coded `heroVerdict.matches = true; degraded = true`
   with reason `"ideogram_tier_hero_skip_due_to_verified_integrated_typography"`,
   skipping category/hero vision QC entirely. Downstream `measuredCoverScorecard`
   then wrote `cover_category_match = 99` regardless of the actual scene, and
   `qc_scorecard.cover` stayed NULL so nothing could catch the mismatch.

Permanent fix:
- `_shared/coloring/ideogram-integrated-cover.ts` — scene guard: mandatory
  category-appropriate background clause + hard negative background/subject
  lists derived from `forbiddenSubjects` and the category family.
- `coloring-book-cover/index.ts` — real `verifyCategoryHero` call for every
  Ideogram accept attempt; degraded or non-matching → discard + retry.
- `_shared/coloring/publish-contract.ts` v2 — new `cover_category_verified`
  check. NULL/missing gate data is a HARD FAIL, never a silent pass.
  Enforced in both `kids-publish-if-qc-passed` and `coloring-book-publish`
  BEFORE any learning-mode waiver.

Regression fixture: `src/lib/coloringPublishContract.test.ts` extended so a
NULL `coloring_cover_gate` fails the contract.
