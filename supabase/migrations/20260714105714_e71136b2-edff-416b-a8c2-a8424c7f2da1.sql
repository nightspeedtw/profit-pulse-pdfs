INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, target_dimension, age_band, sort_index, metadata)
VALUES (
  'cover_character_style_from_interior',
  1,
  E'# Cover must be generated FROM the interior reference images\n\nRULE (learned, 2026-07-14): the kids-book cover is a promise about the pages inside. It MUST show the SAME hero character drawn in the SAME art style as the finished interior pages.\n\nHow to apply:\n1. Once interior illustrations exist for the book, ALWAYS regenerate the cover by pinning the first 2-3 interior pages as reference images to the image model (character + style anchor). Never generate the cover from a fresh concept prompt after interiors are locked.\n2. Prefer geminiDirectImage (google/gemini-3.1-flash-image) with `referenceUrls` set to the signed URLs of the interior pages.\n3. The title MUST be baked INTO the artwork as hand-lettered painted lettering, in the upper third, with readability armor. Do NOT then add a second SVG/HTML title overlay on top — double text is a critical fail.\n4. The image must contain the exact title and (optionally) subtitle and NOTHING ELSE — no author lines, no invented tag-lines, no publisher marks, no numbers.\n\nVision QC checks (hard gates):\n- title spelled EXACTLY, case-insensitive\n- NO extraneous words beyond title + subtitle\n- character visually matches the interior reference (same face, hair, glasses, skin, outfit, proportions)\n- style matches the interior reference (same line quality, palette, medium)\n- thumbnail test at 100x160 passes\n\nA cover that shows a different character than the interiors is a CRITICAL FAIL — repair, do not ship.',
  'learned',
  'cover_character_consistency',
  'all',
  10,
  jsonb_build_object('created_by', 'owner_directive_2026_07_14', 'incident_ref', 'd83fbcfe_sneeze_sock_sorter')
)
ON CONFLICT DO NOTHING;