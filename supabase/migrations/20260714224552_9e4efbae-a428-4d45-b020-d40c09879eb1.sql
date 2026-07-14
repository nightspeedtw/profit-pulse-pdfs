
UPDATE public.ebooks_kids
   SET pipeline_status = 'pdf_building',
       listing_status  = 'draft',
       sellable        = false,
       blocker_reason  = NULL,
       storefront_meta = COALESCE(storefront_meta, '{}'::jsonb)
                       || jsonb_build_object(
                            'unretired', jsonb_build_object(
                              'at', now(),
                              'reason', 'supervisor_declined_unrecognized_stall_regression_fixed',
                              'paid_interiors_preserved', jsonb_array_length(COALESCE(interior_illustrations, '[]'::jsonb))
                            )
                          )
 WHERE id = '148eda2c-680a-46fb-8070-03c0c4682c3a';

UPDATE public.ebooks_kids
   SET pipeline_status = 'pdf_building',
       listing_status  = 'draft',
       sellable        = false,
       blocker_reason  = NULL,
       storefront_meta = COALESCE(storefront_meta, '{}'::jsonb)
                       || jsonb_build_object(
                            'unretired', jsonb_build_object(
                              'at', now(),
                              'reason', 'cover_dead_image_repeated_gemini_regression_fixed',
                              'paid_interiors_preserved', jsonb_array_length(COALESCE(interior_illustrations, '[]'::jsonb))
                            ),
                            'needs_cover_repair', true
                          )
 WHERE id = '82edbb75-e3d6-4a26-9ca7-01410d8cbee8';

INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, metadata)
VALUES
  (
    'paid_assets_never_discarded_for_infrastructure',
    1,
    '# Rule: paid assets are never discarded for infrastructure reasons

Stall ≠ quality failure. Books in pdf_building or illustrating with completed paid interiors (≥12) may NEVER be retired for a stall, unrecognized state, or budget exhaustion of a non-content class. Only deterministic content-quality gates (cover_hard_fail, dead_page_gate, text_mapping_gate, story_gate flatline) may retire an in-flight book. All other stalls are infrastructure — free-resume forever via kids-render-interior or kids-build-picture-pdf.',
    'learned',
    jsonb_build_object('applies_to', ARRAY['kids-repair-supervisor','kids-autopilot-watchdog','kids-batch-producer'], 'origin', 'crumbly_clue_caper_regression_2026_07_14')
  ),
  (
    'dead_frames_rejected_at_birth',
    1,
    '# Rule: dead frames are rejected at birth, not budgeted

Near-black / near-white / flat-variance image outputs are rejected AT GENERATION, BEFORE persistence, and never consume repair or cover budget. Every image generator (cover master, character reference, interior page, cover-from-interior repair) wraps its call with generateLiveImage() from _shared/image-luminance.ts: up to 3 in-call retries with prompt jitter and, on attempt 2, a swapped reference order + fresh seed. Response metadata (finishReason, safetyRatings, partCount, bytesLen) is logged on every dead attempt for root-cause. Only after 3 in-call dead frames does the caller record a real, budget-worthy failure.',
    'learned',
    jsonb_build_object('applies_to', ARRAY['autopilot-kids-pipeline','kids-repair-cover-from-interior','kids-repair-cover','kids-render-interior'], 'origin', 'rusty_rumble_roar_cover_regression_2026_07_14')
  )
ON CONFLICT (skill_key, version) DO UPDATE
   SET content_md = EXCLUDED.content_md,
       metadata   = EXCLUDED.metadata,
       updated_at = now();
