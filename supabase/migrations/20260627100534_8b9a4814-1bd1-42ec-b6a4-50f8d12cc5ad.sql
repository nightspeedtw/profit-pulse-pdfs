ALTER TABLE public.ebooks ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.ebook_ideas ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.ebooks ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.ebook_ideas ALTER COLUMN status TYPE text USING status::text;

ALTER TABLE public.ebooks ALTER COLUMN status SET DEFAULT 'outline';
ALTER TABLE public.ebook_ideas ALTER COLUMN status SET DEFAULT 'idea';

DROP TYPE IF EXISTS public.ebook_status;