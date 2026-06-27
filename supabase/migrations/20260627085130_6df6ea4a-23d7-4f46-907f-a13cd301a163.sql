ALTER TABLE public.generation_settings ALTER COLUMN min_word_count SET DEFAULT 18000;
UPDATE public.generation_settings SET min_word_count = 18000 WHERE id = 1 AND min_word_count < 18000;