# One-Click Kids Build — Parent Production Job

## Goal

One admin click = one parent job that internally cycles concept → manuscript → story gate → art → PDF → QC, self-healing within bounded budgets, until it either publishes one live kids book or stops as `exhausted` with a clear final reason. Concept/story rejections are internal attempts, not red FAILED rows.

## Part 1 — Parent job storage

No new table. Reuse `autopilot_kids_runs` as the parent record, using existing `metadata` JSONB to store parent-job state under key `parent_job`:

```json
{
  "parent_job": {
    "target": "one_live_kids_book",
    "status": "searching_for_concept|writing_story|repairing_story|building_assets|running_qc|published|exhausted|failed_system_error",
    "attempt_count": 0,
    "concept_batch_count": 0,
    "story_repair_count": 0,
    "art_repair_count": 0,
    "pdf_repair_count": 0,
    "max_concept_batches": 5,
    "max_total_ebooks": 5,
    "max_total_runtime_minutes": 45,
    "child_attempts": [{ "ebook_id": "...", "outcome": "rejected_concept|shelved_story|shelved_art|shelved_qc|published", "scorecard": {...}, "ts": "..." }],
    "last_blocker": "",
    "final_reason": "",
    "started_at": "",
    "updated_at": ""
  }
}
```

Parent row keeps `status='queued'|'running'` until the internal loop resolves; only then is it set to `completed` (published) or `failed` (exhausted / system error). Rejected concepts and shelved child ebooks are recorded inside `metadata.parent_job.child_attempts` and never surface as top-level failed runs.

## Part 2 — New orchestrator function

New file `supabase/functions/kids-one-click-build/index.ts`:

- Creates ONE parent run row with `metadata.parent_job` seeded.
- Fires `EdgeRuntime.waitUntil(loop())` and returns `{ parent_run_id }` immediately.
- `loop()` runs bounded phases:
  1. `searching_for_concept` — call `kids-concept-preflight` with a `batch_lane` param rotating through: `food_kitchen_chaos`, `tiny_detective`, `animal_buddy_mechanical`, `neighborhood_micro_adventure`, `shop_library_museum_logic`. Up to `max_concept_batches` (5). Each batch = 3 candidates (existing constraint).
  2. On concept pass → call `kids-fresh-book-start` (with `locked_concept` supplied and skip its internal preflight) to create the child ebook and manuscript.
  3. On story gate fail → invoke `kids-repair-supervisor` up to 3 times.
  4. On art/PDF/QC fail → invoke `kids-repair-supervisor` (already routes correctly).
  5. On publish → parent status `published`, stop.
  6. On any child ebook shelved → increment `attempt_count`, if budget remains, loop back to concept search.
- Hard caps: `max_total_ebooks=5`, `max_total_runtime_minutes=45`, wall-clock check each iteration.
- Final resolution updates parent row status + `metadata.parent_job.status` + `final_reason`.

## Part 3 — Concept diversity across batches

Edit `supabase/functions/kids-concept-preflight/index.ts`:

- Accept optional `batch_lane` in body.
- When present, add a strong system directive: *"All 3 candidates must sit in the `<lane>` lane. Each candidate must differ in hero type, setting, story engine, refrain pattern, callback object type, and final-page payoff. Invent the story engine BEFORE the title. Reject funny-name-only concepts."*
- Add ban-list to the generator prompt: `bedtime/moon/star`, `emotional-regulation-only`, `tooth/bathroom`, `portal/wormhole`, `sock sorter`, `farm fiddle / barnyard dance`, `generic lost-object mystery`, `generic teamwork ending`.
- Return the full scorecard (existing behavior) so the parent job can persist it.

## Part 4 — UI changes

Edit `src/components/admin/BuildKidsBookButton.tsx`:

- Invoke `kids-one-click-build` instead of `kids-fresh-book-start` + `kids-repair-tick`.
- Display parent job status label from `metadata.parent_job.status` mapped to friendly text:
  - `searching_for_concept` → *Searching for a strong concept*
  - `writing_story` → *Writing story*
  - `repairing_story` → *Story repair in progress*
  - `building_assets` → *Building cover and illustrations*
  - `running_qc` → *Running final QC*
  - `published` → *Published*
  - `exhausted` → *Stopped: <final_reason>*
- Show concept batches attempted + child ebook attempts as small counters, not red failure rows.

Edit `src/pages/admin/KidsAutopilot.tsx`:

- Filter list to hide rows where `metadata.parent_job.parent_run_id` is set (child cosmetic runs) — but since we're not creating child rows, the list stays clean by construction.
- Render friendly status labels from `metadata.parent_job.status` when present.
- Remove/repurpose `Force finish` on quality-gated jobs so it means "trigger next repair tick", never force publish.

## Part 5 — Run one parent job

After deploy, POST to `kids-one-click-build` with `{ age_band: "4-6", preferred_lanes: [...as listed...] }`. Poll parent row every ~15s up to runtime cap. Report final state.

## Part 6 — Guardrails (unchanged)

- No threshold changes anywhere.
- No Shopify calls.
- No review seeding.
- No art before story gate passes (existing pipeline enforces this).
- Publish only via existing `kids-publish-if-qc-passed` with strict measured QC.

## Files touched

- **New:** `supabase/functions/kids-one-click-build/index.ts`
- **Edited:** `supabase/functions/kids-concept-preflight/index.ts` (batch_lane + ban-list)
- **Edited:** `supabase/functions/kids-fresh-book-start/index.ts` (accept pre-locked concept, skip preflight)
- **Edited:** `src/components/admin/BuildKidsBookButton.tsx` (invoke parent job, friendly status)
- **Edited:** `src/pages/admin/KidsAutopilot.tsx` (friendly labels, hide raw child attempts)

## Explicitly NOT in this plan

- No new tables or migrations.
- No threshold changes.
- No repair-handler internal changes (supervisor keeps its bounded logic).
- No Shopify, no reviews, no soft-passing.
