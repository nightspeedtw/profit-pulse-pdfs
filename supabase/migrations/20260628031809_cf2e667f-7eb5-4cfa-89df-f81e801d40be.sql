
ALTER TABLE public.ebook_ideas
  ADD COLUMN IF NOT EXISTS buyer_appeal_score INTEGER CHECK (buyer_appeal_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS hard_sell_strength_score INTEGER CHECK (hard_sell_strength_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS idea_score INTEGER CHECK (idea_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS compliance_notes TEXT,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS generation_mode TEXT NOT NULL DEFAULT 'one_best'
    CHECK (generation_mode IN ('one_best','alternative','manual')),
  ADD COLUMN IF NOT EXISTS parent_idea_id UUID REFERENCES public.ebook_ideas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS selected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raw_ai JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ebook_ideas_parent ON public.ebook_ideas(parent_idea_id);
CREATE INDEX IF NOT EXISTS idx_ebook_ideas_generation_mode ON public.ebook_ideas(generation_mode);
CREATE INDEX IF NOT EXISTS idx_ebook_ideas_selected ON public.ebook_ideas(selected);
