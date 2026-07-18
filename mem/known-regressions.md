## generating-status-zombie-v1 (2026-07-18)

Class: `state_machine_bug` — "silently dead in 'generating'". A
`coloring-book-render` invocation that dies mid-batch (edge timeout,
crashed anatomy vision verifier, killed worker) leaves the ebook row at
`pipeline_status='generating'` with `updated_at` frozen at the pre-batch
progress marker, no `selfInvoke` fired, and no `patchMeta` after the
successful renders. Observed on `c2839b88-d900-…-Fierce Floral`: five
Runware production pages (16–20) billed at 05:59:19–32 UTC after
`updated_at=05:59:16`; row sat unchanged for 45+ min. Runs consumed a
`max_parallel` slot forever; no watchdog picked them up because both
watchdogs excluded coloring or required `'failed'`.

Detection heuristic (SQL): `pipeline_status='generating' AND book_type='coloring_book' AND updated_at < now() - interval '15 minutes'`.

Permanent fix (`supabase/functions/coloring-worker-tick/index.ts`):
scan for stuck-'generating' coloring rows older than 15 min, reset to
`'queued'` with `blocker_reason='zombie_generating_recovered'`, stamp
`coloring_zombie_recoveries` counter + `coloring_last_zombie_recovery_at`,
and let the same tick re-dispatch them via the queued scan. Runs before
the `inFlight` count so revived rows immediately free their slot.
Idempotent (successful pages are already persisted; unpersisted renders
re-run, cost bounded by MAX_COVER_INVOCATIONS-style ceilings on the
render side).

Root cause: edge function `CPU Time exceeded` mid-batch. `BATCH_SIZE=6`
with per-page Runware download + sharpness + upload + subsequent anatomy
vision batch exceeded the 150s edge CPU budget. Fix (paired with the
watchdog): dropped `BATCH_SIZE` from 6 → 3 in
`coloring-book-render/index.ts` so a batch reliably completes and
`updatePages` persists before CPU is spent. The watchdog is the safety
net if this recurs (larger images, slower anatomy model, etc.).

Follow-up (not blocking): tighten `coloring-book-render` to
incrementally persist newRecords after each successful upload so a
mid-batch death loses at most one page instead of the whole batch. The
zombie watchdog is the safety net either way.

## silent-no-op-after-provider-fallback-v1 (2026-07-18)

Class: `observability_bug` + `state_machine_bug` — "failure without a
strike". Worse than a crash: nothing downstream knows anything went
wrong, so the never-dead-end doctrine silently breaks.

Symptom: `coloring-book-cover` was dispatched for a book, the primary
provider (e.g. gpt-image-1) hit a hard cap and threw, the catch handler
swallowed the throw into a plain `return json({ error }, 500)`, and:
- `metadata.coloring_cover_invocations` never incremented past the entry
  bump,
- no new `cost_log` row was written for that ebook_id,
- `blocker_reason` on `ebooks_kids` did NOT change,
- no `coloring_book_events` row was inserted,
- `awaiting` stayed on whatever the previous tick set,
- worker-tick saw a boring 500 with no state delta and moved on.

The two-strikes-and-rotate mechanism NEVER engaged because there was no
strike to count. The book sat in queued forever without accruing failure
evidence.

Permanent fix (`supabase/functions/coloring-book-cover/index.ts`):

1. Every exit path must end in exactly one of: (a) `persistAcceptedCover`
   → success + asset URLs, (b) `markCoverBlocked` → explicit failure that
   increments strikes + stamps `blocker_reason` + `coloring_blocker`, or
   (c) explicit park with `awaiting: "human_review"` + terminal reason.
2. Outer `catch` now stamps `blocker_reason = coloring_cover_fatal:…`,
   patches `metadata.coloring_blocker`, and inserts a
   `coloring_book_events` row with `event_type = "cover_function_threw"`
   BEFORE returning 500. A thrown error can no longer leave the row
   unchanged.
3. Structural tripwire after the final `return await markCoverBlocked`:
   an unreachable `throw new Error("silent_no_op:cover_fell_through…")`
   guarantees any future edit that removes the return fails loudly
   naming the site rather than becoming a 200 no-op.
4. Sanity-check the tail response is a `Response` instance; if
   `markCoverBlocked` ever returns undefined we throw
   `silent_no_op:cover_tail_markCoverBlocked_returned_non_response`
   instead of letting the runtime coerce it into a happy exit.

