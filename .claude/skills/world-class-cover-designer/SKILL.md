---
name: world-class-cover-designer
description: Permanent standards for generating world-class, human-level ebook covers in this project. Triggers whenever cover generation, cover QC, cover redesign, thumbnail rendering, or cover prompt tuning is discussed. Enforces strategy-first design, psychology-driven composition, AI-produces-textless-background-only, app-overlaid typography, and hard-rejection of AI-looking / generic / cluttered / unreadable covers.
---

# World-Class Human-Level Ebook Cover Designer

This skill is the permanent creative director for every ebook cover produced by the pipeline. It applies to `supabase/functions/generate-cover/`, `supabase/functions/_shared/cover.ts`, the thumbnail step, and any UI that previews, approves, or regenerates covers.

## Non-negotiable rules

1. **Strategy before pixels.** Never call the image model until a `CoverSpec` exists with: buyer avatar, top pain, promised transformation, psychological lever (Control Restoration, Pain Relief, Identity Upgrade, Status, Certainty, Belonging), visual metaphor, mood, palette, and layout treatment.
2. **AI generates a TEXTLESS visual background only.** Image prompts must explicitly forbid: any letters, numbers, words, logos, watermarks, captions, UI, book mockups, or typography of any kind. If the returned image contains readable glyphs, it fails QC and is regenerated.
3. **Typography is rendered by the app**, never by the image model. Title, subtitle, author/brand, and badges are composed in HTML/SVG/Canvas over the AI background using the controlled type system (see "Typography system" below).
4. **Human-designed feel.** Reject the AI aesthetic: no purple→indigo gradients on white, no generic "floating 3D object on gradient", no default Inter/Poppins, no symmetrical dead-center everything, no over-rendered glossy plastic, no fake bokeh, no stock-photo faces, no six-finger hands, no melted text-like shapes.
5. **Thumbnail-first.** The cover must read at 160px wide. Title legible, hierarchy obvious, focal point punchy. If it dies at thumbnail size, it fails — regardless of how it looks at full size.
6. **Premium, not busy.** Max 1 hero visual + 1 supporting motif. Generous negative space. One accent color max. No collage, no more than 2 type sizes on the cover face.

## Psychological levers (pick exactly one primary)

| Lever | Use when the pain is… | Visual language |
|---|---|---|
| Control Restoration | chaos, overwhelm, debt spiral | grids, architecture, calm geometry, single anchor object |
| Pain Relief | acute suffering, stuck | horizon opening, light breaking, exit door, threshold |
| Identity Upgrade | "I want to become X" | archetypal object of the desired identity, monogram, crest |
| Status / Authority | credibility, business, money | monochrome + one metallic accent, sharp serif, embossed feel |
| Certainty / System | "just tell me what to do" | blueprint, schematic, numbered path, protocol diagram |
| Belonging | loneliness, community pains | warm palette, human-scale object, hand-crafted texture |

The chosen lever drives palette, metaphor, and layout — it is not decorative metadata.

## Typography system (app-side overlay)

- **Serif display** for authority/status/finance/identity → e.g. Fraunces, Canela, GT Super.
- **Geometric sans display** for systems/productivity/tech → e.g. Söhne, Neue Haas Grotesk, GT America.
- **Never** default Inter/Poppins/Montserrat on the cover face.
- Title: 1 weight, 1 size, tight tracking (-2 to -3%), max 2 lines, optical kerning.
- Subtitle: ≤ 8 words, 25–35% of title size, different weight or all-caps micro.
- Brand/author lockup: bottom, small, quiet.
- Contrast: WCAG AA against the exact pixels behind each glyph (sample the background, don't assume).

## Image prompt contract (textless background)

Every prompt sent to the image model MUST include, verbatim in spirit:

> "Editorial book cover background artwork. **Absolutely no text, no letters, no numbers, no words, no logos, no captions, no typography, no book mockup, no UI.** Single strong focal composition with intentional negative space in the [top third / left / center] for typography to be added later. Human-designed art-direction, magazine-quality, printed-book feel. Avoid AI clichés: no purple-indigo gradients, no glossy 3D blobs, no generic hero-on-gradient, no stock face, no melted shapes."

Then append the strategy: lever, metaphor, palette (named + hex), mood, medium (e.g. "matte gouache", "risograph", "architectural render", "studio-lit still life"), and the reserved title zone.

## QC gates (12 dimensions, all scored 0–100)

1. Title readability at 160px thumbnail — **hard gate ≥ 90**
2. Anti-AI-look (no gradients-on-white / generic 3D / melted glyphs) — **hard gate ≥ 90**
3. Textlessness of the AI layer (zero glyphs detected) — **hard gate = 100**
4. Psychological lever match to spec
5. Buyer pain resonance
6. Visual metaphor clarity
7. Composition + negative space
8. Color discipline (≤ 3 hues + 1 accent)
9. Typographic hierarchy
10. Contrast / accessibility
11. Category fit vs Shopify shelf competitors
12. Sellability / click-through appeal

Overall pass = every hard gate met AND average ≥ 90.

## Auto-fix loop

Max 3 attempts. Each retry must feed *specific* failure reasons back into the strategy or prompt — never just "try again":

- `text_detected_on_ai_layer` → strengthen the no-typography clause, change medium.
- `looks_ai_generated` → switch medium (e.g. gradient render → gouache/riso/photographic still life), break symmetry.
- `thumbnail_unreadable` → increase title size, simplify background in the title zone, raise contrast.
- `cluttered` → drop supporting motif, expand negative space.
- `weak_metaphor` → re-derive metaphor from the psychological lever, not from the title words.
- `generic_palette` → replace with a category-defensible palette tied to the lever.

After 3 failed attempts, mark the run `needs_admin_attention` with `blocker_reason = cover_qc_unrecoverable` and surface the last 3 attempts + scores in the admin UI. Do NOT ship a failing cover.

## Thumbnail step

Always render a dedicated 800px-wide PNG from the final composed cover (background + overlaid typography), sharpened for Shopify. The thumbnail is re-scored on gates 1, 2, 9, 10 before upload.

## Hard bans

- No stock-photo humans, no AI-generated faces, no hands.
- No emoji, no arrows drawn by the AI, no fake award badges.
- No "As seen on…" strips, no fake 5-star rows on the cover face.
- No text baked into the AI image, ever — even if it "looks nice".
- No purple/indigo gradient on white unless the user explicitly requests it.
