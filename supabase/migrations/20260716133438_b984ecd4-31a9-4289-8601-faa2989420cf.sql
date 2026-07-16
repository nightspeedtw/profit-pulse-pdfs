
INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, target_dimension, metadata)
VALUES (
  'coloring_cover_verified_typography_v2', 1,
  'OWNER LAW: no UNVERIFIED AI text on coloring covers. Tier 1 = Ideogram v3 integrated hand-lettering with OCR-verified exact-text guard (3 attempts, overlay skipped on accept). Tier 2 = Flux textless + premium curved overlay. Tier 3 = self-art (insurance, cover_upgrade_pending=true). Supersedes coloring_cover_textless_forever. Owner beauty reference: Sneeze-Powered Sock Sorter cover.',
  'seed', 'cover_typography',
  jsonb_build_object(
    'law', 'no_unverified_ai_text_on_coloring_covers',
    'supersedes', jsonb_build_array('coloring_cover_textless_forever', 'coloring_cover_forever', 'cover_can_never_fail'),
    'tiers', jsonb_build_array(
      jsonb_build_object('tier', 1, 'name', 'ideogram_v3_integrated', 'attempts', 3),
      jsonb_build_object('tier', 2, 'name', 'flux_textless_plus_premium_curved_overlay', 'attempts', 3),
      jsonb_build_object('tier', 3, 'name', 'self_art_deterministic_colorized')
    ),
    'installed_at', now()
  )
)
ON CONFLICT (skill_key, version) DO UPDATE
  SET content_md = EXCLUDED.content_md, metadata = EXCLUDED.metadata, updated_at = now();

UPDATE public.pipeline_skills
   SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
         'superseded_by', 'coloring_cover_verified_typography_v2',
         'superseded_at', now(), 'is_active', false),
       updated_at = now()
 WHERE skill_key IN ('coloring_cover_textless_forever', 'coloring_cover_forever', 'cover_can_never_fail');
