---
name: Kids cover prompt template (custom illustrated logo, Peppa-Pig tier)
description: Reusable prompt formula for children's picture book covers where the title is a fully custom hand-drawn illustrated LOGO designed for that specific book — never a font, never flat text overlay
type: design
---

**Core rule:** Every kids picture book cover must ship with a **custom illustrated title logo** designed specifically for that book (Peppa Pig / Bluey / Paddington / Gruffalo tier). Never use an existing font — not even hand-drawn fonts. The lettering IS artwork, painted in the same medium as the illustration.

## Preferred workflow — TWO PASS (mandatory)

Do NOT try to generate the illustration + logo title in one shot. It always crowds the art or degrades the title. Split:

**Pass 1 — Base illustration only** (`imagegen--generate_image`, premium, 1024×1280)
- Soft watercolor + gouache storybook style, atmospheric, cozy, painterly
- Full character + setting + palette + lighting locked
- Reserve a clear negative-space zone (usually upper third) for the title
- Prompt MUST say: "no text, no letters, no title, no typography — leave clean space for hand-painted title to be added later"

**Pass 2 — Overlay custom illustrated title logo** (`imagegen--edit_image` on the Pass 1 file)
- Prompt opens with: "Keep the entire illustration EXACTLY as it is — same character, pose, background, palette, lighting, composition. Do NOT redraw the scene."
- Then describe ONLY the title logo (letter-by-letter decoration, emotion-word distortion, paint medium matches illustration)
- Add subtitle in small matching handcrafted script

This preserves the v2-quality atmospheric illustration while getting v3-quality logo typography. Never sacrifice illustration atmosphere for busier title decoration — the base must stay clean.

## Storefront / thumbnail rule (mandatory)

For kids picture books, the final hand-painted cover is the storefront image. After shipping the finished cover to `ebooks.cover_url`, also set `ebooks.store_thumbnail_url` and `ebooks.thumbnail_url` to that exact same cover URL. Do not generate, upload, or accept a generic 3D book mockup/template thumbnail for children’s covers — especially the yellow book mockup with stars and an “ILLUSTRATED STORY” badge. It makes the product look like a template and hides the custom illustration/logo work.


## Three-layer prompt structure

### Layer A — Illustration base
- Warm storybook style, soft gouache + watercolor texture, painterly
- Disney/Scholastic publishing quality, cozy magical atmosphere
- Soft pastel palette, gentle lighting, warm shadows
- Main character = clear hero: joyful expression, dynamic pose, memorable silhouette
- Background: whimsical but clean — plants, flowers, soft sunbeams, dreamy setting; character stays focal point

### Layer B — Custom illustrated title (MOST IMPORTANT)
- ❌ NO existing fonts, NO digital typography, NO flat text overlay, NO hand-drawn fonts
- ✅ Every letter uniquely hand-drawn, thick / soft / rounded / chunky / child-friendly
- ✅ Painted in the same medium as the illustration, integrated INTO the scene
- ✅ Each letter carries decorative elements tied to the story (see idea bank below)
- ✅ Emotion-driven words distort meaningfully (e.g. "Wobbly" tilts and waves; "Sleepy" droops; "Zoom" streaks; "Splash" drips)
- ✅ Dots on i/j = tiny flowers, berries, stars, bubbles
- ✅ Feels like a logo designed FOR THIS BOOK ONLY
- Subtitle: smaller handcrafted script, same paint medium

### Layer C — Composition & print
- Character centered (lower third for cover pose)
- Large readable title, plenty of breathing room
- Portrait 4:5 (1024×1280), ultra detailed, 8K, CMYK-friendly, print-ready

## Letter decoration idea bank (by setting)
- **Forest** → curling vines, leaves, berries, mushrooms, tiny animals
- **Ocean** → seashells, coral, kelp, bubbles, fish tails
- **Space/night** → stars, moons, constellations, glow, comets
- **Autumn** → maple leaves, acorns, twigs, pumpkins
- **Winter** → snow caps, icicles, pine sprigs, breath puffs
- **Desert** → cactus arms, sand curves, tiny lizards
- **Farm/village** → hay wisps, flower crowns, ribbons, picket-fence serifs
- **Character-specific** → the hero's ears, tail, whiskers, or signature prop woven into letters

## Reusable prompt template

```
Premium children's picture book cover, warm storybook illustration style,
soft gouache watercolor texture, Disney/Scholastic publishing quality.

MAIN CHARACTER: [CHARACTER — species + invariants like clothing, colors,
signature accessory], adorable, expressive, joyful [POSE/EMOTION].

BACKGROUND: [SETTING] with [WHIMSICAL DETAILS], soft pastel palette
([2-4 specific colors]), gentle lighting, cozy magical atmosphere,
clean composition so character remains focal point.

TITLE — CUSTOM ILLUSTRATED LOGO (CRITICAL): The title "[TITLE]" must be a
completely custom hand-drawn illustrated logo — NOT a font, NOT typography,
NOT text overlay. Every letter uniquely designed, thick soft rounded chunky
child-friendly letterforms, painted in [COLOR + OUTLINE]. Letter details:
- [Letter X — specific decorative element]
- [Letter Y — specific decorative element]
- [Emotion word — how it distorts]
- Dots on i/j = [tiny motif]
Lettering feels iconic like Peppa Pig, Bluey, Paddington, The Gruffalo —
a logo designed FOR THIS BOOK ONLY, fully integrated into the artwork.

SUBTITLE: small handcrafted script "[SUBTITLE]" beneath, matching style.

COMPOSITION: character centered lower-third, large readable custom title
upper half, breathing room, professional children's publishing layout,
portrait 4:5. Ultra detailed, 8K, print-ready.

Absolutely no generic fonts, no digital typography, no flat text overlay,
no AI-cliché gradients.
```

## Worked example — Barnaby's Wobbly Problem
- B → wrapped with a curling green vine
- o's → plump red-pink berries with tiny leaves
- y tails → curled green leaves
- "Wobbly" → slightly tilted, wavy baseline (visually wobbling)
- Dots on i's → tiny flowers/berries
- Small mushrooms sprouting from letter corners
- Painted in warm brown + forest green with cream outline

## Quality tier
- Always **premium** (title logo legibility + hand-drawn feel critical)
- 1024×1280 portrait

## QA checklist before shipping
1. Title readable at 160px thumbnail
2. Zero flat-font/digital-typography feel
3. Each letter shows story-linked decoration
4. Character invariants preserved
5. Emotion word visually reflects meaning

## Container aspect-ratio rule (mandatory — regression class)

Every UI container and PDF frame that displays a cover MUST match the
generated asset's native aspect ratio EXACTLY:

- Coloring books: native 1600×2071 → use `aspect-[1600/2071]` (8.5:11).
- Picture books: native 1024×1280 → use `aspect-[1024/1280]` (4:5).

Rules:
- NEVER apply `object-cover` (or PDF `Math.max` fit-COVER) on a baked-
  title cover inside a mismatched frame — it clips the title art.
- If a genuinely different ratio is required (e.g. a square social card),
  derive it as its OWN asset with safe margins reserved at generation
  time. Never crop the primary edge-to-edge cover.
- The publish path enforces this via
  `supabase/functions/_shared/coloring/cover-aspect-gate.ts`; do not
  bypass or loosen its tolerance (±1% w/h).
