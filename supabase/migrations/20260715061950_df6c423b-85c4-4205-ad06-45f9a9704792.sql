DELETE FROM public.pipeline_skills WHERE skill_key = 'cover_title_mastery';
INSERT INTO public.pipeline_skills(skill_key, source, version, content_md, metadata)
VALUES ('cover_title_mastery', 'learned', 1,
$md$# Cover Title Mastery (2026 consensus)

## Technique stack (every image-gen cover call)
1. Put the EXACT title in double quotes in the prompt — signals literal text.
2. Short text wins (<=25 chars). Long titles MUST be broken into stacked lines, each <=14 chars, with the line-break plan passed explicitly to the model.
3. Describe fonts GENERICALLY ("chunky rounded hand-painted children's book letters, thick outline"). Never name fonts.
4. For failure-prone words (apostrophes, invented, hyphenated), include letter-by-letter spelling anchors in the prompt.
5. Prefer STRAIGHT apostrophes; the verifier treats ' ` as identical.

## Model routing ladder (accept first that passes fuzzy QC)
- Rung 1: Ideogram v3 QUALITY via Fal (fal-ai/ideogram/v3) — industry-best text renderer (~90% typography accuracy).
- Rung 2: Ideogram v3 retry with different seed + jitter.
- Rung 3: Gemini 3.1 flash-image ref-conditioned (character fidelity fallback).
- Final: text-free character master + SVG title overlay (never misspells).

## Verification (fuzzy, not brittle)
- Normalize both sides (casefold, strip ALL punctuation/whitespace/breaks).
- Require Levenshtein similarity >= 0.93.
- Log expected vs transcribed on every check.
- Subtitle optional (verify only if rendered).

## Learning
- Record cover_accepted_rung per book in storefront_meta.
- Downstream analytics compute rung-level win-rates over time.$md$,
  jsonb_build_object(
    'similarity_threshold', 0.93,
    'max_line_chars', 14,
    'primary_model', 'fal-ai/ideogram/v3',
    'fallback_models', jsonb_build_array('google/gemini-3.1-flash-image', 'svg-composite'),
    'ladder', jsonb_build_array('ideogram_v3_a', 'ideogram_v3_b', 'gemini_refs', 'composite_svg'),
    'techniques', jsonb_build_array(
      'quoted_exact_title',
      'stacked_short_lines',
      'generic_font_description',
      'letter_by_letter_spelling_for_tricky_words',
      'straight_apostrophes'
    )
  )
);