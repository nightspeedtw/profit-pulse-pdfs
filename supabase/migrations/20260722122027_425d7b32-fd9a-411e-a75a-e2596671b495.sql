
-- 1) Drop the trigger that force-demotes legacy coloring books lacking new OCR evidence
DROP TRIGGER IF EXISTS trg_ebooks_kids_coloring_spelling_guard ON public.ebooks_kids;

-- 2) Restore the 36 legacy books the owner confirmed are fine
UPDATE public.ebooks_kids
SET listing_status = 'live',
    sellable = true,
    blocker_reason = NULL,
    updated_at = now()
WHERE blocker_reason = 'cover_spelling_unverified_legacy_v1';
