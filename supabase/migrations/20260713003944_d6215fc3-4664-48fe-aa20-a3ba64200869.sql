UPDATE public.ebooks
SET store_thumbnail_url = cover_url,
    thumbnail_needs_review = false,
    store_thumbnail_generated_at = now(),
    updated_at = now()
WHERE id = 'bcbb9b53-ad13-4544-9b18-0aaa03b829ab';