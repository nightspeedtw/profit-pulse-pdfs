# Story Bible JSON schemas

See SKILL.md §2, §3, §5, §9 for the canonical structure. This file mirrors them as strict JSON for tooling.

## StoryBible

```json
{
  "book_title": "string",
  "target_age_range": "string (e.g. 4-7)",
  "reading_level": "string",
  "story_genre": "string",
  "story_theme": "string",
  "moral_lesson": "string",
  "emotional_tone": "string",
  "world_setting": "string",
  "main_character": { "$ref": "CharacterProfile" },
  "supporting_characters": [{ "$ref": "CharacterProfile" }],
  "character_relationships": ["string"],
  "visual_style_guide": { "$ref": "StyleGuide" },
  "color_palette": {
    "primary": ["#hex"],
    "secondary": ["#hex"],
    "accent": ["#hex"],
    "neutral": ["#hex"]
  },
  "line_art_style": "string",
  "rendering_style": "string",
  "cover_style": "string",
  "interior_illustration_style": "string",
  "typography_style": "string",
  "forbidden_style_drift": ["string"],
  "continuity_rules": ["string"],
  "character_reference_sheets": {
    "<character_name>": { "url": "string", "prompt": "string" }
  },
  "version": 2
}
```

## CharacterProfile

```json
{
  "character_name": "string",
  "role_in_story": "string",
  "species_or_type": "string",
  "age_or_age_feel": "string",
  "personality": "string",
  "core_emotion": "string",
  "body_shape": "string",
  "face_shape": "string",
  "eye_shape": "string",
  "eye_color": "string",
  "hair_or_fur_style": "string",
  "hair_or_fur_color": "string",
  "skin_or_body_color": "string",
  "outfit": "string",
  "signature_accessory": "string",
  "height_relative_to_others": "string",
  "unique_identifying_features": ["string"],
  "do_not_change": ["string"]
}
```

## StyleGuide

```json
{
  "style_name": "string",
  "line_quality": "string",
  "coloring_method": "string",
  "texture_level": "string",
  "shading_style": "string",
  "background_detail_level": "string",
  "character_proportions": "string",
  "mood": "string",
  "brush_style": "string",
  "edge_style": "string",
  "lighting_style": "string",
  "page_composition_style": "string"
}
```

## PagePlan

```json
{
  "page_number": 1,
  "story_text": "string",
  "scene_summary": "string",
  "characters_present": ["string"],
  "character_emotions": { "<character_name>": "string" },
  "location": "string",
  "illustration_prompt": "string",
  "continuity_notes": "string",
  "visual_must_include": ["string"],
  "visual_must_not_change": ["string"]
}
```
