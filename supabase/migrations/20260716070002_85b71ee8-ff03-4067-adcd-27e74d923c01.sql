CREATE TABLE public.stall_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ebook_id UUID NOT NULL REFERENCES public.ebooks_kids(id) ON DELETE CASCADE,
  book_type TEXT NOT NULL,
  pipeline_status TEXT NOT NULL,
  awaiting TEXT,
  step_label TEXT,
  blocker_class TEXT NOT NULL,
  reaction TEXT NOT NULL CHECK (reaction IN ('advance_regime','resume_checkpoint','surface_blocker')),
  repeat_after_fix BOOLEAN NOT NULL DEFAULT false,
  regime_version TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stall_age_seconds INTEGER NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stall_events_ebook ON public.stall_events(ebook_id, detected_at DESC);
CREATE INDEX idx_stall_events_class ON public.stall_events(blocker_class, detected_at DESC);
CREATE INDEX idx_stall_events_open ON public.stall_events(detected_at DESC) WHERE resolved_at IS NULL;

GRANT SELECT ON public.stall_events TO authenticated;
GRANT ALL ON public.stall_events TO service_role;

ALTER TABLE public.stall_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view stall events"
  ON public.stall_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));