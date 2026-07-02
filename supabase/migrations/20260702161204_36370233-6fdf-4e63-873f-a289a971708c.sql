
CREATE TABLE IF NOT EXISTS public.shopify_upload_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_id UUID NOT NULL REFERENCES public.ebooks(id) ON DELETE CASCADE,
  run_id UUID,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INT NOT NULL DEFAULT 100,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 10,
  last_error TEXT,
  blocker_reason TEXT,
  next_retry_at TIMESTAMPTZ,
  shopify_draft_id TEXT,
  shopify_draft_url TEXT,
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ebook_id)
);

GRANT SELECT ON public.shopify_upload_queue TO authenticated;
GRANT ALL ON public.shopify_upload_queue TO service_role;

ALTER TABLE public.shopify_upload_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view shopify upload queue"
ON public.shopify_upload_queue FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
));

CREATE TRIGGER shopify_upload_queue_touch
BEFORE UPDATE ON public.shopify_upload_queue
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_suq_status_retry
  ON public.shopify_upload_queue (status, next_retry_at);

ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS blocker_reason TEXT,
  ADD COLUMN IF NOT EXISTS blocker_class TEXT,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_fix_attempts INT NOT NULL DEFAULT 0;

ALTER TABLE public.autopilot_pipeline_runs
  ADD COLUMN IF NOT EXISTS blocker_reason TEXT,
  ADD COLUMN IF NOT EXISTS blocker_class TEXT,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
