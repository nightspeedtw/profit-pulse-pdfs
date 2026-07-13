---
name: childrens-storybook-consistency-lock
description: Triggers on any children's novel, illustrated storybook, bedtime story, picture book, early reader, moral story, fantasy story, or educational children's story. Locks the Story Bible, character design, illustration style, palette, cover/interior match, and QC gates so the whole book reads and looks like one coherent, professionally illustrated children's book.
---

# Children's Storybook Consistency Lock

Master add-on skill. Use whenever generating: children's novels, illustrated children's books, bedtime stories, picture books, early reader books, moral stories for kids, fantasy stories for children, or educational children's stories.

Goal: the entire book must feel like ONE coherent, professionally illustrated children's book. Story concept, characters, appearance, personality, outfits, palette, illustration style, line art, rendering, page tone, cover, interior, world, mood, age-appropriate voice, moral, typography and layout must never drift page to page.

## 1. Core Rule

Before writing or illustrating a children's book, build a locked **Story Bible**. It is the single source of truth for the entire book. Do not generate anything outside it unless the Story Bible is intentionally updated and re-validated.

The Story Bible must exist BEFORE: chapter writing, page writing, cover generation, character images, scene illustrations, thumbnails, PDF layout, product mockups.

## 2. Story Bible (required schema)

```json
{
  "book_title": "",
  "target_age_range": "",
  "reading_level": "",
  "story_genre": "",
  "story_theme": "",
  "moral_lesson": "",
  "emotional_tone": "",
  "world_setting": "",
  "main_character": {},
  "supporting_characters": [],
  "character_relationships": [],
  "character_design_sheet": {},
  "visual_style_guide": {},
  "color_palette": {},
  "line_art_style": "",
  "rendering_style": "",
  "cover_style": "",
  "interior_illustration_style": "",
  "typography_style": "",
  "forbidden_style_drift": [],
  "continuity_rules": []
}
```

Persist to the ebook record. Reuse for every later generation step.

## 3. Character Design Lock

Every important character has a fixed profile:

```json
{
  "character_name": "",
  "role_in_story": "",
  "species_or_type": "",
  "age_or_age_feel": "",
  "personality": "",
  "core_emotion": "",
  "body_shape": "",
  "face_shape": "",
  "eye_shape": "",
  "eye_color": "",
  "hair_or_fur_style": "",
  "hair_or_fur_color": "",
  "skin_or_body_color": "",
  "outfit": "",
  "signature_accessory": "",
  "height_relative_to_others": "",
  "unique_identifying_features": [],
  "do_not_change": []
}
```

Never change: face shape, body shape, hair/fur color, eye color, outfit, accessories, proportions, species, personality, age feel, signature features. If the same character appears in multiple images, it must look like the same character every time.

## 4. Character Reference Sheet

Before cover or interior illustrations, generate a reference sheet per major character containing: front view, 3/4 view, side view if possible, 3 facial expressions, full body, outfit details, accessory details, palette, line style, notes on what must never change.

If the reference sheet is missing, do not generate any story illustration — build it first.

## 5. Illustration Style Lock

```json
{
  "style_name": "",
  "line_quality": "",
  "coloring_method": "",
  "texture_level": "",
  "shading_style": "",
  "background_detail_level": "",
  "character_proportions": "",
  "mood": "",
  "brush_style": "",
  "edge_style": "",
  "lighting_style": "",
  "page_composition_style": ""
}
```

Pick ONE direction (soft watercolor / clean vector / pencil-pastel / warm gouache / rounded cartoon / soft 3D / classic bedtime, etc.) and do not change it mid-book. Hard fail if cover style ≠ interior style, or if pages look painted by different artists.

## 6. Visual Consistency Rules

Every illustration must share: character model, outfit (unless a plot-driven change is recorded in the bible), age feel, face, eyes, hair/fur, palette, line art, shading, world setting, emotional register, level of detail.

## 7. Story Consistency Rules

Define first: target age, page count, vocabulary, sentence length, tone, moral, conflict, resolution, character arc, page-by-page outline. Story must be age-appropriate, emotionally clear, warm, imaginative, not scary/adult/generic/preachy, and never jump randomly.

