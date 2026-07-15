# QC Gates

## Character Consistency (hard gates, all ≥ 95)

- face_consistency_score
- body_consistency_score
- outfit_consistency_score
- color_consistency_score
- accessory_consistency_score
- personality_consistency_score
- style_consistency_score
- page_to_page_continuity_score

Fail on: main character looks different, outfit changes without reason, face/species/age changes, art style changes, palette drifts, proportions drift.

## Story Continuity

- story_continuity_score ≥ 95
- age_appropriateness_score ≥ 95
- emotional_flow_score ≥ 90
- moral_clarity_score ≥ 90
- language_naturalness_score ≥ 90

Fail on: random plot jumps, unmotivated character shifts, unexplained setting changes, tone drifting adult, language above target age, rushed ending, forced moral.

## Style Consistency

- cover_to_interior_style_match ≥ 95
- illustration_style_consistency ≥ 95
- color_palette_consistency ≥ 95
- line_art_consistency ≥ 95
- rendering_consistency ≥ 95

Fail on: cover looks like a different book, pages look painted by different artists, mixed media (watercolor + 3D), inconsistent line work.

## Final Pass

- character_consistency_score ≥ 95
- illustration_style_consistency ≥ 95
- story_continuity_score ≥ 95
- age_appropriateness_score ≥ 95
- cover_to_interior_match_score ≥ 95
- final_children_book_quality_score ≥ 90

Do not mark complete if character consistency fails.
