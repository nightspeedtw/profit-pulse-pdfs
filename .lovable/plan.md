# Translate leftover Thai stored content to English

## Root cause

The earlier English sweep only fixed code strings. The product page pulls **stored content** from the database that was generated in Thai during a prior run:

- `ebooks.hook_description` and `ebooks.cliffhanger_hook` → shown as the product description block.
- `ebooks.inside_illustrations_json.{page}.text` → shown in the Story Preview reader (captions are English, body text is Thai).
- Possibly the same fields on other legacy books and the `ebooks_kids` mirror.

Fields already in English on this book: `product_description`, `long_description`, `short_hook`, `selling_hook`, `preview_blurb`, `shopping_card_description`, `meta_description`.

## Fix

1. **Add a one-off backfill edge function** `backfill-translate-en` (admin-only, `verify_jwt=false` gated by service role check) that:
   - Iterates every row in `ebooks` and `ebooks_kids`.
   - For each row, scans these text fields: `hook_description`, `cliffhanger_hook`, `short_hook`, `selling_hook`, `preview_blurb`, `product_description`, `long_description`, `shopping_card_description`, `meta_description`, `seo_title`, `seo_meta`, `who_it_is_for`, `preview_blurb`, plus every `text` and `caption` inside `inside_illustrations_json` and `worksheet_previews_json`.
   - Detects Thai by regex `/[\u0E00-\u0E7F]/`. If found, calls Lovable AI Gateway (`google/gemini-2.5-flash`) with a strict "Translate to natural children's English, keep names, do not add commentary" prompt.
   - Writes translated values back in place; leaves already-English fields untouched.
   - Emits a JSON summary `{books_scanned, fields_translated, errors}`.
2. **Trigger it once** via `supabase--curl_edge_functions` after deploy; verify `bcbb9b53-...` no longer contains any `\u0E00-\u0E7F` codepoints.
3. **Prevent regressions** at generation time: add an "English only, no Thai" instruction line to the kids manuscript + illustration-caption prompt templates (`rewrite-kids-manuscript`, `autopilot-kids-pipeline`, and any prompt that produces `hook_description`/`cliffhanger_hook`). This is a one-line safety net so newly generated books can't reintroduce Thai.

## Verification

- Curl the backfill function → returns non-zero `fields_translated`.
- Reload `/product/bcbb9b53-...` — description block and every Story Preview page render in English.
- Spot-check 2 more listed books via SQL for any remaining Thai codepoints.

No schema changes, no UI changes.