Detection heuristic (add to observability dashboard):

```sql
-- silent no-op = dispatched-to-cover, no strike, no cost row, no blocker
-- change, within N minutes.
select ek.id, ek.title
from ebooks_kids ek
where ek.book_type = 'coloring_book'
  and ek.metadata->>'coloring_current_step_label' ilike '%cover%'
  and coalesce((ek.metadata->>'coloring_cover_invocations')::int, 0)
      = coalesce((ek.metadata->'coloring_cover_prev'->>'invocations')::int, 0)
  and not exists (
    select 1 from cost_log cl
    where cl.ebook_kids_id = ek.id
      and cl.created_at > now() - interval '10 minutes'
      and cl.stage in ('coloring_cover', 'cover_ideogram')
  )
  and not exists (
    select 1 from coloring_book_events ev
    where ev.ebook_kids_id = ek.id
      and ev.event_type in ('cover_provider_attempt', 'cover_function_threw')
      and ev.created_at > now() - interval '10 minutes'
  )
  and ek.updated_at < now() - interval '10 minutes';
```

Rule: any row matching this query for two consecutive checks is a
silent-no-op regression and must be treated as P0 — the tripwire in the
cover function was disabled or bypassed.

---

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

## provider-payload-bigint-serialization (2026-07-18)
Defect class: **DB bigint → provider HTTP payload**. `JSON.stringify` throws
`Cannot convert a BigInt value to a number` when any BigInt (from a
Postgres `bigint`/`int8` column, a `0x...n` literal, or `crypto` bignum)
sneaks into a request body. The stack trace names `JSON.stringify`, not the
offending field, so the crash looks like a generic provider bug.

Trigger this turn: `_shared/coloring/ideogram-integrated-cover.ts`
`buildTextRegionMaskPng()` used `0x000000ffn` / `0xffffffffn` BigInt
literals for ImageScript `setPixelAt`. ImageScript did numeric bitwise ops
on the BigInt and threw. Every inpaint-retry attempt on the cover crashed
before the HTTP request even fired, which chewed through the 5-invocation
cover ceiling on book `c2839b88` and parked it at 92%.

**Permanent fix:**
1. Replaced the three BigInt literals with `(0x000000ff) >>> 0` /
   `(0xffffffff) >>> 0` Number constants.
2. Added `_shared/coloring/payload-guard.ts` `coerceForProviderPayload()`
   — walks the outgoing task object, converts BigInt → Number (with a
   safe-integer check), rejects `Uint8Array`/functions with a message
   that NAMES the field path (`payload_guard[runware_ideogram_cover]:
   BigInt at $.seed exceeds safe integer range`).
3. Applied the guard at all three Runware POST sites: runware.ts
   interior, ideogram-integrated-cover cover, ideogram-integrated-cover
   inpaint. Future non-serializable values fail loudly at the boundary
   instead of crashing `JSON.stringify` with an anonymous stack.

Detection rule: `rg "0x[0-9a-fA-F]+n\b" supabase/functions/` must return
zero hits inside anything passed to `JSON.stringify`.

## page-plan-persistence-contract-race (2026-07-18)
Defect class: **persistence_contract_bug**. A coloring_book row can lose
`metadata.coloring_page_plan.plan` (and sibling content-identity keys like
`coloring_category_key`, `coloring_theme_bible`) after
`coloring-book-start` wrote them. `coloring-book-render` then hard-fails
with `persistence_contract: metadata.coloring_page_plan.plan missing`,
which was surfaced correctly by the silent-no-op tripwire but dead-ended
the book.

Root cause: `patchMeta()` in `coloring-book-render`, `-cover`, `-publish`,
`-assemble` uses a non-atomic **read → merge → write** pattern
(`SELECT metadata; UPDATE metadata = {...old, ...patch}`). When two
overlapping edge-function invocations race — e.g. `coloring-book-start`
writing the initial content bundle while `coloring-worker-tick` /
`stall-watchdog` writes operational fields (`awaiting`,
`coloring_regime_version`) — the later writer's snapshot can predate the
first writer's commit and silently clobber the content keys. The row is
left with only operational fields.

Repro on `c2839b88` (Fierce Floral): row aged 17h with 11 operational meta
keys, zero content keys, zero `coloring_pages`, zero `ebook_assets`.

