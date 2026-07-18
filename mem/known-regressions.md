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

## cover-generation-infinite-retry-loop-v1 (2026-07-17)
Class: `state_machine_bug` (unbounded_cover_retry).

Symptom: 1,935 `coloring_cover_ideogram` calls in a ~5.5-hour window
(15:00–20:00 UTC 2026-07-17), $116.10 total on `ideogram:4@1` via Runware.
Peak: 871 calls in a single hour at 17:00 UTC (~$52/hr). Cost_log rows all
had `ebook_id=NULL` so per-book attribution was impossible without joining
edge logs.

Root cause: `coloring-book-cover` had a per-INVOCATION cap
(`MAX_IDEOGRAM_ATTEMPTS=3`) but no per-BOOK invocation ceiling. When
`verifyExactCoverText` kept rejecting all 3 Ideogram attempts, the function
called `scheduleSelfAdvance` + set `pipeline_status='queued'`, and
`coloring-worker-tick` immediately re-dispatched the same book. Loop rate ≈
3 Ideogram calls every ~20s per book × N books = $10/hour lane-wide.
`cover-upgrade-sweep`, `coloring-book-publish`, `kids-publish-if-qc-passed`,
`coloring-book-render`, `coloring-book-assemble`, and `stall-watchdog` all
also re-invoke `coloring-book-cover` with `force=true`, compounding the loop.

Permanent fix:
- `supabase/functions/coloring-book-cover/index.ts` — added
  `MAX_COVER_INVOCATIONS_PER_BOOK = 5` + `COVER_RETRY_CEILING_REASON`.
  Every non-upgrade invocation increments `metadata.coloring_cover_invocations`
  BEFORE any provider call. When the ceiling is hit, book parks with
  `blocker_reason='coloring_cover_retry_ceiling_reached:N'` and DOES NOT
  call `scheduleSelfAdvance`. Human/admin resets by clearing
  `metadata.coloring_cover_invocations` and the blocker.
- `supabase/functions/coloring-worker-tick/index.ts` — extended
  `LANE_BLOCKED` regex to include `coloring_cover_retry_ceiling_reached`
  so parked books are skipped by the dispatcher forever.
- Registered doctrine `unbounded_cover_retry_ceiling` in `pipeline_skills`.

Owner rule: any repair loop that calls an external paid provider MUST have
a per-subject invocation ceiling backed by a persisted counter, not just a
per-invocation attempt cap. The attempt cap only bounds one call; the
invocation ceiling bounds the loop.

---

## Story-gate repair retry storm (2026-07-18 P0)

Class: **unbounded expensive-tier repair retry** (2nd occurrence in one day
after `unbounded_cover_retry_ceiling`).

Symptom: `cost_log` step `kids_repair_story_gate_rewrite` on
`google/gemini-2.5-pro` at 469 calls / $31.87 in 24h — single books
accumulating 30+ pro-tier rewrites (avg $0.068/call). For comparison,
`kids_story_judge` runs 1249× on `gemini-2.5-flash` for $1.17 total.

Root cause: `kids-repair-story-gate` had a per-INVOCATION `MAX_ATTEMPTS=3`
cap, but no per-BOOK invocation ceiling. Both `autopilot-kids-pipeline`
(line 223) and `kids-repair-supervisor` (line 728) dispatch the repair
directly on story_gate failure and then resume the pipeline; a book
oscillating around the judge threshold would loop
pipeline → story_gate fail → repair (3 pro-tier rewrites) → resume →
story_gate fail → repair (3 more) … indefinitely. Additionally, every
rewrite ran on the most expensive model tier when the flash tier is 75×
cheaper per RATES table in `_shared/ai.ts`.

Permanent fix:
- `supabase/functions/kids-repair-story-gate/index.ts` — added
  `MAX_INVOCATIONS_PER_BOOK = 3`. Counter persisted at
  `storefront_meta.story_gate_repair_invocations` and incremented BEFORE
  any provider call. When exceeded, book is retired with
  `blocker_reason='story_gate_repair_ceiling_reached:N_invocations'` so
  the one-click loop rotates to a fresh concept.
- Same file — `rewriteManuscript()` now uses cheap-tier-first:
  attempts 1..(MAX_ATTEMPTS-1) → `gemini-2.5-flash`; only the final
  attempt escalates to `gemini-2.5-pro`. Expected spend cut ≈ 90% on this
  step at equal or better convergence (flash is calibrated on the same
  judge rubric).

