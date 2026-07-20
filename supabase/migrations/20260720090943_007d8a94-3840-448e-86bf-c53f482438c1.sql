UPDATE coloring_v2_books
SET stage = 'cover'
WHERE stage = 'publish'
  AND created_at > NOW() - INTERVAL '30 days';

INSERT INTO pipeline_skills (skill_key, version, content_md, source, target_dimension)
VALUES (
  'cover_no_age_badge_and_matter_footer_v1',
  1,
  '# cover_no_age_badge_and_matter_footer_v1 (owner 2026-07-21)

Rule 1: Do NOT bake "Ages X-Y" into V2 coloring covers. Age lives on the storefront card and product page. coloring-v2-cover now passes ageBadge="" and HARD_BANNED_COVER_TOKENS includes ages/age.

Rule 2: Every V2 matter page (Title / Copyright / How-to / Certificate) must render drawBrandFooter({ logo }) — © bottom-left, SecretPDF logo bottom-right. All four renderers call it; coloring-v2-pdf passes brandLogo into all four contexts.

Recovery: all live V2 books requeued from publish -> cover.',
  'learned',
  'cover+matter_pages'
);