## Goal

Re-cover, rebuild thumbnail, re-assemble PDF for these 6 books under the latest cover rules (interior-first refs, spelling verify, uniqueness gate, per-provider fallback), then drive to `listing_status=live, sellable=true`.

**Draft (need first-time cover + PDF + thumb):**
- d243bb53 — Fierce Sea Animals Coloring Book (Ages 4-6)
- ab1f0b77 — Cute Cozy Coloring Coloring Book (Ages 4-6)
- c2839b88 — Fierce Floral and Botanical Coloring Book (Ages 4-6)

**Live but parked on `provider_billing_exhausted` (need refresh cover in PDF + new thumb):**
- 83ffcf21 — Cute Floral and Botanical (Ages 4-6)
- 53883c93 — Cute Princess Fairy and Magic (Ages 4-6)
- d4e77e5b — Fierce Dinosaurs (Ages 4-6)
- e86fe400 — Cute Dinosaurs (Ages 4-6)

(4 live books actually surfaced; will apply the same treatment to all four.)

## Root cause

Books parked because the cover single-rung (Ideogram-only via Runware) hit `provider_billing_exhausted` / `text_verify_failed` / `runware_ideogram_http_400 failedToTransferImage` / `transcription_mismatch` and the per-book `MAX_COVER_INVOCATIONS_PER_BOOK=5` ceiling latched them. Latest cover contract (interior-first refs, spelling gate, uniqueness) + Runware→CF→FAL per-provider latches are already deployed; the parked books never got a fresh attempt under those rules.

## Steps

1. **Unpark migration** (single SQL migration):
   - Reset `metadata.coloring_cover_invocations = 0` for the 7 book IDs.
   - Clear `blocker_reason` on the 3 draft books.
   - For the 4 live books: keep them live, set `metadata.cover_upgrade_pending=true`, `metadata.focus_run=true`, `metadata.qc_mode_override='learning'`.
   - For the 3 drafts: set `metadata.focus_run=true`, `metadata.qc_mode_override='learning'`, null out `cover_url` / `thumbnail_url` / `pdf_url` to force full rebuild.
   - Insert `coloring_book_events` row per book: `event='owner_recover_relaunch'`.

2. **Force provider re-latch check** — reset any expired per-provider daily latches touched by these books (Runware / Cloudflare / FAL rows in `generation_settings.provider_latches` older than today's UTC boundary).

3. **Dispatch** — enqueue via `coloring-worker-tick` with focus flag; drafts run interior-first→cover; live books run `coloring-book-cover` (uses first 3 interior pages as `referenceImageURLs`) → thumbnail regen → PDF re-assemble (cover swap only, interior pages preserved via existing page manifest hashes) → publish-contract v3 with `cover_spelling_verified` + `cover_uniqueness` gates.

4. **Verify** — poll every 30 s up to 20 min. Success = `listing_status='live' AND sellable=true AND cover_url IS NOT NULL AND thumbnail_url IS NOT NULL AND pdf_url IS NOT NULL AND blocker_reason IS NULL`. Report per-book final state and cover/thumbnail URLs.

5. **If any book re-parks**: capture the exact `blocker_reason`, do NOT force-publish, surface it back for owner decision (per non-negotiable rule: no gate bypass).

## Technical details

- Migration file: `supabase/migrations/<ts>_recover_6_parked_covers.sql` — pure UPDATE/INSERT on `ebooks_kids` + `coloring_book_events`, no schema changes.
- No edge-function code changes — the latest rules (interior-first refs, spelling gate, uniqueness, per-provider latches, invocation ceiling, learning-mode waivers) are already live from prior turns.
- Assembly path for the 4 live books uses the existing `coloring-book-assemble` cover-only swap branch (does not re-render interior pages, preserving cost).
- Publish contract remains v3 (non-waivable `cover_spelling_verified`). If a book fails spelling verify after 5 fresh invocations, it re-parks — expected and correct behavior.

## Out of scope

- Lowering thresholds, bypassing gates, or manually flipping to live without contract pass.
- Changes to interior page generation, sales-page copy, or storefront UI.
