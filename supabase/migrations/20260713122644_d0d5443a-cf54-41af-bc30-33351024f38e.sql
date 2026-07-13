update public.ebooks_kids
set qc_scorecard = coalesce(qc_scorecard,'{}'::jsonb) || jsonb_build_object(
  'retire_recommended', true,
  'retire_reason', 'story judge held generic_story_risk at 70-75 across 2 targeted attempts despite locked wormhole+tooth premise; other dimensions passing (age 90, coh 85, emo 80, rer 85, lang 95, buyer 80). Judge treats this premise family as archetypal. Recommend fresh book in a lane the judge has not seen — NOT bedtime, NOT emotional regulation, NOT tooth/bathroom, NOT wormhole/portal.'
),
listing_status='draft',
status='needs_revision',
pipeline_status='human_review_required'
where id='5b348e12-930a-4f9e-ab87-bda522a40925';