
UPDATE ebooks_kids
SET pipeline_status='needs_illustration',
    blocker_reason=NULL,
    human_review_reason=NULL,
    updated_at=NOW()
WHERE id IN ('1c8a820f-69ce-4b0e-942f-182700c7cd64','f370e7f0-bb4f-4732-9570-7057d309c0a1');
