# Cover Builder V2 — Permanent Premium Typography Baked into Cover Master

Goal: every coloring cover passes on first attempt with a commercially premium, deterministically-rendered title permanently flattened into the cover image. No frontend text overlays. No AI-baked glyphs. Same flattened master used everywhere (PDF, thumbnail, storefront, download).

## Non-negotiables (enforced by code, not policy)

- Illustration model (Gemini/GPT) generates a **textless illustration with an intentional title environment** (ribbon, sky panel, magic smoke, shield, etc.) — never final glyphs.
- Title glyphs are rendered server-side from canonical `ebooks_kids.title` via SVG → Sharp/Skia rasterization using licensed display fonts.
- Typography is composited and flattened into a single `final_composite.png`. That exact PNG is the cover, the PDF page 1, the thumbnail source, and the storefront image.
- Product page, cards, PDF, and downloads render `<img src=cover_url>` only — no HTML/CSS/React text layer over covers anywhere.

## Architecture — three-layer contract

Persist all three assets per book in `ebook-covers/kids/<book>/v<n>/`:

1. `illustration_layer.png` — textless art with designed title environment.
2. `typography_layer.png` — transparent PNG of deterministic artistic glyphs.
3. `final_composite.png` — flattened master. This is the only URL exposed as `cover_url` / `thumbnail_url`.

`metadata.coloring_cover` records the layer paths, the Typography Art Direction JSON, font hashes, canonical token list, and every gate result.

## Pipeline stages (new `coloring-v2-cover` flow)

```text
1. Metadata lock       → canonical { cover_title, cover_subtitle, age_badge, author_name|null }
2. Art Direction       → Gemini 2.5 Pro proposes { style_family, layout_family, line_breaks,
                          hero_words, palette, decoration, title_env } — JSON only, no glyphs
3. Illustration        → Ideogram/Gemini/GPT renders TEXTLESS art with the designed title
                          environment at 1600×1600 (square 8.5). Prompt bans all glyphs.
                          If any text detected by OCR → inpaint-mask + regenerate title zone
                          (do not throw away good art).
4. Typography render   → deterministic SVG built from canonical tokens + Art Direction recipe,
                          rasterized via Sharp. Pre-raster assertion: every <text> node value
                          ∈ approved tokens; font loaded; fits safe area.
5. Composite + flatten → typography_layer over illustration_layer with foreground occlusion
                          mask (chosen decorative elements sit in front of selected letters),
                          scene-matched shadow/lighting, then flatten to final_composite.png.
6. Gates (all independent, all must pass) →
     illustration_quality_pass, typography_visual_quality_pass,
     canonical_text_source_pass, ocr_visual_pass,
     thumbnail_readability_pass (240px render), safe_margin_pass,
     random_text_count == 0
7. Publish             → write cover_url = final_composite signed URL to ebooks_kids;
                          PDF builder re-uses the same bytes for page 1.
```

Failure at any gate → targeted repair (only the failing layer), max 3 attempts, then park with `blocker_reason` and surface in Admin Dashboard incident banner. No silent bypass.

## Typography system

New module `supabase/functions/_shared/coloring/typography-art-director.ts`:

- 12 style families: magical_storybook, bold_cartoon_adventure, space_sci, fantasy_dragon, futuristic_neon, cute_preschool, nature_woodland, retro_comic, elegant_illustrated_serif, hand_drawn_playful, epic_cinematic, japanese_graphic. Each defines font stack, weight, gradient recipe, outline stack (2–3 strokes), shadow, texture clip, decoration set, allowed layouts, age range, max title length.
- 10 layout families (top-hero, center-integrated, character-overlap, hero-word+subtitle, stacked-frame, curved-above, badge, split-around-hero, cinematic-bottom, full-height).
- Selector picks family + layout from title length, category, age, hero position, background complexity, and a **recency-avoidance window** (last 15 covers) to guarantee catalog diversity.

New renderer `supabase/functions/_shared/coloring/typography-renderer.ts`:

- Builds SVG with `<defs>` for gradients, filters (shadow/glow), clip-paths for texture-inside-glyph, per-letter `<tspan rotate>`, curved baselines via `<textPath>`, multi-stroke via layered `<text>` copies, warp via SVG filter or path-warp.
- Fonts loaded from `brand-assets/fonts/*` (bundle licensed display faces; ship SIL/OFL-safe defaults immediately, upgrade set later).
- Rasterizes via Sharp; transparent PNG matched to illustration canvas.
- Pre-raster assertion module `typography-source-verifier.ts` blocks the raster if any text node string is not in the canonical token set or order.

