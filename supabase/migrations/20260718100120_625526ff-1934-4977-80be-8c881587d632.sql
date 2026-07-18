update ebooks_kids
set cover_url = 'https://atccyjuwimibyoocpiwi.supabase.co/storage/v1/object/sign/ebook-covers/kids/c2839b88-d900-4f69-bdd9-de748df24d9a/coloring/cover-final-refit-1784366442738.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9hMzNlYzJjMC03OTM1LTQwZjItYjFjYy05ZTY3OGFiZmFiZjAiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJlYm9vay1jb3ZlcnMva2lkcy9jMjgzOWI4OC1kOTAwLTRmNjktYmRkOS1kZTc0OGRmMjRkOWEvY29sb3JpbmcvY292ZXItZmluYWwtcmVmaXQtMTc4NDM2NjQ0MjczOC5wbmciLCJzY29wZSI6ImRvd25sb2FkIiwiaWF0IjoxNzg0MzY4ODQwLCJleHAiOjE4MTU5MDQ4NDB9.Egznmwri49ZzMp0u6V0jebbMG2wAiHeFvwIJ6QjEczY',
    thumbnail_url = 'https://atccyjuwimibyoocpiwi.supabase.co/storage/v1/object/sign/ebook-covers/kids/c2839b88-d900-4f69-bdd9-de748df24d9a/coloring/cover-final-refit-1784366442738.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9hMzNlYzJjMC03OTM1LTQwZjItYjFjYy05ZTY3OGFiZmFiZjAiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJlYm9vay1jb3ZlcnMva2lkcy9jMjgzOWI4OC1kOTAwLTRmNjktYmRkOS1kZTc0OGRmMjRkOWEvY29sb3JpbmcvY292ZXItZmluYWwtcmVmaXQtMTc4NDM2NjQ0MjczOC5wbmciLCJzY29wZSI6ImRvd25sb2FkIiwiaWF0IjoxNzg0MzY4ODQwLCJleHAiOjE4MTU5MDQ4NDB9.Egznmwri49ZzMp0u6V0jebbMG2wAiHeFvwIJ6QjEczY',
    listing_status='live',
    sellable=true,
    blocker_reason='cover_regen_pending_title_prompt_fix',
    pipeline_status='live',
    metadata = jsonb_set(metadata, '{coloring_current_step_label}', to_jsonb('Reverted to prior verified-title cover; native-ratio regen paused pending title-prompt fix'::text))
where id='c2839b88-d900-4f69-bdd9-de748df24d9a';