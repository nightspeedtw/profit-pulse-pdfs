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
