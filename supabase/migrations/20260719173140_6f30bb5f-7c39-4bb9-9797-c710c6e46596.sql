REVOKE EXECUTE ON FUNCTION public.prune_coloring_book_metadata_bloat(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_coloring_book_metadata_bloat(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.prune_coloring_book_metadata_bloat(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prune_coloring_book_metadata_bloat(uuid) TO service_role;