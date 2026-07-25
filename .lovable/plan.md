
# Permanent Fix: No White Border on Covers (Full-Bleed Law v2)

The uploaded cover shows a cream/white outer border around the artwork, wasting thumbnail area. Books were already supposed to be full-bleed (`cover_full_bleed_edge_verifier_v15` + FILL-THUMBNAIL Law), but the current writer path is still baking framed/matted compositions. This fixes it permanently across prompt, verifier, and post-process.

## Changes

### 1. Prompt hardening — `supabase/functions/_shared/coloring/master-cover-prompt.ts`
- Add explicit `HARD BAN` block: no white border, no cream matte, no framed illustration, no rounded card, no drop-shadow card, no inner padding, no "sticker on background".
- Add positive rule: artwork must bleed to all 4 edges; background color/illustration touches pixel row 0 and last row, column 0 and last column.
- Applied to every art-style writer (all 10 seeds) via the shared prefix — no per-style overrides allowed.

### 2. Edge verifier upgrade — `_shared/coloring/edge-bleed-verifier.ts` (rename of v15)
- Sample the outer 3% ring of the rendered cover.
- If >60% of ring pixels are near-white (L\*>92) OR near-uniform pale (chroma <8) → **FAIL** with reason `white_border_detected`.
- Also fail if the 4 corners are all pale while the center is saturated (frame signature).
- Runs before OCR gate in `coloring-v2-illustrated-cover-once`.

### 3. Retry loop
- On `white_border_detected` failure: regenerate with an injected steering suffix ("previous attempt had a cream border — extend illustration to the very edge, no frame, no matte") and lower the acceptance count against 3-strike lock.
- After 3 strikes → escalate to `cover_illustrated_only_v12` fallback style with `full_bleed=hard` flag, NOT to a matted fallback.

### 4. Post-process safety net — `_shared/coloring/cover-composite.ts`
- If the final composite still has a detectable pale ring <2% of shortest edge (thin artifact from model), auto-crop to remove it and re-fit to 1088×1408.
- Never re-add padding, never letterbox.

### 5. Backfill
- Query `v2_books` where `cover_final` exists and cover art was made before this deploy.
- Re-run edge verifier on their `cover_url`.
- Books that fail get `cover_stage` reset → regenerated one-at-a-time by the loop (respects One-Book-At-A-Time law, no parallel spend).

### 6. Regression test
- Fixture: the uploaded `Roaring Rainforest` cover — verifier must return `white_border_detected`.
- Fixture: a known full-bleed cover — verifier must pass.
- Added to CI-equivalent test script under `_shared/coloring/__tests__/`.

## Guardrails
- Does not lower any QC gate; adds one.
- No threshold edits, no manual score patching.
- Uses existing 3-strike + provider rotation; no new spend paths.
- Follows `cover_illustrated_only_v12` + `cover_full_bleed_edge_verifier_v15` doctrine (this is v16 extending it).

## Done means
- Verifier fails the uploaded reference.
- Three consecutive fresh covers pass edge-bleed with zero manual intervention.
- Backfill sweep completes; no LIVE book has a detectable white/cream border.
