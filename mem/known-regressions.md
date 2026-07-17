## dispatcher-head-of-queue-stall-v1 (2026-07-17)

Class: `state_machine_bug` + `idempotency_bug`.

Symptom: Autopilot showed 30 queued, engine "running", but 0 generating
and 0 published for 40+ minutes. `cost_log` had zero new `runware_direct`
or `cloudflare_direct` rows despite Runware being the healthy primary
provider. `last_worker_tick_result.dispatched` kept showing the same 3
top rows with `note: "timeout_treated_as_dispatched"`.

Root causes (compounding):

1. `coloring-book-publish` returned raw HTTP 422 `interior_incomplete`
   whenever `metadata.coloring_pages.length !== plan.length`, even though
   the assembled PDF was complete (`assembly.page_count ===
   expected_page_count`) with placeholders inserted for the 2–3 pages
   whose interior render failed under the earlier fal billing lock.
   The 422 did NOT update `blocker_reason` or `awaiting`, so the row
   stayed at the head of the `created_at ASC` queue and every subsequent
   tick redispatched the same row for the same 422.
2. `coloring-worker-tick` picked queued rows purely by `created_at ASC`
   with no dispatch cooldown, so the 3 stuck head-of-queue rows consumed
   100% of `max_parallel` on every tick and the remaining 27 books were
   never selected. Runware was healthy but never called for them.
3. `generateImageWithFailover` had no per-provider hard timeout. A hung
   provider request (billing-locked account that never returns) could
   silently eat the whole dispatcher wall-clock budget before failover
   to the next provider — matching the "one provider hangs, whole queue
   stalls" pattern.

Permanent fix:

- `coloring-book-publish/index.ts` — trust the assembled PDF as the
  interior-completeness source of truth. Any missing metadata pages get
  logged into `defect_ledger` under batch-learning-mode instead of
  becoming a forever-422.
- `coloring-worker-tick/index.ts` — fetch a wider candidate window and
  filter out rows dispatched within the last 90s
  (`metadata.coloring_last_dispatched_at`). Cooldown is stamped on every
  dispatch so no single row can hog the parallelism budget.
- `_shared/image-providers.ts` — every provider call is wrapped in a
  45s hard timeout inside `generateImageWithFailover`; a timeout is
  treated as an immediate failover signal so the next healthy provider
  is tried within the same page attempt.

Regression fixture idea: enqueue a book with `metadata.coloring_pages`
length 30 and `plan` length 32 plus a valid assembled PDF; publish must
succeed and append a `defect_ledger` entry with
`gate: "interior_page_count"`.



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
