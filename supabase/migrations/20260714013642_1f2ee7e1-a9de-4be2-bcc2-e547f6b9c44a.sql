UPDATE public.ebooks_kids
SET pipeline_status = 'retired',
    status = 'retired',
    listing_status = 'draft',
    sellable = false,
    blocker_reason = 'auto_retired: story_gate_failed_after_surgical_repair (rer=80<85, lang=85<90) — cleaned up post-hoc; concept lane rotated'
WHERE id = '6820e511-bfea-4413-8787-38a00ed90e7d'
  AND pipeline_status = 'human_review_required';