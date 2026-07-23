
## Target book
`Starlight Unicorns Coloring Book`
- `ebooks_kids.id` = `10bcda01-319a-40e7-bf12-55df05370770` (live, sellable, qc=92)
- `coloring_v2_books.id` = `0c1bfd74-0a00-4ab0-be16-794706c5420c`
- Current cover asset meta: `ocr_pass:false`, `ocr_soft_accept:soft_accept_cf_fallback_runware_billing_locked` — cover was accepted under a soft‑accept branch during a provider outage, which is why the title spelling / composition slipped through.
- Interior assets carry no `repair_verdict` yet — the anatomy sweep has never run on this book.

The user reports: cover spelling wrong, unicorn proportions wrong, missing/severed limbs, deformity. Both cover AND interior must be repaired, and the fix must be permanent (defect class, not one row).

## Part A — Repair this specific book (one-book-at-a-time law)

1. Demote the book off the storefront while repair runs
   - `ebooks_kids`: `listing_status='draft'`, `sellable=false`, `blocker_reason='repair_starlight_unicorns_anatomy_cover'`.
   - `coloring_v2_books`: `publish_status='draft'`, `qc_status='pending'`, `stage='interior_render'`, `stage_attempt_count=0`.

2. Interior sweep (permanent, resumable)
   - Drop stale `repair_verdict` on any interior asset for this book (schema already supports it in `meta.repair_verdict`).
   - Call `coloring-v2-repair-book` in the existing bounded-batch loop (BATCH_SIZE=6) with `preserve_cover:false` — this book's cover is bad, we want it regenerated too. The function will:
     - dedupe interior duplicates,
     - run `checkPageAnatomy` (OpenAI → Gemini → Lovable ladder),
     - drop failed pages + all cover assets,
     - reset stage to `interior_render` and fire `coloring-v2-render-page` at the first missing page.
   - The V2 render worker already carries the negative-prompt clause from `defectsToNegativeClause` so re-rendered pages get "no fused limbs / severed limbs / wrong count of legs / missing limbs / extra head".

3. Cover regen — illustrated hand‑lettered path (drawn cover, not overlay)
   - Owner law from earlier: unicorn cover must be *drawn*, not font‑stamped.
   - After interiors pass, invoke `coloring-v2-illustrated-cover-once` (already exists, produces the `cover_illustrated_hand_lettered_once_v1` asset that the V2 cover stage short-circuits on).
   - This runs on the smart‑AI‑only ladder (Gemini / GPT‑Image) per the `cover_smart_ai_only_v9` + `cover_3_strike_stop_v10` doctrine — no Cloudflare / Runware for covers.

4. Finish + republish
   - Fire `coloring-v2-pdf` → `coloring-v2-qc` → `coloring-v2-publish` via the existing tick.
   - Only re‑flip `listing_status='live'` when: (a) OCR/typography verifier passes on the new cover, (b) every interior has `repair_verdict.pass=true` and `degraded=false`, (c) QC ≥ 90.

## Part B — Permanent fixes (defect class)

These change the *system*, not just this book, so future unicorn / horned / winged animals cannot ship with the same defect.

1. `_shared/coloring-v2/anatomy-check.ts` — subject-aware canonical-parts contract
   - Extend the auditor with a small per‑subject part inventory (unicorn: 4 legs, 1 horn, 1 tail, 2 eyes, 1 head; pegasus: +2 wings; mermaid: 1 tail-fin, 2 arms; dragon: 4 legs+2 wings+1 tail; etc.).
   - Feed it in the user prompt as `Canonical parts: {…}`. The auditor already fails on wrong-count / missing / extra parts; giving it the count table upgrades detection from "vibes" to a checklist.
   - Add `wing_count`, `horn_count`, `tail_count` to the defect map + `defectsToNegativeClause`, so renderer negative prompts get "no extra horn, no missing tail, no missing wing, no bent horn" for unicorn class.
   - Bump gate version to `v2:coloring_v2_anatomy_gate` and record it in `pipeline_skills`.

2. Kill the cover soft‑accept branch for spelling
   - In `coloring-v2-cover/index.ts`, the current path allowed `ocr_soft_accept:soft_accept_cf_fallback_*` to mark the cover final when OCR mismatched during a provider outage.
   - New rule: if OCR/typography verifier fails, do NOT persist as `cover_final`. Instead persist as `cover_candidate`, keep `approved_cover_asset_id=null`, and route to `coloring-v2-illustrated-cover-once`. Emit `cover_no_soft_accept_v12` skill.
   - Legacy books already live keep their assets; this only stops future books from being force‑accepted.

3. Republish guard
   - Extend `ebooks_kids_coloring_spelling_guard` (already demotes on missing OCR evidence) to also demote when `metadata.coloring_cover.evidence.transcription.ocr_soft_accept` contains `runware_billing_locked` or `cf_fallback` — a legacy flag from the soft‑accept era. Prevents any republish of a book that only ever passed under soft‑accept.

4. Regression fixtures
   - Add `.lovable/regressions/unicorn-anatomy-and-cover.md` documenting: (a) the Starlight Unicorns failure, (b) canonical-parts contract, (c) soft-accept removal, (d) three-book fresh-run expectation.
   - Register `pipeline_skills` rows: `anatomy_canonical_parts_v2`, `cover_no_soft_accept_v12`.

## Technical section

- Files created/changed:
  - `supabase/functions/_shared/coloring-v2/anatomy-check.ts` — add canonical-parts prompt block + expanded defect map; version bump.
  - `supabase/functions/coloring-v2-cover/index.ts` — remove soft-accept `cover_final` write; persist as `cover_candidate`; hand off to illustrated-cover-once.
  - `supabase/functions/coloring-v2-repair-book/index.ts` — accept `clear_prior_verdicts:true` to wipe `meta.repair_verdict` on demand (needed to force re-check of this book's interiors under v2 rules).
  - Migration (data-only, no schema): update `ebooks_kids` + `coloring_v2_books` for the target book; insert two `pipeline_skills` rows.
  - `.lovable/regressions/unicorn-anatomy-and-cover.md`.
- No new tables, no RLS changes.
- No lowered thresholds. Anatomy gate stays at `score ≥ 90 && defects=[] && recognizable=true`.
- One book at a time: nothing else re-enters the queue during this run.

## Exit criteria
- Every interior page of Starlight Unicorns has `meta.repair_verdict.pass=true`, `degraded=false`, `score ≥ 90`.
- New cover asset carries `cover_illustrated_hand_lettered_once_v1` + OCR/typography verifier pass=true (no soft-accept).
- QC ≥ 90, PDF regenerated, `listing_status='live'`, `sellable=true`.
- Next two fresh unicorn/horned-animal books hit `final_pdf_ready` without a soft-accept flag.