Owner rule (reiterated): any repair loop that calls an external paid
provider MUST have (a) a per-subject invocation ceiling backed by a
persisted counter, and (b) cheap-tier-first routing with expensive-tier
reserved for the final attempt. The attempt cap only bounds one call;
the invocation ceiling bounds the loop; tier routing bounds the unit cost.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## right-first-time-story-generation (2026-07-18)

Category: **architecture defect class — unbounded expensive checking/fixing
loop cost more than doing it right once**.

Evidence: 1,843 `kids_story_judge` calls + 468 story-gate repair calls
in 48h across a few dozen books (~30+ AI calls/book), while the
skill-learner minted 119+ versions of `playbook_reread_value` /
`craft_rules` without moving the first-pass story_gate rate (oscillated
14–55%). Judge + repair cost dominated total spend for kids track.

Permanent fix (four coordinated changes):
1. **Writer default tier promoted + rubric baked in** —
   `_shared/kids-segments.ts` `DEFAULT_MODEL` is now
   `google/gemini-2.5-pro`. `WRITER_SYSTEM` now carries the full
   `story_gate` rubric (per-dimension thresholds, ban on moralizing
   lines, callback-ending requirement). The model writes TO the rubric,
   not against it blind.
2. **One inline regeneration, then retire** —
   `autopilot-kids-pipeline/index.ts` `storyGate` runs the judge, and on
   failure regenerates the manuscript ONCE with the judge's per-dimension
   `evidence[]` appended to the craft block, then re-judges. Second
   failure throws → step policy retires the concept (concept rotates).
   No external repair ladder. `STEP_FAILURE_POLICY.story_gate` changed
   from `'repair_story_gate'` → `'retire'`. The
   `kids-repair-story-gate` and `kids-surgical-story-repair` functions
   remain deployed as backstops for anything that still calls them (the
   MAX_INVOCATIONS_PER_BOOK ceiling from the earlier fix stays) but the
   canonical pipeline no longer auto-invokes them.
3. **Judge cheapest capable tier, one call** —
   `_shared/kids-story-judge.ts` `JUDGE_MODEL` is now
   `google/gemini-2.5-flash-lite`. The judge already returns all
   per-dimension scores + per-dimension `repair_action` feedback in one
   structured-JSON call; no multi-pass judging.
4. **Skill-learner frozen** — `kids-skill-learner` returns a `{frozen:
   true}` no-op. `_shared/story-craft-skill.ts` loader now pins the
   earliest `source='seed'` version for `playbook_reread_value`,
   `playbook_parent_buyer_value`, `playbook_emotional_payoff`,
   `craft_rules`, and `anti_preachy`. All prior learned versions remain
   in `pipeline_skills` for future analysis (owner-approved freeze, not
   deletion).

Target: ~3–5 AI calls/book (writer + judge, optional regen + re-judge)
vs the old ~30. No lowering of gate thresholds — the change is WHERE
quality is enforced (generation time, not repair time). All calls
continue to route through `smartChat` (gemini-direct → openai-direct →
gateway last resort).

## golden-path-coloring-v1 (2026-07-18)
Owner-approved default for the coloring lane. One template, category-only
variation. Whitelist enforced in `coloring-autopilot-tick`; template
constants in `_shared/coloring/golden-path.ts`.

- Age band 4-6, 32 pages, DEFAULT_KIDS_4_6_STYLE style contract.
- Interiors: Runware flux `runware:100@1` via failover chain (CF → Runware → fal).
- Cover: GPT Image Tier-1 → Ideogram fallback, 5-invocation ceiling, inpaint retries.
- Anatomy vision QC batched in groups of 8 pages per call (was 6).
- Two-strikes → rotate: any gate failing twice on the same book parks the
  row (`pipeline_status='parked_rotated'`) and fire-and-forgets a fresh
  whitelisted concept via `coloring-autopilot-tick`. See
  `_shared/coloring/golden-path.ts` `parkAndRotate()`.
- No mid-book calibration pause for whitelisted categories — anatomy +
  style + aspect gates cover what the 25% owner-review pause checked.
- Whitelist: dinosaurs, sea_animals, farm_and_woodland, pets_cats_dogs,
  floral_botanical, unicorn_fantasy, princess_fairy_magic,
  preschool_toddler, seasonal_holidays, mermaid_ocean_fantasy.
- Non-whitelisted categories require explicit
  `coloring_autopilot.category_whitelist_extra: [key,...]` in generation_settings.

Doctrine: `pipeline_skills.skill='golden_path_coloring_v1'`.
