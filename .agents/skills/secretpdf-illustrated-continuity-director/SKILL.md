---
name: secretpdf-illustrated-continuity-director
description: Use for SecretPDF illustrated / children's picture books to enforce end-to-end visual continuity — Story Bible → Character Bible → Character Reference Sheet → Style Bible → Cover → Interior spreads → Thumbnail, all referencing the same immutable reference version. Owns per-page structured scene contracts, character-lock schema (face geometry, species, proportions, colors, eyes, clothes, accessories, props, palette, line weight, shading, rendering style, world, emotional register, relative scale), and rejection rules when an image drifts (regenerate the image — NEVER adapt the Character Bible to fit a drifted image). Does NOT own watermark / random-text / embedded-text checks (see image-artifact-guard).
---

# SecretPDF Illustrated Continuity Director

One character. One style. One world. Every image traces back to the same
immutable reference version.

## Chain (immutable order)
```
Story Bible → Character Bible → Character Reference Sheet
     → Style Bible → Cover → Interior spreads → Thumbnail
```

Every downstream asset carries the exact `reference_asset_id` +
`style_version` it was rendered against. QC re-reads those IDs.

## Character Lock (schema)
```json
{
  "character_id": "chef-pip",
  "canonical": {
    "species": "brown bear cub",
    "age_feel": "young child (approx 4-6)",
    "body_shape": "short rounded childlike proportions, fixed head-to-body 1:2.2",
    "face_geometry": "round face, wide-set large eyes, soft small muzzle",
    "fur_color": "warm medium chestnut #8b5a3c",
    "muzzle": "light caramel oval",
    "eyes": "large rounded dark-brown irises, two catchlights",
    "nose": "small glossy black triangle",
    "cheeks": "subtle warm pink blush",
    "hat": "white oversized toque with two thin red horizontal stripes",
    "coat": "white double-breasted chef coat, fixed gold-brown buttons in two vertical rows of four",
    "neckwear": "solid red neckerchief, single simple knot at throat",
    "prop": "small bright-red wooden spoon, always the same shape"
  },
  "must_not_change": [
    "face geometry","fur color","eye style","muzzle shape","hat design",
    "neckwear pattern","coat structure","body proportions","spoon color","spoon shape"
  ],
  "reference_asset_ids": ["ref-front", "ref-three-quarter", "ref-side", "ref-expressions"],
  "style_version": "chef-pip@v1"
}
```

## Per-page scene contract (required for every interior page)
```json
{
  "page_number": 15,
  "characters_required": ["chef-pip"],
  "props_required": ["red wooden spoon", "the Best Batter Beater whisk"],
  "action_required": "chef-pip is reaching up and grasping the whisk from a shelf, spoon tucked under one arm",
  "emotion_required": "eager, focused",
  "setting_required": "warm kitchen, morning light through the window, batter bowls on the counter",
  "forbidden_objects": ["extra bears","different chef","real photograph","adult human"],
  "reference_asset_ids": ["ref-front"],
  "style_version": "chef-pip@v1"
}
```

The illustration prompt is derived from this contract — never freeform.

## Hard rules
- **Never adapt the Character Bible to fit a drifted image.** If the image
  disagrees with the Bible, regenerate the image with a stronger reference
  lock. The Bible is truth.
- Cover uses the same character reference + style version as interiors.
  Cover-only regenerations must re-run interior consistency QC against the
  new cover hash.
- Prop continuity is part of character lock. If the story requires a prop
  change, that is a new scene contract entry, not a Bible edit.
- QC thresholds (all 0-100, all ≥ 95):
  character identity, cover-interior match, style consistency,
  prop continuity, text-image match, page continuity.

## Repair loop
1. Vision QC returns per-page verdicts against the Bible.
2. Failing pages queue for regeneration with the same reference IDs +
   stronger negative prompts (see image-artifact-guard).
3. Max 2 regeneration attempts per page. Third failure → `needs_code_fix`
   or `content_quality_failure` per orchestrator taxonomy — do not lower
   the threshold.
