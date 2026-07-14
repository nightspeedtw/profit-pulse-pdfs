DELETE FROM public.pipeline_skills WHERE skill_key = 'structured_segment_writer';
INSERT INTO public.pipeline_skills (skill_key, version, source, content_md, metadata)
VALUES (
  'structured_segment_writer',
  1,
  'learned',
  E'STRUCTURED SEGMENT WRITER — non-negotiable\n\nEvery kids picture-book writer (fresh + rewrite) MUST emit the manuscript as structured JSON:\n  { "title", "refrain", "pages": [{ "page": 1..N, "text": "15-30 words" }] }\n\nDeterministic pre-image gate (free, runs BEFORE the story judge):\n  - pages.length === target (default 28)\n  - each page.text is 15-30 words\n  - refrain string appears verbatim on ≥3 pages\n  - no empty / "Page N" / TBD / lorem placeholders\nOn failure: exactly ONE automatic rewrite attempt with violations quoted back.\n\nDownstream contract:\n  - segments live at ebook.storefront_meta.kids_manuscript_segments\n  - manuscript_md is a DERIVED render — never the source of truth\n  - kids-render-interior derives ScenePlan 1:1 from segments (no splitter)\n  - kids-build-picture-pdf uses segments as captions 1:1; splitter is safety net\n  - kids-qc-run passes segment page_texts to the judge directly\n  - text_mapping_gate is an assertion that cannot fire on segmented books\n\nFailure class: manuscript_split_mismatch → resolved by segment source of truth.\n',
  jsonb_build_object('failure_class','manuscript_split_mismatch','introduced_by','KILLER_2_fix')
);