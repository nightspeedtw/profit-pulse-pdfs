# Rewrite Barnaby as a 32-page picture book + rebuild PDF at picture-book trim

Two parts, both scoped to the kids-book branch only. No effect on business/non-fiction ebooks.

## 1. Confirm the picture-book trim

The reference image you uploaded is a square page, which is the standard for illustrated children's picture books. The kids PDF template already uses **8.5 × 8.5 inches** — I'll keep that trim (industry standard, KDP/IngramSpark approved, matches your reference image).

- Kids branch: `@page kb { size: 8.5in 8.5in; margin: 0 }` (already in `pdf-template.ts` `buildKidsPictureBookHtml`).
- Business/nonfiction branch: unchanged A4.
- I'll verify the render-pdf function sends `format: undefined` + `preferCSSPageSize: true` on the kids path so Browserless respects the CSS page size instead of falling back to A4. If it doesn't, that's the actual bug behind the wrong size you saw.

## 2. Rewrite Barnaby into a 32-page picture-book manuscript

Standard 32-page picture book structure (KDP / traditional print):

```
Page 1     Title page (title + author)
Page 2     Copyright
Pages 3-30 14 spreads of the story (illustration + short text per page)
Page 31    "The End" + moral takeaway
Page 32    About the book / back page
```

New edge function `rewrite-kids-manuscript` (POST `{ ebook_id }`) that:

1. Loads the Story Bible (`kids_visual_bible`) so tone, character, world and moral stay locked.
2. Calls the LLM with the "Children's Storybook Consistency Lock" skill to produce a 32-page manuscript:
   - 600–900 total words for ages 4–7
   - 30–70 words per interior page, warm read-aloud rhythm
   - clear beginning → escalating middle → satisfying climax → gentle resolution
   - implicit moral about embracing imperfection (matches the seed hook)
   - each page includes: `page_number`, `story_text`, `scene_summary`, `characters_present`, `emotions`, `location`, `continuity_notes`
3. Persists as `ebooks.kids_page_plan_json` (new jsonb key inside the existing `kids_scene_briefs_json` column — no schema change).
4. Also overwrites `ebook_chapters` for this ebook with 14 rows (one per spread) so the existing render pipeline can read the story text without a schema change.

Then `render-pdf` (kids branch) will:
- Iterate the 14 spreads, each producing 2 physical pages: illustration on the left page, story text on the right page (industry standard picture-book layout).
- Use `buildKidsPagePrompt(bible, page)` for every illustration prompt so all 14 illustrations share the same character + style lock (Barnaby wears the same yellow vest, same face, same fur, same watercolor style on every page).
- Pre-generate + cache all 14 interior images in `inside_illustrations_json` before HTML assembly (same pattern already in place, extended from ~6 to 14).

## 3. Rebuild PDF

After the manuscript rewrite finishes, automatically:
- Re-run `render-pdf` on the kids branch.
- Re-run the storefront `preview_images` extraction so the "Look Inside" carousel refreshes with the new pages.
- Bump `kids_visual_bible.version = 2` if not already there.

## Verification
- New PDF opens at 8.5×8.5in square (not A4) — verified by inspecting page size in the rendered file.
- 32 numbered pages: 1 title, 1 copyright, 28 story pages (14 spreads), 1 "The End", 1 about.
- All 14 illustrations show the same Barnaby (same yellow vest, same watercolor style, same forest world).
- Story reads at ages-4–7 vocabulary, ~750 words, moral about embracing imperfection.
- Product page "Look Inside" shows the first 4 interior spreads with the same style as the reference image.

## Files touched
- New: `supabase/functions/rewrite-kids-manuscript/index.ts`
- Edit: `supabase/functions/render-pdf/index.ts` — kids branch: use 14-spread page plan, ensure Browserless uses CSS page size (kill any A4 fallback).
- Edit: `supabase/functions/_shared/pdf-template.ts` — kids template: two-page spread layout (illustration page + text page), page numbers hidden, title/copyright/end/back pages.
- No DB migration.

Confirm and I'll build it, then trigger the rewrite + re-render for Barnaby.
