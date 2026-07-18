# Known SecretPDF Regression Classes

Use this list to recognize recurring defect classes quickly.

## Blank or title-only cover

Symptoms:

- title visible on empty background
- no canonical protagonist
- cover generator failed but PDF continued

Class: `asset_validation_bug` or `cover_gate_bug`.

## Duplicate page blocks

Symptoms:

- groups of pages repeat after retry
- page count exceeds product metadata
- same image and text hashes appear twice

Class: `idempotency_bug` or `chunk_merge_bug`.

## Character and style drift

Symptoms:

- face, proportions, clothes, props, or species change
- cover is hand-drawn while interior is 3D or painterly

Class: reference propagation or visual contract failure.

## Random AI text and watermark

Symptoms:

- gibberish inside illustrations
- artist signature, domain, label, or malformed speech bubble

Class: image-generation contract and artifact-gate failure.

## QC gate `n/a` after repair

Symptoms:

- producer reports success
- database has data in one field
- gate reads another field
- automatic repair repeats

Class: `persistence_contract_bug` or `gate_mapping_mismatch`.

## Valid PDF receives score zero

Symptoms:

- manually downloaded PDF opens
- QC reads stale URL, expired token, HTML error page, or old asset version

Class: `asset_identity_bug`. Technical failure must have score `null`.

## Internal copy on public sales page

Symptoms:

- Story rule, callbacks, buyer hook, HTML comments, or debug metadata are visible

Class: `public_copy_leak`.

## Phase 1 blocked by later phases

Symptoms:

- final PDF exists but run waits for Shopify, SEO, pricing, or publish

Class: feature-flag or state-machine scope bug.

## Cover baked-title clipped by aspect-mismatched container

Symptoms:

- storefront card, product hero, or PDF cover page shows the cover with
  the baked title's first/last letters chopped off, or edge characters/art
  cut at the top or right
- the raw asset in storage looks correct when opened directly
- only appears once the asset is placed inside a UI or PDF frame

Fingerprint:

- coloring covers ship native at 1600×2071 (8.5:11, w/h ≈ 0.7726)
- adult picture-book covers ship native at 1024×1280 (4:5, w/h = 0.8)
- container uses `aspect-square`, `aspect-[3/4]`, or any ratio ≠ native,
  with `object-cover` (or a PDF `Math.max` fit-COVER) → hard crop of the
  baked title

Class: `asset_identity_bug` (display / embed container).

Fix: every consumer of `cover_url` MUST match the native asset ratio
exactly. Either set the container to `aspect-[1600/2071]` (coloring) /
`aspect-[1024/1280]` (picture book), or letterbox with `object-contain`
— NEVER `object-cover` a baked-title cover into a mismatched frame. In
the PDF, keep the trim at 8.5×11 so `Math.max` fit-COVER is a no-op.

Regression test: `src/lib/coloringCoverAspectGate.test.ts`.
Runtime gate: `supabase/functions/_shared/coloring/cover-aspect-gate.ts`
enforced from `coloring-book-assemble` before PDF embed.

## coloring-cover: baked-title-only + trim-lock + distinct-thumbnail (v1)

**Contract:** `pipeline_skills['coloring-cover-thumbnail-contract-v1']`
**Enforced by:** `_shared/coloring/publish-contract.ts`, `kids-publish-if-qc-passed`,
`coloring-book-cover`, `coloring-book-thumbnail`, `coloring-book-assemble`.

Rules (all three are pre-publish HARD gates, no waiver):

1. `cover_baked_title_only` — cover.title_treatment.typography_source MUST
   equal `ideogram_verified_integrated`. Any `textless_art_plus_svg_overlay`
   or `*_svg_overlay` typography source is REJECTED (owner rule: no flat
   text stamped on baked art). Tier-2 (flux + overlay) and Rung-2
   (self-art + overlay) branches were removed from
   `coloring-book-cover/index.ts`. If Ideogram all attempts fail, park in
   `awaiting_cover_retry` — never fall back to overlay.
2. `trim_verified` — cover raster 1600×2071 px, interior raster 1600×2071 px,
   thumbnail 600×776 px, PDF page 612×792 pt. See
   `_shared/coloring/trim-lock.ts` (`assertColoringTrim`).
3. `thumbnail_distinct_and_fitted` — `thumbnail_url` MUST be a different
   asset from `cover_url`, produced by `coloring-book-thumbnail` on a
   600×776 white canvas with fit-contain letterbox and
   `thumbnail_render_meta.non_crop_pass = true`.

