
-- Rule 1 backfill: demote overlay-based coloring covers to draft so the
-- autopilot regenerates them via the ideogram-only integrated typography
-- path (Tier-2 overlay fallback has been removed from coloring-book-cover).
UPDATE public.ebooks_kids
SET
  listing_status = 'draft',
  sellable = false,
  pipeline_status = 'queued',
  blocker_reason = 'coloring_publish_contract:cover_style_violation:typography_source=textless_art_plus_svg_overlay'
WHERE book_type = 'coloring_book'
  AND listing_status = 'live'
  AND (
       (metadata->'coloring_cover'->'title_treatment'->>'typography_source') = 'textless_art_plus_svg_overlay'
    OR (metadata->'coloring_cover'->'measured_gate'->'scorecard'->'evidence'->>'typography_source') = 'textless_art_plus_svg_overlay'
  );
