
# Cover spelling gate — non-waivable, must pass before Live

## Problem

The uploaded Farm & Woodland cover shows a misspelled subtitle ("Coloring Bookl-Fname"). The pipeline already OCRs the cover (`verifyExactCoverText` in `_shared/coloring/cover-text-transcription.ts`) and detects `missing` / `extra` / `misspelled` tokens, but in learning mode the failure is only written to the defect ledger and the book is still shipped Live. Result: covers with clearly wrong words reach the storefront.

Owner directive: after cover generation and before the book flips to `listing_status='live'`, add a spell-check gate that CANNOT be waived by learning mode.

## Fix (3 parts)

### 1. Add a hard `cover_spelling_verified` check to the publish contract

`_shared/coloring/publish-contract.ts` gains a 5th non-waivable check alongside the existing baked-title / trim / thumbnail / category checks. It reads the persisted transcription evidence stored on the cover record (`metadata.coloring_cover.evidence.exact_transcription` and the mirror at `coloring_cover_gate.scorecard.evidence.exact_transcription`) and fails when any of these are true:

- `misspelled_required.length > 0` — a required title token appears as a near-match typo on the cover (e.g. `book → bookl`, `friends → freinds`).
- `extra` contains any garbage token that isn't in `CHROME_TOKENS` and isn't a known chrome word (subtitle/badge tokens that OCR sometimes joins with hyphens). Hyphenated OCR joins get split before comparison so "Book-Fname" → `["book","fname"]` and `fname` is a hard-fail extra.
- Transcription evidence is missing OR `degraded: true` — treated like NULL cover QC: hard fail, force regeneration. (Never a silent pass.)

Because this lives in `assertColoringPublishContract`, which `coloring-book-publish` already enforces **before** the learning-mode branch, it blocks Live for every book regardless of `qc_mode`. Failure sets `blocker_reason='coloring_publish_contract:cover_spelling_unverified:...'` and posts back to `coloring-book-cover` with `force:true`, same pattern used today for category/baked-title failures.

### 2. Make the cover step retry on spelling failure instead of accepting

`supabase/functions/coloring-book-cover/index.ts` today accepts the first Ideogram attempt whose category+hero pass, then falls to the learning-mode "waived" rungs (e.g. `ideogram_v3_learning_waived_a3` that Ocean Friends used). Update the acceptance ladder:

- Spelling verdict (`verifyExactCoverText`) is now a first-class rung check, not an evidence field. An attempt with `misspelled_required.length > 0` or garbage `extra` tokens is rejected and retried, up to the existing 3-attempt cap.
- After 3 spelling failures, the cover step still writes the attempt to storage BUT does **not** stamp `cover_accepted=true` — instead sets `metadata.cover_spelling_stubborn=true` and enqueues a REPLAN (drop subtitle tokens that Ideogram consistently mangles, keep title-only) rather than a blind 4th attempt. Same escalation shape as the existing text-page escalation in `first-pass-learner.ts`.
- Learning mode can still waive category/hero (as today), but NOT spelling.

### 3. Strengthen the Ideogram prompt spelling clause

`_shared/coloring/ideogram-integrated-cover.ts` prompt gains an explicit STRICT SPELLING CONTRACT block ("render every letter of these exact words, do not invent letters, do not append or drop characters, do not hyphenate mid-word") tied to the required tokens, alongside the existing text contract. Prompt-side prevention is cheap and reduces the retry rate — but the gate above is what guarantees no misspelled cover ever ships.

## Backfill

One-shot query to identify already-live coloring books whose stored `exact_transcription` evidence would fail the new gate, then reset those rows (clear `cover_url` / `thumbnail_url`, set `focus_run=true`, `pipeline_status='queued'`) so the fixed cover step regenerates them. Farm & Woodland (`607018e8-9190-4c30-b4ef-538a0fa999c9`) is confirmed in scope; the query catches the rest.

## Files touched

- `supabase/functions/_shared/coloring/publish-contract.ts` — add `cover_spelling_verified` check + hyphenation-aware token split.
- `supabase/functions/coloring-book-cover/index.ts` — promote spelling verdict to acceptance rung; add REPLAN escalation after 3 spelling fails.
- `supabase/functions/_shared/coloring/ideogram-integrated-cover.ts` — add STRICT SPELLING CONTRACT prompt clause.
- Migration: backfill query that resets books failing the new gate, plus a `pipeline_skills` row recording the doctrine `cover_spelling_never_waived`.

## Tests

- Unit: `assertColoringPublishContract` returns `pass:false, reason:cover_spelling_unverified` when evidence has `misspelled_required` or a garbage `extra`, and `pass:true` when evidence shows only optional-token gaps.
- Unit: hyphenated OCR join "Book-Fname" tokenizes into `["book","fname"]` and `fname` is flagged as extra.
- Integration: reset Farm & Woodland → cover regenerates → new cover with clean spelling → publish contract passes → Live.

## What this does NOT change

- Category / hero waiver via interior refs (owner-approved) stays as-is.
- Learning mode still waives boundary-sharpness, page-count, weighted-gate, etc. Only spelling becomes non-waivable.
- No threshold lowered.
