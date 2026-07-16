
# Cover Typography Beauty Upgrade — `coloring_cover_verified_typography_v2`

Supersedes `coloring_cover_textless_forever`. New law: **no UNVERIFIED AI text** (verified integrated lettering is preferred; unverified is forbidden).

## Tier ladder (coloring covers)

```text
Tier 1  Ideogram V3 integrated cover (fal.ai/ideogram/v3)
        → gemini vision transcription must equal {title, subtitle, age badge} exactly
        → up to 3 attempts (balanced speed)
        → on accept: SKIP overlay typography entirely (single-source rule)

Tier 2  Flux textless art + PREMIUM curved overlay
        → puffy hand-lettered display font, thick dark outline, warm palette fill
        → arched title baseline, category-palette colors, soft drop shadow
        → title placed in calm sky/art region OR on subtle rounded banner
        → NO flat straight-line default font

Tier 3  Self-art colorized cover (unchanged insurance)
        → cover_upgrade_pending flag so sweeper retries Tier 1 later
```

## Files to change

- **Create** `supabase/functions/_shared/coloring/ideogram-integrated-cover.ts`
  - fal.ai `fal-ai/ideogram/v3` call (uses existing `FAL_KEY`)
  - prompt: full-color kids scene + baked-in title/subtitle/age badge, style hint = "arched playful hand-lettering, integrated into composition"
  - returns raw PNG bytes + prompt used
- **Create** `supabase/functions/_shared/coloring/cover-text-transcription.ts`
  - Gemini 2.5 Flash vision transcription (via Lovable AI Gateway)
  - Normalize (lowercase, strip punctuation, collapse whitespace)
  - `verifyExactMatch(imageBytes, {title, subtitle, ageBadge})` → `{pass, transcribedTokens, missing, extra}`
  - Any extra/missing/misspelled word ⇒ discard
- **Rewrite** `supabase/functions/_shared/covers/kids-title-treatment.ts` (Tier 2 overlay)
  - New `renderPremiumCurvedTitleTreatment({ transparentBackground:true })`
  - Puffy display font (bundled TTF: Fredoka One / Bungee equivalent already in repo assets, else load via `Deno.readFile` from `_shared/fonts/`)
  - Arched baseline via per-glyph rotate/translate around a chord
  - 8px dark stroke + warm gradient fill + 12px soft drop shadow
  - Palette from `coloring-palettes.ts` category tint
  - Optional rounded-banner backing when sky region variance is low
- **Edit** `supabase/functions/coloring-book-cover/index.ts`
  - New state machine: `tier1_ideogram (×3) → tier2_flux+premium → tier3_selfart`
  - Tier 1 accepted ⇒ store as final cover directly; DO NOT call compositor overlay
  - Tier 2 ⇒ existing compositor but calls new premium overlay renderer
  - Persist `rendered_proof`, `art_only_url`, `final_composed_url`, `tier`, `transcription_report`
- **Edit** `supabase/functions/_shared/covers/kids-cover-ladder.ts`
  - Wire Ideogram rung ahead of Flux rung for coloring covers
- **Migration** `pipeline_skills`
  - Mark `coloring_cover_textless_forever` superseded (v_current=false, superseded_by)
  - Insert `coloring_cover_verified_typography_v2` (v1) with owner-order body

## Tests (release-blocking)

- `src/lib/coloringCoverVerifiedTypography.test.ts`
  - transcription mismatch fixture ⇒ tier-1 discarded, next attempt tried
  - all-3 mismatches ⇒ falls to tier-2
  - tier-1 accepted ⇒ overlay step NOT invoked (spy assertion)
- `src/lib/coloringCoverPremiumOverlay.test.ts`
  - curved baseline geometry (chord angle per glyph within tolerance)
  - stroke width ≥ 6px, outline darker than fill by ΔL ≥ 40
  - no flat straight-line render (rejects legacy render)
  - snapshot bytes hash stable

## Batch resubmit (after deploy)

Trigger `coloring-book-cover` for:
- Ocean Friends, Sea Animals (both candidates), Fierce Dinosaurs, Cute Dinosaurs, Princess Fairy, Farm & Woodland

Report per book: `tier`, `art_only_url`, `final_composed_url`, `transcription_report`.

## Assumptions (correct me if wrong)

1. **Ideogram provider = fal.ai** (`fal-ai/ideogram/v3`) using existing `FAL_KEY` — no new secret needed. If you want direct Ideogram API instead, I need `IDEOGRAM_API_KEY`.
2. **Vision transcription = Gemini 2.5 Flash** via Lovable AI Gateway (`LOVABLE_API_KEY` already set).
3. **Age badge string** = the same "Ages 4-6" style already stored in `storefront_meta`.
4. **Overlay font** — I'll bundle a free puffy display TTF (Fredoka One, OFL) under `supabase/functions/_shared/fonts/` if none already present.

Confirm the four assumptions (or override) and I'll build + deploy + run the batch.