## Foreground occlusion + scene integration

`composite-with-occlusion.ts`:

- Art Direction includes an optional `foreground_occlusion_mask` recipe (e.g. "unicorn wings overlap top 20% of letters 3–5", "sparkle cluster in front of 'S'").
- During composition: apply typography, then re-composite chosen foreground crops from illustration on top of specific glyph regions to break the "pasted-on" look.
- Shadow direction sampled from illustration lighting (average luminance gradient) so shadow follows scene.
- Title fill palette derived from illustration palette (k-means on illustration, then map to Art Direction gradient stops).

## Cleanup of existing broken covers

Batch job `kids-cover-cleanup-v2`:

- For books with strong illustration but bad baked text: detect text regions (OCR bbox), build masks, inpaint via Gemini/GPT image-edit, then run steps 4–7 above. Preserve art.
- Starlight Unicorns + Cobblestone Creatures are the two mandatory fixtures. Both must pass before V2 flips on globally.

## Verification & rollout

- Vitest fixtures: canonical-token-only SVG, occlusion mask honoured, family/layout recency avoidance, thumbnail 240px readability check, gate composition truth table.
- Blind visual QC harness: render 10 fresh books through V2, compare against 10 catalog benchmarks; V2 must meet or beat median across 8 criteria (commercial appeal, art+title integration, typography personality, category fit, hierarchy, thumbnail readability, premium feel, diversity).
- Flip global switch only after: 2 fixture books pass + 3 consecutive fresh books pass + release-manifest validator passes.
- Admin Dashboard adds a "Cover Builder V2" panel showing per-book layer previews, gate scorecard, and repair history.

## Frontend contract (unchanged behaviour, hardened)

- `ProductCard`, `KidsBookCard`, `ColoringProduct`, `FlipbookPreview`, PDF page 1, social preview, admin preview, marketing exports: all read `cover_url` as a single flattened image. No text overlays.
- Add a lint/test guard `covers-no-overlay.test.tsx` that fails CI if any component renders text absolutely-positioned over a `cover_url` image.

## Files to add / modify

New:
- `supabase/functions/_shared/coloring/typography-art-director.ts`
- `supabase/functions/_shared/coloring/typography-renderer.ts`
- `supabase/functions/_shared/coloring/typography-source-verifier.ts`
- `supabase/functions/_shared/coloring/composite-with-occlusion.ts`
- `supabase/functions/_shared/coloring/style-families.ts`
- `supabase/functions/_shared/coloring/layout-families.ts`
- `supabase/functions/_shared/coloring/palette-extractor.ts`
- `supabase/functions/kids-cover-cleanup-v2/index.ts`
- Font assets under `brand-assets/fonts/`
- Tests: `coloring-cover-v2-source-of-truth.test.ts`, `coloring-cover-v2-thumbnail.test.ts`, `coloring-cover-v2-recency.test.ts`, `covers-no-overlay.test.tsx`, `cover-cleanup-inpaint.test.ts`

Modify:
- `supabase/functions/coloring-v2-cover/index.ts` — swap to 3-layer flow; remove any code path that lets the illustration model produce final glyphs; keep Gemini/GPT for art + Art Direction only; enforce 3-strike stop + dashboard alert.
- `supabase/functions/_shared/coloring/coloring-cover-compositor.ts` — flatten via new composite module.
- `supabase/functions/_shared/coloring/publish-contract.ts` — require all 7 independent gates + `random_text_count == 0`.
- `supabase/functions/kids-build-picture-pdf/*` — page 1 reads `final_composite.png` bytes directly.
- `src/components/kids/KidsBookCard.tsx`, `src/components/product/*` — assert no text overlay over cover image.
- Admin: `src/components/admin/ColoringV2AutopilotCard.tsx` + new `CoverBuilderV2Panel.tsx`.

## Acceptance

1. Disable CSS/JS, open `final_composite.png` directly → title fully present, correctly spelled, artistically integrated.
2. Starlight Unicorns + Cobblestone Creatures fixtures pass with premium typography and preserved art.
3. Three consecutive fresh books pass all 7 gates on first attempt.
4. Blind visual review: V2 ≥ catalog median across all 8 criteria.
5. Release-manifest validator passes.
