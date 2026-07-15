# Illustrated Book and Character Continuity

## Objective

Make cover, thumbnail, characters, props, environments, line art, coloring, and story events belong to one book and one visual world.

## Immutable reference chain

Persist before page illustration:

1. Story Bible
2. Character Bible
3. Character Reference Sheet
4. Style Bible
5. Prop Bible
6. Location Bible
7. Page Plan

The approved cover master and character sheet are canonical references. Interior generators must receive their asset IDs and versions.

## Character Bible

For each recurring character define:

```json
{
  "character_id": "",
  "name": "",
  "species": "",
  "apparent_age": "",
  "face_geometry": "",
  "body_proportions": "",
  "eyes": "",
  "hair_or_fur": "",
  "skin_or_body_colors": [],
  "outfit": {},
  "signature_props": [],
  "silhouette": "",
  "relative_scale": {},
  "personality": [],
  "expressions": [],
  "forbidden_variations": [],
  "reference_asset_ids": [],
  "version": 1
}
```

Do not mutate the Bible to excuse a failed image. Regenerate the image from the reference.

## Reference sheet

Require:

- front, side, back, and 3/4 views
- full-body proportions
- expression set
- outfit and accessory details
- palette swatches
- size comparison with recurring props and characters
- forbidden variants

Reference QC must pass before cover and interior generation.

## Style Bible

Lock:

- line quality and weight
- brush or pencil style
- coloring method
- texture
- shading
- lighting
- background detail
- perspective
- character proportions
- palette
- paper/background treatment

Do not mix watercolor cover, 3D interior, vector thumbnail, and painterly scenes unless the art direction explicitly defines a coherent hybrid.

## Structured page contract

Every page stores:

```json
{
  "canonical_page_number": 8,
  "story_event_id": "",
  "story_text": "",
  "characters_required": [],
  "character_states": {},
  "props_required": [],
  "props_forbidden": [],
  "action_required": "",
  "emotion_required": "",
  "setting_required": "",
  "continuity_from_previous": "",
  "continuity_to_next": "",
  "reference_asset_ids": [],
  "style_version": 1
}
```

Generate illustrations from this contract, not an isolated prose prompt.

## Textless image policy

Image generation produces illustration only. Do not request:

- body copy
- dialogue bubbles
- title text
- character labels
- watermarks
- signatures
- UI labels

Render approved text with a controlled text layer.

## Visual checks

Compare each page to the canonical reference and adjacent pages:

- face geometry
- body proportion
- eye style
- colors
- outfit
- accessory
- prop design
- relative scale
- line art
- coloring and shading
- background world
- emotional continuity

## Semantic match

The image must depict the actual story text. Validate required characters, props, action, emotion, and setting.

A generic portrait is not valid when the text describes an action scene.

## Thresholds

```text
character_identity_consistency >= 95
cover_to_interior_match >= 95
illustration_style_consistency >= 95
page_to_page_continuity >= 95
prop_continuity >= 95
text_image_semantic_match >= 95
story_chronology >= 98
age_appropriateness >= 95
```

## Series continuity

For recurring characters across books, use a series-level Character Bible and style version. A book may add outfits or locations only through versioned approved extensions.
