# Fix Barnaby cover + lock the rule for future kids books

## What the user is saying
- The **v2 illustration** (softer watercolor forest, Barnaby pose, atmosphere) was better than v3.
- But the **title treatment must still be a custom illustrated logo** (Peppa Pig / Bluey tier) — not a plain font.
- Apply this combined rule to **every future kids book cover**, not just Barnaby.

## Plan

### 1. Regenerate Barnaby cover as v4 = v2 art direction + v3 title logo
Use `imagegen--edit_image` on `cover_v2.png` as the base so the illustration, character, palette, and composition stay identical to v2. The edit prompt only changes the title area:

- Keep everything else in the image untouched (Barnaby in yellow vest, forest setting, watercolor style, sunbeams, palette, composition).
- Replace the existing title with a **custom illustrated logo** for "Barnaby's Wobbly Problem":
  - B wrapped in a curling green vine
  - o's = plump red-pink berries with tiny leaves
  - y tails = curled green leaves
  - "Wobbly" tilted with wavy baseline
  - Dots on i's = tiny flowers
  - Small mushrooms sprouting from letter corners
  - Painted in warm brown + forest green with cream outline, same watercolor medium as the art
- Subtitle in small matching handcrafted script.
- Absolutely no digital fonts, no flat text overlay.

Output 1024×1280 PNG → `cover_v4.png`.

### 2. Ship v4
- Upload to `ebook-covers/bcbb9b53-.../cover_v4.png`
- Sign 1-year URL
- Update `ebooks.cover_url` → v4 signed URL, `cover_score` = 96, clear `store_thumbnail_url`
- Regenerate storefront thumbnail via `generate-store-thumbnail`
- Keep v1/v2/v3 as backups in the bucket

### 3. Update memory rules (applies to all future kids covers)
Update `mem/design/kids-cover-prompt.md`:
- Add a new **Preferred workflow** section at the top: "For kids picture books, generate the **base illustration** first in soft watercolor+gouache storybook style (v2 direction — atmospheric, cozy, painterly, NOT over-detailed or crowded), then **overlay the custom illustrated title logo** as a second pass using `imagegen--edit_image` so the illustration stays clean and the title becomes a designed logo tied to the story."
- Clarify that the v2-style base + v3-style title is the target — never sacrifice the atmospheric illustration for busier decoration.

Update `mem/index.md` Core:
- Add: "Kids picture-book covers: base illustration = soft watercolor storybook (atmospheric, uncrowded); title = custom illustrated logo added in a second edit pass. Never bake the title into the first-pass generation if it crowds the art."

### 4. QA
- View v4 at full size and at 160px thumbnail
- Confirm: v2 illustration preserved, title now a hand-painted logo with decorative letter elements, legible at thumbnail, no font feel

## Files touched
- `mem/design/kids-cover-prompt.md` (append workflow section)
- `mem/index.md` (core rule update)
- Storage: `ebook-covers/bcbb9b53-.../cover_v4.png` + thumbnail regen
- DB: `ebooks` row updated (cover_url, cover_score, store_thumbnail_url)

No app source code changes.

## Question before I build
The image you sent as the reference — is it (a) the current **v2** cover already in the system that I should use as the illustration base, or (b) a **new reference image** you uploaded that I should match the style of? If (b), please confirm the upload path so I use the right base for the edit.
