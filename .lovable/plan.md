## Problem

For kids picture books (e.g. *Barnaby's Wobbly Problem*):
- The cover character and the interior illustrations don't match — different animal, outfit, art style.
- Interior illustrations use the generic abstract "conceptual" planner meant for finance/nonfiction books, so they don't look like a picture book at all.
- The PDF's inner cover and the storefront thumbnail still show the older art.

Root cause: nothing in the pipeline defines a **Character + Style Bible** that both `generate-cover` and `render-pdf` (interior illustrations) read from. Each step invents its own look.

## Fix — Character & Style Lock for Kids Picture Books

### 1. New "Kids Visual Bible" (single source of truth)

Add a new JSON blob `ebooks.kids_visual_bible` (jsonb, nullable) populated once per kids book and reused by every image call:

```
{
  "art_style": "soft watercolor storybook, warm sun-dappled, textured paper feel",
  "palette": ["#F6E3C5","#8FB77A","#D97742","#3B2A1A"],
  "characters": [
    {
      "name": "Barnaby",
      "species": "young brown bear cub",
      "invariant_features": "small round bear cub, warm chestnut-brown fur, cream muzzle, small round black nose, big amber eyes, one tiny chipped front tooth, wears a mustard-yellow knit vest with a red wooden button, blue polka-dot scarf, no shoes",
      "proportions": "toddler-sized, big head, short limbs"
    }
  ],
  "world": "sunlit forest clearing with mossy stones, pinecones, ferns",
  "negative": "no text, no letters, no logos, no photorealism, no dark scary tones, no extra characters not in bible"
}
```

### 2. New shared helper `_shared/kids-visual-bible.ts`

- `isKidsPictureBook(...)` moved here (single definition; cover + render-pdf both import it).
- `buildKidsVisualBible(ebook)` — calls the LLM once with title, chapters, target age; returns the JSON above. Persists to `ebooks.kids_visual_bible`.
- `kidsIllustrationPrompt(bible, sceneBrief, reservedZone?)` — deterministic prompt builder that always injects: full character invariant string, art style, palette, world, negative clause. Guarantees every image request repeats the exact same character description verbatim.

### 3. `generate-cover` — use the bible for the cover

- When `isKidsPictureBook`, before generating the background:
  1. Ensure `kids_visual_bible` exists (build it if missing).
  2. Feed `kidsIllustrationPrompt(bible, "front cover hero scene: Barnaby center-frame, warm afternoon light, reserved top third for title")` into the image call instead of the generic `background_image_prompt_no_text`.
  3. Skip the finance/nonfiction "EBOOK chip + feature chips + dark near-black field" template; use the existing hand-painted-cover path (v4-style logo overlay).

### 4. `render-pdf` / interior illustrations — use the same bible

In `render-pdf/index.ts` (illustration section around lines 110–158) and `_shared/illustration-planner.ts`:

- If `isKidsPictureBook(ebook)`: bypass the finance-style planner entirely. Build one prompt per chapter using `kidsIllustrationPrompt(bible, chapterSceneBrief)` where `chapterSceneBrief` is a 1–2 sentence scene summary generated from the chapter text (LLM, cheap model, cached in `ebooks.kids_scene_briefs_json`).
- Every chapter image request repeats the character invariant verbatim → visual continuity across the whole book.
- Store images under existing `ebook-covers/<id>/illustrations/ch-<n>.png` path (no schema change beyond the new columns).

### 5. Regenerate Barnaby's assets

One-off migration/edge call for `bcbb9b53-ad13-4544-9b18-0aaa03b829ab`:

1. Build `kids_visual_bible` from current title + chapters.
2. Regenerate all chapter illustrations with the locked character prompt.
3. Rebuild PDF via `render-pdf` (this refreshes the inner cover page too).
4. Point `cover_url`, `thumbnail_url`, `store_thumbnail_url` to the new hand-painted cover (keep the v4 logo cover as base — its style already matches the bible we'll seed from it).

## Database changes

```sql
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS kids_visual_bible jsonb,
  ADD COLUMN IF NOT EXISTS kids_scene_briefs_json jsonb;
```

No RLS/grant changes — column additions on existing table.

## Files touched

- new `supabase/functions/_shared/kids-visual-bible.ts`
- edit `supabase/functions/generate-cover/index.ts` (kids branch uses bible)
- edit `supabase/functions/render-pdf/index.ts` (kids branch swaps planner)
- edit `supabase/functions/_shared/illustration-planner.ts` (early-return for kids)
- new migration adding two jsonb columns
- new one-off script/migration to rebuild Barnaby (bible → illustrations → PDF → thumbnail)
- update `mem/index.md` + `mem/design/kids-cover-prompt.md` with the "character-bible-first, every prompt repeats invariants verbatim" rule

## QC / verification

- After rebuild, visually check: cover Barnaby vs. every chapter Barnaby — same fur color, same yellow vest, same scarf, same amber eyes, same art medium.
- PDF inner cover matches storefront cover.
- Storefront thumbnail matches PDF inner cover.

## Future kids books

Every new kids picture book automatically:
1. Builds the visual bible before any image generation.
2. Reuses that bible for cover + every interior illustration.
3. Never falls back to the finance/nonfiction abstract planner.
