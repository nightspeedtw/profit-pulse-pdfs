
# Kids Pipeline Hardening — 6 Gates + Repair + Acceptance Run

The 5 defects the owner found in Detective Pip (old cover in PDF, solid-black page, 3 mixed art styles, "Page 28" caption, cover/story mismatch) are all symptoms of missing enforcement in the assembly and QC stages. This plan installs each gate as code, then uses those gates to either honestly republish or retire dc037de5, then runs one clean end-to-end build as the acceptance test.

---

## Part A — Install the 6 gates

### Gate 1: COVER SPLICE (in `kids-build-picture-pdf`)
- Right before PDF assembly, re-fetch `ebooks_kids.cover_url` (the versioned URL) and download bytes.
- Assert bytes exist, `content-type` starts with `image/`, `content-length > 30 KB`, and image is non-monochrome (reuse Gate 2 luminance check).
- Always render this cover as page 1. Never trust a cached page 1.
- After every `kids-repair-cover` success, enqueue `kids-build-picture-pdf` automatically so an existing PDF is rebuilt with the new cover (the current bug: cover was updated, PDF was not).

### Gate 2: BLACK/BLANK PAGE GATE (deterministic)
- New shared helper `_shared/image-luminance.ts`: decode PNG/JPEG (use `npm:sharp` or the existing decoder in the project), compute mean luminance and variance on a downsampled 64×64 grid.
- Reject when `variance < 200` OR (`mean < 12` (near-black)) OR (`mean > 243` (near-white)) OR (`variance < 400 AND |mean-128| < 8` (flat gray)).
- Applied in two places:
  1. `kids-render-interior` — after each page render; failure → immediate re-render (max 2 retries), then mark the page for supervisor repair.
  2. `kids-build-picture-pdf` — rasterize each page of the final PDF (via pdfium/pdf.js already used in the project, or re-check the source PNGs which are the same bytes) and hard-fail assembly on any dead page.

### Gate 3: ONE-STYLE-PER-BOOK
- Migration: add `style_fingerprint TEXT` to whatever table stores per-page interiors (likely `ebook_assets` for kids, or `ebooks_kids.interior_manifest jsonb`). Also add `style_anchor_fingerprint TEXT` to `ebooks_kids`.
- Fingerprint = `sha1(style_bible_id || ':' || model_id || ':' || style_preset_id)`.
- On page write, store fingerprint. On `kids-repair-supervisor` / RESUME: any page whose fingerprint ≠ book's `style_anchor_fingerprint` is regenerated, not reused.
- The anchor is set once at first successful render and is what the cover matches.

### Gate 4: TEXT-TO-PAGE MAPPING GATE (in `kids-build-picture-pdf`)
- Load the current `manuscript_md` and split to `pages[]` using the same splitter the writer uses.
- For every page in the interior manifest, assert `page.caption_text.trim() === manuscript.pages[page.index].text.trim()`.
- Regex-detect placeholders: `/^Page\s+\d+\s*$/i`, empty strings, lorem-ipsum → hard fail.
- On fail: repair the single page's text and rebuild that page only.

### Gate 5: QC ON RENDERED PDF (in `kids-qc-run`)
- Change source of truth from per-page interior PNGs to rasterized pages of `pdf_url`.
- Rasterize with pdfium (already a dep) at 150 dpi and feed those images to the vision judge.
- Add hard scorecard deductions that cap score:
  - Any dead page (Gate 2) → cap 30.
  - Any style mismatch (Gate 3) → cap 40.
  - Any text mismatch (Gate 4) → cap 40.
  - Cover art missing character or lettering illegible → cap 50.
- Investigate: run `kids-qc-run` history for dc037de5 and log which checks returned pass; write the diagnosis into `pipeline_skills` as `qc_lessons/detective-pip-100` so the skill-learner remembers.

### Gate 6: COVER-INTERIOR STORY MATCH
- In the cover generation path (`generate-cover` / kids branch inside `kids-repair-cover`), require inputs to come from `ebooks_kids.manuscript_md` (final), not `concept_draft`. Read the manuscript, extract protagonist, setting, one hero moment; feed those into the cover prompt and the subtitle line.
- Persist `cover_prompt_source='manuscript@<hash>'` alongside the cover asset.
- Reject cover if subtitle contains any concept-only entity absent from the manuscript.

---

## Part B — Repair or retire Detective Pip (dc037de5)

1. Run the hardened `kids-repair-supervisor` on dc037de5:
   - Splice current cover (Gate 1)
   - Regenerate solid-black p12 (Gate 2)
   - Regenerate p6/p21 (off-style vs. anchor) in the anchor style (Gate 3)
   - Fix p31 caption "Page 28" (Gate 4)
   - Regenerate cover subtitle + scene from manuscript (Gate 6)
2. Re-run hardened `kids-qc-run` on the freshly assembled PDF.
3. Decision:
   - If honest score ≥ 90 → set `sellable=true`, `listing_status='live'`.
   - If < 90 after 2 repair passes → mark `retired` and rotate.

## Part C — Clean acceptance run

- Fire `kids-one-click-build` with defaults, empty inputs, hands-off.
- Monitor the run steps in `autopilot_kids_steps` and report per-stage: concept → story → interiors (one style) → cover (from manuscript) → PDF (with spliced cover, no dead pages, correct captions) → QC (rendered pages) → live.
- Do not touch the run mid-flight. Report final `pdf_url`, `cover_url`, `listing_status`, honest QC score.

---

## Technical notes

- Migration for style fingerprint fields runs first (schema change is a prereq of Gate 3).
- pdfium rasterization: reuse whatever's already imported by `kids-build-picture-pdf`; if not present, add `npm:@cantoo/pdf-lib` for assembly and `npm:pdfjs-dist` for rasterization.
- All gate failures must chain into `kids-repair-supervisor` (fire-and-forget), never leave a book in `human_review_required` — per project rule #2.
- Never lower a threshold to make a book pass — per project rule #1.

## Files to touch

- `supabase/functions/kids-build-picture-pdf/index.ts` (Gates 1, 2, 4)
- `supabase/functions/kids-render-interior/index.ts` + `_shared/kids-interior.ts` (Gates 2, 3)
- `supabase/functions/kids-qc-run/index.ts` (Gate 5)
- `supabase/functions/kids-repair-cover/index.ts` and/or `generate-cover/index.ts` (Gates 1, 6)
- `supabase/functions/kids-repair-supervisor/index.ts` (Gate 3 resume logic, chaining)
- New: `supabase/functions/_shared/image-luminance.ts`, `_shared/style-fingerprint.ts`, `_shared/pdf-rasterize.ts`
- Migration: `style_fingerprint`, `style_anchor_fingerprint`, `cover_prompt_source`

## Estimated size

~1.5–2k lines changed across 8 edge functions + 1 migration. Multi-turn. After Part A deploys, Part B and Part C are shell + monitoring turns.

**Approve this plan and I'll start with the migration and Gate 2 (cheapest, unblocks everything else), then Gates 1/4 in the PDF builder, then 3/5/6, then repair dc037de5, then fire the acceptance run.**