## 8. Children's Writing Style

Use: simple natural language, clear emotional beats, gentle rhythm, sensory detail, warm narration, memorable voice, satisfying ending, clear takeaway. Avoid: business/motivational jargon, long paragraphs, complex metaphors, scary scenes, moralizing, robotic AI phrasing, generic filler, random plot jumps.

## 9. Page-by-Page Lock

```json
{
  "page_number": 1,
  "story_text": "",
  "scene_summary": "",
  "characters_present": [],
  "character_emotions": {},
  "location": "",
  "illustration_prompt": "",
  "continuity_notes": "",
  "visual_must_include": [],
  "visual_must_not_change": []
}
```

Every image prompt references Story Bible + character profile + reference sheet + style guide + scene + continuity notes. Never generate a page image from an isolated prompt.

## 10. Cover Consistency

Cover uses the same main character design, style, palette, world, mood as interior. It clearly shows the main character, the emotional promise, the story world, the title, and age-appropriate visual appeal. It must not introduce a new face, outfit, species, art style, or unrelated scene.

## 11. Interior Illustration Consistency

Every interior prompt injects Character lock (name, appearance, outfit, colors, expression, body shape, accessory), Style lock (line/color/shading/palette/texture/background), and Scene lock (location, action, mood, page, continuity).

## 12–14. QC Gates (all scores 0–100)

Character consistency: face, body, outfit, color, accessory, personality, style, page-to-page — all **≥ 95**.
Story continuity: story_continuity ≥ 95, age_appropriateness ≥ 95, emotional_flow ≥ 90, moral_clarity ≥ 90, language_naturalness ≥ 90.
Style consistency: cover_to_interior_style_match ≥ 95, illustration_style_consistency ≥ 95, color_palette_consistency ≥ 95, line_art_consistency ≥ 95, rendering_consistency ≥ 95.

Hard fail on drift; regenerate only the affected image with the locked reference. Do not regenerate the whole book unless necessary.

## 15. Interior Page Prompt Template

See `references/prompt-templates.md`.

## 16. Cover Prompt Template

See `references/prompt-templates.md`.

## 17. Anti-Drift Memory

Persist per book: story_bible_id, main_character_reference_url, supporting_character_reference_urls, locked_style_prompt, locked_palette, locked_line_art, locked_rendering_style, locked_character_descriptions, page_continuity_notes, approved_cover_url, approved_page_illustration_urls. Every step loads this before creating content. If missing, pause and build it first — never continue blindly.

## 18. Auto-Fix

- Character off → regenerate that image only, stronger lock, lower creative freedom.
- Style drift → regenerate that image using the locked style guide; strip conflicting style words.
- Story contradicts itself → rewrite only the affected page/chapter; update continuity notes.
- Cover ≠ interior → regenerate cover with the exact reference sheet.
- Page image ≠ text → regenerate from the page plan.

Max 3 attempts per image. If still failing, mark run `needs_admin_attention` with `blocker_reason = kids_consistency_unrecoverable`.

## 19. Final Pass Criteria

Ready-for-sale requires: Story Bible ✓, reference sheet ✓, cover matches characters, interior matches characters, one shared illustration style, all characters consistent, age-appropriate, clear moral/theme, natural children's language, coherent page sequence, unified PDF.

Required final scores: character_consistency ≥ 95, illustration_style_consistency ≥ 95, story_continuity ≥ 95, age_appropriateness ≥ 95, cover_to_interior_match ≥ 95, final_children_book_quality ≥ 90.

Do not mark complete if character consistency fails.

## Hard bans (Thai summary from the user)

- นิยายเด็ก / หนังสือภาพเด็ก ต้องมี Story Bible ก่อนเสมอ
- ทุกภาพต้องอ้างอิง Story Bible
- ถ้าตัวละครเพี้ยน = fail
- ถ้าปกกับภาพในเล่มคนละสไตล์ = fail
- ถ้าหน้าในเล่มดูเหมือนคนละเรื่อง = fail
