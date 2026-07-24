## Goal
Permanently prevent coloring-book covers from shipping with white / colored borders, frames, or padded margins. The generated art must fill the full canvas edge-to-edge, and the storefront thumbnail must show the artwork filling the tile.

## Root cause (verified)
- `KidsBookCard` and `ColoringProduct` gallery already use `object-cover` — the frontend is not adding borders.
- The prompt in `coloring-v2-illustrated-cover-once/index.ts` (line 172) already says FULL-BLEED, but Gemini / GPT-image still occasionally bake a white margin, inner frame, or vignette-to-white edge. There is **no post-generation verifier**, so any bordered result is accepted and shipped.

## Permanent fix — `cover_full_bleed_edge_verifier_v15`

### 1. Edge-pixel verifier (new)
Add `supabase/functions/_shared/coloring-v2/full-bleed-verify.ts`:
- Decode PNG bytes (reuse existing PNG decoder from de-fill post-processor).
- Sample the outer 2% ring on all four edges (top / bottom / left / right rows and columns).
- Compute, per edge:
  - `whiteRatio` = fraction of pixels with R,G,B ≥ 245 and low saturation.
  - `uniformRatio` = fraction of pixels within ΔE ≤ 4 of that edge's mean (detects any solid-color frame, not just white).
- **Verdict = fail** if any edge has `whiteRatio ≥ 0.40` OR `uniformRatio ≥ 0.85` (indicating a baked border/frame).
- Return `{ pass, worstEdge, whiteRatio, uniformRatio }`.

### 2. Verifier loop in `coloring-v2-illustrated-cover-once`
Wrap the existing Gemini → Gateway → OpenAI ladder in a retry loop (max 3 attempts total across providers):
- After each provider returns bytes, run `verifyFullBleed(bytes)`.
- On fail, discard bytes, strengthen the negative clause (append the specific offender, e.g. `"the previous attempt had a white margin along the ${worstEdge} edge — this attempt MUST paint that edge completely"`), and retry the next provider in the ladder.
- If all 3 attempts fail, auto-crop the detected border (trim rows/columns whose `uniformRatio` exceeds threshold) and rescale back to 1024×1024 via a canvas resize, then upload with `meta.full_bleed_autocropped = true` so we can audit later.
- Never ship a cover that fails verification without at least the autocrop rescue.

### 3. Prompt tightening
Reword line 172 clause to lead with the failure examples the models keep producing:
- "The painted illustration must bleed off all four edges — literally paint past the canvas edge. A one-pixel-wide strip along every edge must be full-saturation illustration, not white paper, not a colored bar, not a decorative frame."
- Add explicit ban: `"NO white 'polaroid' border, NO colored ribbon frame, NO inner rectangle, NO passe-partout, NO drop-shadow around the artwork suggesting it's a card on a background."`

### 4. Asset metadata + storefront refresh
- Store verifier scores in `coloring_v2_assets.meta.full_bleed = { whiteRatio, uniformRatio, verdict, attempts }` for the future QC audit.
- Bump the law tag from `cover_layout_diversity_v14` → `cover_full_bleed_edge_verifier_v15`.

### 5. Regenerate current offending book(s)
- Identify the book the user is currently viewing (latest published; likely the one on their preview screen). Query `coloring_v2_books` + `ebooks_kids` for the most recent live cover and re-run `coloring-v2-illustrated-cover-once` under the new verifier so the storefront thumbnail refreshes.
- Optionally sweep the last ~10 live books: for each, download the current `cover_url`, run only the verifier (no regen) — regenerate only the ones that fail. Cheap way to clean the shelf without burning credits on already-good covers.

### 6. Regression test
Add `src/__tests__/coloring-cover-full-bleed-verifier-v15.test.ts`:
- Synthetic PNG with a 40-px white border → verifier must fail.
- Synthetic PNG with a solid-color 30-px frame → verifier must fail.
- Synthetic full-bleed noise PNG → verifier must pass.
- Ensures the class stays fixed permanently.

## Files touched
- **new** `supabase/functions/_shared/coloring-v2/full-bleed-verify.ts`
- **edit** `supabase/functions/coloring-v2-illustrated-cover-once/index.ts` (retry loop, prompt tightening, meta, autocrop rescue)
- **new** `src/__tests__/coloring-cover-full-bleed-verifier-v15.test.ts`

## Out of scope
- No changes to interior renderer, PDF assembler, or thumbnail component (already `object-cover`).
- No change to the anatomy / spelling / lettering laws.

## Open question
Do you want me to also **sweep the last N live covers** (option in step 5) and auto-regenerate any that fail the new verifier, or only apply the fix going forward + regenerate the one book you're looking at now?