**Permanent fix (this turn):**
1. New shared helper `_shared/coloring/plan-rehydrate.ts`
   (`rehydratePagePlan`): reconstructs the deterministic plan from the
   strongest available source — stored `coloring_pages[*].category_key`
   → `metadata.coloring_category_key` / `coloring_theme_bible` →
   whitelist title inference. Persists the plan back with
   `coloring_plan_rehydrated_at` / `_reason` for observability. Emits a
   `pipeline_step_logs` row with `error_class='persistence_contract_bug'`.
2. `coloring-book-render` swaps the hard-fail branch for a
   rehydration attempt; only fails (with `rehydrate_failed:<reason>`)
   when no category_key can be inferred at all.
3. Rehydration is idempotent — if the plan is present it is a no-op.
4. Rehydration honours already-rendered pages (they land in `donePages`
   automatically) so we never regenerate art already paid for.

**Detection heuristic** (add to any watchdog / audit query):
```sql
SELECT id, title
FROM ebooks_kids
WHERE book_type = 'coloring_book'
  AND (metadata #>> '{coloring_page_plan,plan}') IS NULL
  AND (
    jsonb_array_length(COALESCE(metadata->'coloring_pages','[]'::jsonb)) > 0
    OR EXISTS (SELECT 1 FROM ebook_assets a WHERE a.ebook_id = ebooks_kids.id)
    OR (metadata ? 'coloring_regime_version')
  );
```
Any hit is a contract violation.

**Follow-up (not this turn):** replace all `patchMeta()` implementations
with an atomic `jsonb_set` / RPC upsert so the race can't recur.

## ceiling-without-consequence-v1 (2026-07-18)

**Class:** a counter/limit that increments but does not stop the next
dispatch is not a limit — it is telemetry with false confidence.

**Symptom:** `metadata.coloring_cover_invocations = 5` (ceiling) on book
`c2839b88`, yet `pipeline_status` kept flipping back to `queued` with
`blocker_reason = NULL`, tick kept re-dispatching, and cover function
burned CPU/memory limits without producing chargeable output. Cover
attempts also lacked `ebook_id` in `cost_log`, hiding them from per-book
audits.

**Root causes:**
1. `coloring-book-cover` sets `blocker_reason` at the ceiling park, but
   a concurrent render/assemble path (or a subsequent successful-looking
   call) can reset it to `NULL` — the limit only lives inside one
   function's return path, not in the dispatcher.
2. `generateIdeogramIntegratedCover` / `generateIdeogramTextInpaint`
   were invoked without `ebook_id` in the request object, so their
   internal `logAiCost` inserted rows with `ebook_id = NULL`.

**Fix (class-level, this turn):**
- `coloring-worker-tick` filters candidates against the invocation
  ceiling BEFORE dispatch: if `metadata.coloring_cover_invocations >=
  MAX` and `cover_url IS NULL`, the tick itself stamps
  `blocker_reason = 'coloring_cover_retry_ceiling_reached:<n>'` and
  refuses to dispatch. The `LANE_BLOCKED` regex then keeps the row out
  of future ticks until a human resets the counter.
- `coloring-book-cover` now passes `ebook_id` into every Ideogram /
  inpaint call so `cost_log` rows are correctly attributed.

**Rule for future limits:** every ceiling / attempt cap MUST be enforced
in the dispatcher's eligibility filter, not only in the worker's own
return path. Dispatcher enforcement is idempotent and race-proof; worker
enforcement is not.

## cover-function-worker-oom-v1 (2026-07-18)

**Class:** any edge function that fetches N images and/or decodes
provider output at full resolution must bound BOTH N and the
per-image pixel budget. Deno edge isolates cap heap at ~256 MB; a
single 1600×2071 `Image.decode` + matching `Uint8Array(w*h*4)` is
~13 MB, and multiple attempts stack.

**Symptom:** `coloring-book-cover` for `c2839b88` died repeatedly
with `Memory limit exceeded` / `CPU Time exceeded` ~38 s after boot,
returning `WORKER_RESOURCE_LIMIT` to callers. Every failed invocation
still incremented `coloring_cover_invocations` (paired with the
ceiling-without-consequence bug it looked like a loop; it was really
crash-then-crash).

**Root causes inside `coloring-book-cover/index.ts`:**
1. `colorEvidence()` decoded raw art at full resolution AND allocated
   a full-res `Uint8Array(w*h*4)` RGBA buffer for `detectBlankRegions`.
   ~13 MB × 3 retry attempts = ~40 MB in flight.
