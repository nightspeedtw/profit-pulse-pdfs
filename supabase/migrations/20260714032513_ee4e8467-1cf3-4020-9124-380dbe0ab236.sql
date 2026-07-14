INSERT INTO public.pipeline_skills
  (skill_key, version, content_md, source, target_dimension, age_band, sort_index, metadata)
VALUES (
  'book_format_kids_picture', 1,
$$BOOK FORMAT — Kids picture book (default, non-negotiable):
- Trim: 8.5 × 8.5 inches SQUARE. PDF page geometry 612 × 612 pt. Every page.
- Total length: 32–40 pages including title + copyright + closing.
- Story body: 28–36 illustrated pages, ONE scene per page.
- Full-color illustration on EVERY page — no text-only pages.
- 1–3 short sentences per page (15–30 words), placed where they never fight the art.
- Consistent character/style across every page (style bible + vision QC enforced).
- Cover: square 1:1, matches interior character + style.
- Interior illustration aspect: 1:1 square, full-bleed to page edges.
$$,
  'seed', 'book_format', '4-6', 5,
  jsonb_build_object(
    'page_width_pt', 612, 'page_height_pt', 612,
    'min_total_pages', 32, 'max_total_pages', 40,
    'story_min_pages', 28, 'story_max_pages', 36
  )
)
ON CONFLICT (skill_key, version) DO UPDATE
  SET content_md = EXCLUDED.content_md,
      metadata = EXCLUDED.metadata,
      updated_at = now();