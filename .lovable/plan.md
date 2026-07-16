## Goal
Drive "Ocean Friends Coloring Adventure" from its current stuck state all the way to `listing_status=live` without you clicking anything else — fixing each failure class permanently as it surfaces.

## Current stuck point (evidence)
- Row `a05a5086…` — `pipeline_status=queued`, `blocker_reason=generate_interior:coloring_calibration_batch_failed: verify_at_birth: page 1 not a PNG (magic mismatch)`.
- My previous fix added `output_format: "png"` to the FAL call, but the second dispatch failed with the identical error. Conclusion: `fal-ai/flux/schnell` ignores that param and always returns JPEG. Attacking the symptom (forcing PNG) is the wrong class fix.

## Class fix (not row fix)
Stop pretending the bytes must be PNG. Detect the real format from magic bytes, store with the correct extension + content-type, and only fail when the bytes are neither a valid PNG, JPEG, nor WebP.

### Step 1 — Format-agnostic verify-at-birth
`supabase/functions/coloring-book-render/index.ts`
- Replace `verifyPngAtBirth` with `detectImageKind(bytes)` returning `"png" | "jpeg" | "webp"` or throwing.
- Keep the min-bytes guard (rejects blank/1-pixel outputs).
- Store extension + content-type from the detected kind (path becomes `page-01-<ver>.jpg` when JPEG).
- Persist `mime` in each `StoredPage` record so the PDF assembler picks the right decoder later.

### Step 2 — Storage upload uses detected mime
`supabase/functions/_shared/versioned-assets.ts` (call site only — no signature change if it already accepts contentType; otherwise pass through).
- Confirm `uploadAndSignImage` sets `contentType` from the detected kind, not hard-coded `image/png`.

### Step 3 — Regression test (defect class lock)
`src/lib/coloringGates.test.ts`
- Add cases: PNG magic passes, JPEG magic passes, WebP magic passes, random bytes throw, undersized bytes throw. Test fails on today's code, passes after Step 1.

### Step 4 — Re-dispatch stuck row + sibling
- Clear `blocker_reason` on `a05a5086…` and `19ca7a86…`, drop the legacy `awaiting: p0_close_before_generation` flag on both (already patched in `coloring-book-start` for new rows; these two predate the patch).
- Invoke `coloring-worker-tick` manually to dispatch.

### Step 5 — Auto-fix loop until calibration approved
Poll every ~60s and, for each new failure class that appears, apply the standing doctrine (evidence → class fix + regression test → resume). Concretely I will watch for and be ready to fix:
- `generate_interior:*` — image-provider issues (rate limit, safety flag, empty url).
- `persistence_contract:*` — missing plan/style-contract fields.
- `upload_failed:*` — storage bucket / signing errors.
- `stall_no_progress` — self-invocation loop broken; add explicit re-tick.

When all 4 calibration pages land, the engine parks at `awaiting: owner_calibration_review` (25%). I will assemble those 4 pages into an 8.5×11 portrait PDF and post it here for your visual sign-off. **This is the one mandatory human gate** — the reference-style match must be verified by you before 28 more pages burn budget.

### Step 6 — After you approve calibration
Set `metadata.coloring_calibration_approved=true`, worker resumes automatically, remaining 28 pages render in batches of 6 with self-invocation.

### Step 7 — Cover + PDF + publish (post-calibration, still auto)
Currently the engine parks at `awaiting: cover_pdf_publish` (90%) because that chain hasn't shipped yet. I will build it in this same auto-fix loop:
- `coloring-cover-render` — textless cover art (FAL Ideogram v3 for title-safe area), SVG typography overlay for title + "Ages 4-6" badge (deterministic, not model-drawn text).
- `coloring-build-pdf` — assemble 32 pages (cover + 28 interior + 3 front/back matter) into 8.5×11 portrait via existing `kids-picture-pdf` helpers, adapted for line-art (no bleed, safe margin lock).
- `coloring-publish` — price $4.99, generate storefront thumbnail, flip `listing_status=live`, `sellable=true`. Reuses existing `kids-publish-if-qc-passed` gate contract.

### Step 8 — Live proof
Report back with: PDF URL, cover URL, storefront URL, and the release-manifest validator result. Only then do I use the word "live".

## Guardrails
- No QC threshold lowered. No gate bypassed.
- Every fix ships with a failing-then-passing regression test.
- Same-class failure ×2 → I pause and re-diagnose instead of blind retry.
- Cover/PDF chain runs sequentially inside the coloring lane; does not touch picture-book lane.

## What you'll see
1. Ping when calibration PDF (4 pages) is ready for your review — **you approve or reject here**.
2. Ping when full 32-page PDF is assembled.
3. Ping when the book is live with URLs.
