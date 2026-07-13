# Children's Storybook Consistency Lock — Master Add-On

Two deliverables: (A) save the skill so future runs load it automatically, (B) upgrade the existing kids-book pipeline so it actually enforces the Story Bible, character reference sheet, and consistency QC gates you described.

---

## A. Save the skill (persistent, reusable)

Create a workspace skill at `.agents/skills/childrens-storybook-consistency-lock/` and activate it.

- `SKILL.md` with frontmatter:
  - `name: childrens-storybook-consistency-lock`
  - `description: Triggers on any children's novel, illustrated storybook, bedtime story, picture book, early reader, moral story, fantasy story, or educational story. Locks Story Bible, character design, illustration style, palette, cover/interior match, and QC gates so the whole book feels like one coherent illustrated children's book.`
- Body: the full 19-section spec you pasted (Story Bible schema, character design lock, reference sheet, style lock, page-by-page lock, cover/interior prompt templates, QC gates, auto-fix rules, final pass criteria).
- `references/story-bible-schema.md`, `references/prompt-templates.md`, `references/qc-gates.md` for progressive disclosure.
- Apply via `skills--apply_draft`.

Once applied, every future kids-book task auto-loads this skill.

---

## B. Wire it into the live pipeline

Today `supabase/functions/_shared/kids-visual-bible.ts` implements a small "visual bible" (art style + characters) and `generate-cover` / `render-pdf` use it. This upgrade turns it into the full Story Bible + Consistency Lock.

### B1. Expand the Story Bible (`_shared/kids-visual-bible.ts`)
Extend `KidsVisualBible` → `StoryBible` with the fields from spec §2 and §3:
- `book_title, target_age_range, reading_level, story_genre, story_theme, moral_lesson, emotional_tone, world_setting`
- `main_character` + `supporting_characters[]` — each with the full character-lock schema (face/body/eyes/hair/outfit/accessory/proportions/do_not_change)
- `visual_style_guide` (line quality, coloring method, texture, shading, background detail, lighting, edge style, brush style, page composition)
- `color_palette` (primary/secondary/accent/neutral hex)
- `line_art_style, rendering_style, cover_style, interior_illustration_style, typography_style`
- `forbidden_style_drift[], continuity_rules[]`

Store in existing `ebooks.kids_visual_bible` (jsonb — no schema change). Bump an internal `version: 2` field so old rows are auto-upgraded on next read.

### B2. Character Reference Sheet (spec §4)
- New builder `generateCharacterReferenceSheet(bible)` — one image per named character showing front / 3-quarter / expressions / full body / palette swatches. Textless.
- Store URLs on ebook: reuse existing jsonb column (new key `character_reference_sheets` inside `kids_visual_bible`), so no migration needed.
- Gate: if `character_reference_sheets` missing, cover + interior generation refuses to run and calls the builder first.

### B3. Deterministic prompt builders (spec §15, §16)
Replace `kidsIllustrationPrompt()` with two strict builders that inject the full character lock verbatim from the bible + reference-sheet URL as a "match this exact character" clause:
- `buildKidsCoverPrompt(bible, sceneBrief)`
- `buildKidsPagePrompt(bible, page)` where `page` includes scene summary, characters present, emotions, location, continuity notes.

Both hardcode the "do not change face/body/outfit/colors/style" clause and the negative prompt.

### B4. Page-by-page plan (spec §9)
Add `generatePagePlan(bible, chapters)` → array of `PagePlan` (page_number, story_text, scene_summary, characters_present, emotions, location, illustration_prompt, continuity_notes, visual_must_include, visual_must_not_change). Persist to `ebooks.kids_scene_briefs_json` (already exists — just widen the shape).

Wire `generate-interior-visuals` and `render-pdf` to use the plan instead of ad-hoc per-chapter briefs.

### B5. Consistency QC gates (spec §12–14, §19)
New `_shared/kids-consistency-qc.ts` with a single `runKidsConsistencyQC(ebookId)` step that scores 8 dims for character consistency, 5 for style consistency, 5 for story continuity — all via a vision LLM call comparing cover + N interior pages + reference sheet.

- Hard gates: face/body/outfit/color/accessory/style/page-to-page all ≥ 95; cover_to_interior_match ≥ 95; story_continuity ≥ 95; age_appropriateness ≥ 95.
- Writes to `qc_reports` (existing table) with `report_type = 'kids_consistency'`.
- Auto-fix loop (spec §18): on failure, regenerate only the affected image with a stronger character lock, up to 3 attempts. If still failing, mark run `needs_admin_attention` with `blocker_reason = kids_consistency_unrecoverable`.

### B6. Pipeline order
In `supabase/functions/_shared/pipeline-steps.ts` (kids branch), enforce order:
1. Build Story Bible
2. Build Character Reference Sheet(s)
3. Generate page plan
4. Generate cover
5. Generate interior illustrations
6. Run Kids Consistency QC (hard gate)
7. Render PDF (already dedicated square kids template)
8. Package Shopify (already syncs title → ebooks.title)

Non-kids books are untouched.

### B7. Admin UI surfacing (light)
On the ebook review page, if `kids_visual_bible.version === 2`, show a small "Story Bible locked ✓ · Ref sheet ✓ · Consistency QC 96/100" strip so operators can see the lock state at a glance. No new components beyond a status card.

---

## Files touched
- **New skill**: `.agents/skills/childrens-storybook-consistency-lock/SKILL.md` + 3 reference files.
- **New**: `supabase/functions/_shared/kids-consistency-qc.ts`
- **Edited**: `supabase/functions/_shared/kids-visual-bible.ts` (expand schema + prompt builders + ref-sheet + page plan)
- **Edited**: `supabase/functions/generate-cover/index.ts` (use `buildKidsCoverPrompt`, require ref sheet)
- **Edited**: `supabase/functions/generate-interior-visuals/index.ts` (use page plan + `buildKidsPagePrompt`)
- **Edited**: `supabase/functions/render-pdf/index.ts` (consume page plan)
- **Edited**: `supabase/functions/_shared/pipeline-steps.ts` (kids-branch step order + QC gate)
- **Edited (small)**: `src/pages/admin/EbookReview.tsx` (status strip)

No DB schema migration required — everything fits in existing jsonb columns (`kids_visual_bible`, `kids_scene_briefs_json`, `qc_reports`).

## Verification
- Regenerate Barnaby end-to-end: Story Bible + reference sheet appear in DB, cover and all interior pages pass consistency QC ≥ 95, PDF looks like one unified book.
- Try a new kids idea from scratch: pipeline refuses to render cover until reference sheet exists.
- Non-kids book (e.g. business PDF): unchanged behavior, no new steps run.

Confirm and I'll implement.
