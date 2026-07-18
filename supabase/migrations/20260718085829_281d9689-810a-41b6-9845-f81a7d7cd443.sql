UPDATE ebooks_kids
SET pipeline_status = 'queued',
    blocker_reason = NULL,
    metadata = jsonb_set(
      jsonb_set(
        COALESCE(metadata, '{}'::jsonb) - 'cover_pending_verify' - 'coloring_blocker',
        '{coloring_cover_invocations}', '0'::jsonb
      ),
      '{awaiting}', '"cover_pdf_publish"'::jsonb
    )
WHERE id = 'c2839b88-d900-4f69-bdd9-de748df24d9a'
RETURNING id, (metadata->>'coloring_cover_invocations')::int AS inv;