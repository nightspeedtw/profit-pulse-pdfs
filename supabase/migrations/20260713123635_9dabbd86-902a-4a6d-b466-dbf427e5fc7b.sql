update public.ebooks_kids
set qc_scorecard = coalesce(qc_scorecard,'{}'::jsonb) || jsonb_build_object(
  'retire_recommended', true,
  'retire_reason', '4th consecutive book: story judge failed ONLY on generic_risk (60, 70) while every other dimension passed or near-passed (age 85-90, coh 85-90, emo 75-80, rer 75-80, lang 88-90, buyer 85). Locked premise (sneeze-powered sock sorter) is highly differentiated and clearly non-generic. Pattern across 4 books in 4 different lanes (bedtime, cozy-object, humor-adventure, silly-science) points to STORY-JUDGE CALIBRATION as the blocker, not the premise. STOP before Book #5 and audit runKidsStoryJudge prompt/scoring for generic_risk bias.'
),
listing_status='draft',
status='needs_revision',
pipeline_status='human_review_required'
where id='d83fbcfe-4193-47cb-bba4-ab4fd7f4767f';