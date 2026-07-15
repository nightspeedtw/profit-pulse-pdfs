# Cover and Storefront Thumbnail Art Direction

## Objective

Create a commercially strong cover that matches the book and a separate realistic ecommerce thumbnail derived from the approved cover.

## Separate assets

```text
pdf_cover_url      = flat final cover for the PDF trim size
thumbnail_url      = ecommerce book mockup
product_mockup_url = high-resolution storefront mockup
```

Do not use a flat PDF cover as the storefront thumbnail.

## Cover strategy

Before generation define:

```json
{
  "target_buyer": "",
  "buyer_pain": "",
  "desired_transformation": "",
  "category": "",
  "emotional_tone": "",
  "visual_metaphor": "",
  "hero_visual": "",
  "layout_family": "",
  "palette_family": "",
  "typography_direction": "",
  "reference_asset_ids": []
}
```

For illustrated stories the cover must use the canonical character and style references.

## Typography

- title is the hero
- verify exact spelling
- render title through a controlled layer when possible
- use clear hierarchy and safe margins
- ensure mobile thumbnail readability
- avoid long body copy on the cover

AI artwork must not invent unverified text.

## Trim and cover page

Use the product's actual trim:

- children's picture book: configured square or portrait trim
- workbook: A4 or configured print trim
- standard ebook: configured page size

The cover fills the page with no inherited body margin.

## Ecommerce thumbnail

Use:

- realistic standing or angled book mockup
- visible spine and page block
- clean white or off-white background
- subtle natural shadow
- premium studio lighting
- title readable at product-card size
- no price, button, badge, review, or website UI baked into the image

Frontend renders category and price badges separately.

## Visual diversity

Track:

- visual metaphor family
- hero object
- layout family
- palette family
- typography family
- illustration type

Compare with recent thumbnails. If the combination is too similar, choose a different art direction rather than rerunning the same prompt.

Avoid catalog sameness such as the same staircase, doorway, chart, icon row, dark rectangle, or lower feature strip across unrelated books.

## Category adaptation

- finance: control, safety, payoff, roadmap, planner, shield
- wellness: calm, renewal, rhythm, space, balance
- productivity: focus, time blocks, workflow, signal/noise
- business and AI: systems, leverage, automation, modular structure
- study: planner, memory, exam readiness, study tools
- parenting: routines, home, warmth, guidance
- fitness and meal plans: schedule, meals, habits, progress
- cooking: recipe organization, ingredients, kitchen system
- art and creative: sketchbook, idea board, project momentum
- children's story: protagonist, story world, emotional promise

## Hard gates

```text
cover_not_blank = true
title_spelling_verified = true
cover_character_match >= 95 when illustrated
cover_style_match >= 95 when illustrated
cover_readability >= 90
thumbnail_book_mockup >= 90
thumbnail_readability >= 90
product_realism >= 90
premium_feel >= 90
visual_uniqueness >= 90
random_embedded_text = 0
watermarks = 0
```