Symptom that triggered the fix: 9 of 13 live coloring books had
`typography_source: textless_art_plus_svg_overlay` (flat SVG title layer on
top of the illustration), and every live book had `thumbnail_url === cover_url`.
Storefront relied on frontend CSS to make the raw 1600×2071 cover look right
in a small card — fragile.

## cover-crop-v3 (2026-07-17)
- Symptom: baked title clipped on KidsCheckout order-summary thumbnail and
  on PDF page 1 (e.g. "Cute Farm" and "Ages 4-6" badge cut on right edge).
- Root cause A (UI): `KidsCheckout` used `aspect-square` + `object-cover`
  for coloring covers whose native ratio is 8.5:11.
- Root cause B (PDF): assembler used `Math.max` (fit-COVER) which
  mathematically overflows whenever raster ratio ≠ page ratio bit-exact.
- Fix: `object-contain` on `aspect-[1600/2071]` for coloring in UI; new
  shared `fitContainCover()` helper (`Math.min`) in the assembler.
- Regression test: `src/lib/coloringCoverPdfPlacement.test.ts`.

## chimera-anatomy-v1 (2026-07-17)
- Symptom: coloring pages sometimes rendered animals with extra legs,
  fused hips, duplicated heads, or merged-species features (e.g. dog with
  5 legs, elephant with 2 trunks) — a.k.a. "chimera defect".
- Root cause: `species_anatomy` (both DB table and the TypeScript
  `SPECIES_ANATOMY` in `_shared/coloring/species-anatomy.ts`) covered
  only marine species. Every land/farm/pet/safari/dino subject fell
  through to the generic anatomy pass with no leg-count contract, so
  neither the interior prompt nor the anatomy verifier had a hard rule
  to enforce.
- Fix: (1) added explicit species rows for dog/cat/rabbit/bear/fox/
  squirrel/deer/raccoon/hedgehog/owl/cow/pig/sheep/goat/chicken/duck/
  horse/donkey/elephant/lion/tiger/giraffe/zebra/monkey plus
  dinosaur/t-rex/triceratops/brachiosaurus/stegosaurus, every
  quadruped explicitly stating "EXACTLY FOUR legs, no fusion, no
  duplication". Fantasy creatures (unicorn, dragon, mermaid, etc.)
  already existed with fantasy=true and are NOT rejected — malformed
  variants of them still hard-fail on the same leg-count/head-count
  contract. (2) Added `assertSpeciesCoverage()` + `NON_ANATOMY_SUBJECT_HINTS`
  and wired into `validatePagePlan` as new `SPECIES_CONTRACT_MISSING`
  issue so any category whose concept generator emits a creature-like
  subject without a matching contract is blocked before render.
- Note: `buildInteriorPrompt` and `coloring-book-render` repair path
  already injected the contract via `speciesAnatomyPromptClause` /
  `speciesAnatomyRepairClause` — the gap was contract data, not wiring.

## kids-character-reference-runware-primary (2026-07-18)
- Symptom: 62 kids picture books auto-retired at `generate_cover` with
  `character_reference_generation_failed_after_dead_image_gate: provider_billing_locked (403) fal.ai`.
  Single largest failure class in the last week (25% of all failures,
  2x the next class).
- Root cause: provider monoculture. The character-reference sheet in
  `autopilot-kids-pipeline` called `falFluxSchnell` directly, bypassing
  the shared `generateImageWithFailover` chain used elsewhere. When the
  fal.ai balance dried the whole class dead-ended even though Runware +
  Cloudflare were healthy and already funding coloring covers/interiors.
- Fix: rewired the sheet step to `generateImageWithFailover` with
  `readImageProviderPolicy(db).interiors` — Runware FLUX schnell (AIR
  `runware:100@1`) primary, Cloudflare `@cf/flux-1-schnell` fallback,
  fal `fal-ai/flux/schnell` last. Same 3-attempt dead-image gate is
  preserved. Same model family (FLUX schnell) across all three
  providers so style/luminance behavior is unchanged. Downstream page
  rendering keeps using Gemini reference-conditioning against the
  produced sheet URL, so character consistency across pages is
  unaffected by which t2i provider produced the sheet.
- Doctrine: any image-generation step that can dead-end a book MUST
  call `generateImageWithFailover`, not a single-provider adapter.
  A grep for `falFluxSchnell(` / `falRecraftV3(` / direct
  `runwareInference(` calls in book-critical paths is a defect signal.