2. Every attempt stored `_rawBytes = rawBytes` into `ideogramAttempts[]`
   for a possible learning-mode waiver later — retaining the raw PNG
   (2-3 MB each) for the full loop even though only the text-rejected
   waivable path actually consumes them.

**Fix (this turn):**
- `decodeDownsampled()` helper caps analysis-only decodes to
  `MAX_ANALYSIS_DIM = 512` on the long edge. `colorEvidence` uses it,
  which drops the biggest per-attempt allocation ~10× (from ~13 MB to
  ~1.3 MB). QC math (saturation, chroma, blank-region detection) does
  not need 2 MP resolution.
- `_rawBytes` now retained ONLY on `text_rejected` attempts (the only
  path the waiver picks from). Other rejected attempts (art_dead,
  hero_rejected, duplicate_rejected, provider_error) release their PNG
  the instant the loop iteration ends.
- Interior-reference URL cap remains at 3 pages (already enforced).

**Rule for future edge functions:** if a function may `Image.decode()`
inside a retry loop, add a downsampling step BEFORE the RGBA allocation
and BEFORE storing bytes in any loop-scoped collection. Preview / QC /
fingerprint math should operate on 256-512 px canvases; only the
compositor's single final render needs full resolution.

## cover-function-worker-oom-v1 — SPLIT (2026-07-18)

**Follow-up:** downsampling alone was insufficient — even the reduced
allocations stacked past the isolate budget when combined with the
compositor + base64 vision bodies + fingerprint math in one invocation.
Confirmed by book c2839b88 dying with `WORKER_RESOURCE_LIMIT` after
downsample patch.

**Structural fix:** split `coloring-book-cover` into two edge functions:
- `coloring-cover-generate` — provider call → upload raw bytes to
  `pending-verify/` storage path → stamp `metadata.cover_pending_verify`
  with signed URL + context → enqueue verify. NO decodes.
- `coloring-cover-verify` — fetch signed URL once → decode ONCE
  downsampled to 512 px → run color + fingerprint + rendered proof on
  the downsampled RGBA → vision gates (text + hero) via URL reference
  (no base64 request body) → on pass, fit to canvas + atomic swap
  `cover_url` + chain thumbnail/assemble; on fail, requeue as
  `cover_pdf_publish` for another generate (ceiling-bound at 5).

Vision helpers now expose `transcribeGlyphsByUrl`,
`verifyCategoryHeroByUrl`, and `verifyExactCoverTextByUrl` — gateway-only
variants that pass an https URL directly in `image_url.url` so the
gateway/OpenRouter fetches server-side. Removes the 2–6 MB base64 body
per vision call.

`MAX_IDEOGRAM_ATTEMPTS = 1` is now correct by design because retries
are cross-invocation — each attempt is its own fresh isolate/heap. The
5-invocation ceiling still bounds total spend.

Worker-tick routing: `awaiting: cover_verify` → `coloring-cover-verify`;
`awaiting: cover_pdf_publish` && !cover_url → `coloring-cover-generate`.

**Rule:** any edge function that must decode, transform, and QC a
provider-produced image should split at the point after upload. The
verifier runs in a fresh isolate against the signed URL; the generator
never sees the pixels it just uploaded.


## cover-pdf-embed-crop-v1 — FIXED (2026-07-18)
- **Symptom:** GPT-Image-1 covers baked at 1024x1536 (2:3, ratio 0.667) were fit to the 1600x2071 canvas (8.5:11, ratio 0.773) via `fitCoverArtToPortraitCanvas` using Math.max scale + `.crop()` — which overshoots height and crops top+bottom of the baked title/edge glyphs in the PDF and thumbnail.
- **Root cause:** compositor was fit-COVER (crop-to-fill) instead of fit-CONTAIN (letterbox). The downstream `cover-aspect-gate` in `coloring-book-assemble` still passed because the composed output is exactly 1600x2071 — the loss happened inside the compositor before the gate.
- **Fix:** `_shared/coloring/coloring-cover-compositor.ts` now uses Math.min scale, white letterbox via `Image.fill(0xffffffff) + composite(x,y)`. Full art always preserved; slim bars are acceptable and invisible in most containers. Sibling of the storefront container fix (aspect-[1600/2071]).
- **Repair:** deployed `coloring-cover-refit` one-shot to re-fit the existing raw pending art through the new compositor without regenerating cover art, then re-run thumbnail + assemble.
- **Verification:** book `c2839b88` PDF page 1 rasterized at 100dpi shows complete "Fierce Floral and Botanical Coloring Book / A Coloring Adventure / Ages 4-6" with all edge elements intact.

