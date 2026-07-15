
-- SKILL C: character sheet URL column (per-book locked reference)
ALTER TABLE public.ebooks_kids ADD COLUMN IF NOT EXISTS character_sheet_url text;

-- Encode 6 owner-review skills into pipeline_skills (source='learned')
INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, target_dimension, age_band, sort_index, metadata)
VALUES
('KIDS_TEXT_SAFE_FRAME', 1,
'# SKILL A — Text never leaves the frame

- Minimum 36pt (0.5in) margin from every trimmed edge for ANY body/title text.
- Folios/page numbers may sit at ≥18pt margin.
- SHRINK-TO-FIT: measure rendered width/height BEFORE stamping. If overflowing → step font size DOWN (start high → 14pt minimum), then wrap, NEVER clip.
- Line-height 1.30–1.50, panel padding ≥16pt, text block ≤ 65% of page width.
- Deterministic gate at render time (`text_safe_frame_gate`): no glyph bbox may intersect the margin zone. Reaction = re-layout, not clip.',
'learned', 'layout', null, 10, '{"gate":"text_safe_frame_gate","wired_at":"kids-picture-pdf.assertTextSafe + shrinkToFit"}'::jsonb),

('KIDS_CAPTION_INTEGRATION', 1,
'# SKILL B — Story text integrated with the art

- Reserve the lower ~30% of the illustration as calm negative space.
- Do NOT paint a stark white rectangle. Use a palette-tinted translucent panel (warm cream biased toward the artwork palette, 85–92% opacity, feathered edge via 3 stacked rects with decreasing opacity outward).
- Typography: warm dark-brown ink (#3a2619), 14–18pt, friendly sans; consistent across the book.
- Onomatopoeia ("Boing!") stays as in-art illustration lettering. Story text stays typeset (crisp, accessible) but visually harmonized.',
'learned', 'layout', null, 20, '{"gate":"caption_integration_gate","wired_at":"kids-picture-pdf.drawCaptionOverlay"}'::jsonb),

('KIDS_CHARACTER_SHEET_LOCK', 1,
'# SKILL C — Character sheet lock (mandatory)

- Before interiors, generate a locked character sheet (front / side / action poses + color swatches + proportions note). QC it once.
- Pin sheet URL into EVERY page prompt alongside the cover reference.
- Per-batch verification compares each page against the SHEET with the strict rubric: species / face / eye style / proportions / colors / outfit accessories must match, human-like body on an animal hero is auto-fail, different-species is auto-fail.',
'learned', 'character', null, 30, '{"gate":"character_sheet_required_gate + character_match_gate","column":"ebooks_kids.character_sheet_url","wired_at":"kids-vision-qc.PAGE_SYSTEM (rubric); builder function kids-build-character-sheet (pending deploy)"}'::jsonb),

('KIDS_NO_TITLE_ECHO_INTERIOR', 1,
'# SKILL D — No title echo in interiors

- Interior generation prompt already forbids text.
- Per-batch vision verifier detects any interior containing the book title or large decorative title-style lettering → `title_text_present:true` → force page_scene_match_score ≤ 40 → reaction: regenerate that page via kids-regenerate-offmodel-pages.',
'learned', 'consistency', null, 40, '{"gate":"interior_title_echo_gate","wired_at":"kids-vision-qc.PAGE_SYSTEM + PAGE_SCHEMA_HINT"}'::jsonb),

('KIDS_PAGE_TEXT_COMPLETENESS', 1,
'# SKILL E — Text completeness before render

- Every page segment must end with terminal punctuation (. ! ?).
- Every page segment must NOT end on a conjunction/article (and, but, or, so, for, nor, yet, a, an, the, to, of, in, on, at, with, from, by, as, his, her, their, my, your, our).
- Runs at segmentation time (free, pre-illustration).
- Reaction: extend segment from next paragraph or trim to prior sentence boundary; if unfixable, rewrite via rewrite-kids-manuscript.',
'learned', 'text', null, 50, '{"gate":"page_text_completeness_gate","wired_at":"kids-segments.validateSegments"}'::jsonb),

('KIDS_SELLABILITY_BONUS_PAGES', 1,
'# SKILL F — Sellability + bonus pages

- Every book gets +2 bonus pages before the back cover:
  1. "Can You Spot the Clues?" — 3–5 concrete story objects auto-extracted from the manuscript (concrete nouns repeated ≥2×), plus "Which clue did you notice first?"
  2. "Talk About the Story" — 4 auto-generated discussion questions grounded in theme + developmental value.
- Positioning copy (description + ad_promise.primary_benefit) MUST include an explicit developmental-value line ("A playful garden story that teaches empathy, creative problem-solving, and friendship").
- Page-count expectation includes the +2 bonus pages.',
'learned', 'sellability', null, 60, '{"gate":"bonus_pages_present_gate + positioning_copy_developmental_value_gate","wired_at":"bonus-pages.buildBonusContent + kids-picture-pdf.finalizePicturePdf + kids-generate-storefront-copy"}'::jsonb)
ON CONFLICT DO NOTHING;
