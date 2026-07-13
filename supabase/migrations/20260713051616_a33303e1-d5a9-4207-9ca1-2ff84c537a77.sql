
ALTER TABLE public.ebook_ideas      ALTER COLUMN pipeline_status DROP DEFAULT;
ALTER TABLE public.ebooks           ALTER COLUMN pipeline_status DROP DEFAULT;
ALTER TABLE public.production_queue ALTER COLUMN pipeline_status DROP DEFAULT;
ALTER TABLE public.ebook_chapters   ALTER COLUMN pipeline_status DROP DEFAULT;

ALTER TYPE public.pipeline_status RENAME TO pipeline_status_old;

CREATE TYPE public.pipeline_status AS ENUM (
  'ideation','idea_generated','title_copywriting','outline_generation','writing',
  'chapter_qc','pdf_design','cover_design','product_copy','final_qc',
  'published','rejected'
);

ALTER TABLE public.ebook_ideas      ALTER COLUMN pipeline_status TYPE public.pipeline_status USING pipeline_status::text::public.pipeline_status;
ALTER TABLE public.ebooks           ALTER COLUMN pipeline_status TYPE public.pipeline_status USING pipeline_status::text::public.pipeline_status;
ALTER TABLE public.production_queue ALTER COLUMN pipeline_status TYPE public.pipeline_status USING pipeline_status::text::public.pipeline_status;
ALTER TABLE public.ebook_chapters   ALTER COLUMN pipeline_status TYPE public.pipeline_status USING pipeline_status::text::public.pipeline_status;
ALTER TABLE public.qc_reports       ALTER COLUMN stage           TYPE public.pipeline_status USING stage::text::public.pipeline_status;
ALTER TABLE public.api_costs        ALTER COLUMN stage           TYPE public.pipeline_status USING stage::text::public.pipeline_status;

ALTER TABLE public.ebook_ideas      ALTER COLUMN pipeline_status SET DEFAULT 'idea_generated'::public.pipeline_status;
ALTER TABLE public.ebooks           ALTER COLUMN pipeline_status SET DEFAULT 'idea_generated'::public.pipeline_status;
ALTER TABLE public.production_queue ALTER COLUMN pipeline_status SET DEFAULT 'idea_generated'::public.pipeline_status;
ALTER TABLE public.ebook_chapters   ALTER COLUMN pipeline_status SET DEFAULT 'writing'::public.pipeline_status;

DROP TYPE public.pipeline_status_old;