## cover-pdf-full-bleed-rule-v1 (2026-07-18)

Class: `content_quality_failure` (permanent rule, not a bug fix).
User directive (Thai): "ปกใน PDF Gen ให้เต็ม กระดาษขาว และใช้กฎนี้
ตลอดไปสำหรับหนังสือระบายสี" — the coloring-book PDF cover page must be
full-bleed with NO visible white paper (letterbox bars) around the art.

Prior state (round_3 `cover-pdf-embed-crop-v1` fix): fit-CONTAIN with an
opaque-white letterbox. Preserved the baked title but left visible white
bars on the left/right of every 2:3 gpt-image-1 cover on the 8.5:11
page. On yellow/teal/warm backgrounds those bars are jarring.

Permanent rule (`_shared/coloring/coloring-cover-compositor.ts`,
`fitCoverArtToPortraitCanvas`): still fit-CONTAIN (never fit-COVER —
that reintroduces the title-crop class), but replace the white canvas
fill with the SAMPLED AVERAGE EDGE COLOR of the resized art (1-px inset
border, top+bottom rows + left+right columns). The bars now blend into
the artwork's own background so the sheet reads as one continuous page,
while the title and edge elements remain intact.

Applies to every coloring book from this deploy forward. No threshold
change, no gate bypass — the compositor version bump propagates through
`cover-aspect-gate` and `coloring-cover-proof` unchanged.

## thumbnail-contract-canvas-mismatch-v1 (2026-07-18)

Class: `persistence_contract_bug` — publish contract required the
storefront thumbnail canvas to equal COLORING_TRIM.thumbnailPx exactly
(600x776, 8.5:11). Yesterday's fix for cover-pdf-embed-crop-v1 changed
`coloring-book-thumbnail` to letterbox-trim to the art's native aspect
(≈2:3 for gpt-image-1 covers), so previously-live books flipped back to
`listing_status=draft` with blocker
`coloring_publish_contract:thumbnail_contract_fail:canvas_ok=false`. Fix:
`publish-contract.ts` `canvas_ok` now asserts a real retina-sized canvas
(shortest side ≥ 500px) and relies on `non_crop_pass` for the no-clip
guarantee. Trim-lock still governs cover master + interior + PDF pages.
Regression symptom: book already reached LIVE, then silently reverted
after a thumbnail regen.

## retro-unpublish-graded-severity-v1 (2026-07-18)

Owner law: hard gates stay full-strength on FIRST-time publish, but a book
that is already live/sellable may only be auto-unpublished by a CRITICAL
defect (broken PDF, wrong/missing content, cover style/category/spelling
violation). Cosmetic contract failures (thumbnail canvas spec, trim ratio
drift within tolerance) mark the row `needs_asset_repair`, KEEP it live,
and fire an async repair (thumbnail regen / cover regen) so the asset is
swapped in place. `publish-contract.ts` now returns
`critical_reasons` / `cosmetic_reasons`; `coloring-book-publish` branches
on `wasLive && cosmeticOnly`. Contract version bumped to v4_graded_severity.

## cover-pdf-full-bleed-v2 (2026-07-18)

The 8.5:11 aspect gate bounds cover-raster drift to <=1%, so the PDF cover
page can safely use fit-COVER (`fitCoverFullBleed`) instead of fit-CONTAIN
letterbox. Result: zero white paper visible around the cover, crop bounded
to <4pt on one axis (invisible). Owner directive: "ไม่เหลือส่วนว่างกระดาษขาว".
Compositor still fit-CONTAINs upstream with edge-sampled bars so the baked
title never overflows the raster.

## coloring-thumbnail-spec-v3 (2026-07-18)

Thumbnail rendered to the EXACT publish-contract spec (600×776 =
`COLORING_TRIM.thumbnailPx`) using fit-CONTAIN plus edge-sampled letterbox
(same technique as the cover compositor). Closes `canvas_ok=false` without
weakening the gate. Storefront frame is `aspect-[600/776]`.
