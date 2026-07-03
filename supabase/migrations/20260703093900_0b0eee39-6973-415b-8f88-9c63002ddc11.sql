
UPDATE public.ebooks
   SET pdf_status = 'idle',
       canonical_status = 'queued_for_production',
       autopilot_state = 'queued_for_production',
       auto_fix_attempt_count = 0,
       next_retry_at = now(),
       blocker_reason = NULL,
       needs_review_reason = NULL,
       updated_at = now()
 WHERE id IN (
   '72637baf-f4c3-4d19-9290-674939291ff3',
   '16b3122c-0c38-4dfd-8cb8-d3ca64034350',
   '85380682-3a25-4d26-b980-84bc9dfb317e',
   '4664f02e-41e2-48a1-8231-9ae81a3f698c',
   '9657b843-ccdb-43af-b33c-87f7022f1adf',
   '79f883af-2868-4a83-a74c-99d6c9c51a7e',
   '92bbc7de-a741-4f57-8e19-d661b1a98b6a',
   'adbdd432-e1e3-49bc-a20a-4da15a6147f3',
   '160f23dd-2c74-4bd0-910d-2fb3d1a5b00e',
   '11f39d68-db22-4664-a67a-344b53785a3a',
   '03ad5674-3915-49af-b3e3-13e84da52ab4'
 );

UPDATE public.system_fix_instructions
   SET status = 'resolved', resolved_at = now(), updated_at = now()
 WHERE status = 'open'
   AND (title ILIKE '%formatter%' OR detected_problem ILIKE '%formatter%');

DELETE FROM public.production_locks WHERE expires_at < now();
