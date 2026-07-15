
# Owner Editorial Review → 6 Permanent Skills + Book Repair

Owner graded live book 27a1fe60 68/100 while final QC gave 100 — every issue is a missing gate. Plan: encode six skills as pipeline_skills rows, wire each as a deterministic gate + repair reaction, then apply to 27a1fe60.

## Part 1 — Encode 6 skills (pipeline_skills, source='learned')

| Skill | Rule | Gate (where) | Reaction |
|---|---|---|---|
| A. Text-safe frame | ≥36pt margin from trim for body/title text; ≥18pt for folios; shrink-to-fit (step down to 14pt min, then wrap, never clip); line-height 1.3–1.5; text block ≤65% page width; panel padding ≥16pt | `text_safe_frame_gate` — bbox check at every PDF stamp (title page, captions, bonus pages) | Re-layout: shrink font → wrap → repaginate. Never publish with clipped text. |
| B. Integrated caption treatment | Story text sits in reserved lower-third with translucent tinted panel (palette-derived, 85–92% opacity, feathered), warm dark-brown text (#3a2a1e), 16–20pt, rounded friendly font. Onomatopoeia stays as in-art lettering. | `caption_integration_gate` — captions never rendered as stark #FFFFFF rects | Re-render PDF with new `drawCaptionOverlay` (palette-tinted) |
| C. Character sheet lock (mandatory) | Before interiors: generate multi-pose character sheet (front/side/action + swatches + proportions); QC once; pin sheet URL into EVERY page prompt. Per-batch verify uses SHEET as reference with strict species/face/proportions rubric matching final QC. | `character_sheet_required_gate` before interior_build; `character_match_gate` per batch page | Missing sheet → run `kids-build-character-sheet`; page fail → regenerate that page with sheet |
| D. No title echo in interior | Vision transcription per batch page; any interior containing title words or lettering fails that page | `interior_title_echo_gate` in batch verify | Regenerate offending page via `kids-regenerate-offmodel-pages` |
| E. Text completeness pre-render | Every page segment ends with `. ! ?`; not ending in conjunction/article ("and","but","a","the","for","to","of"); complete sentence; runs at segmentation time (free, pre-illustration) | `page_text_completeness_gate` in segmenter | Extend segment from next paragraph or trim to prior sentence boundary; if unfixable, rewrite via `rewrite-kids-manuscript` |
| F. Sellability + bonus pages | Every book gets +2 bonus pages before back cover: (1) "Can You Spot the Clues?" — auto-extracted key objects from manuscript + 1 prompt Q; (2) "Talk About the Story" — 4 discussion Qs from theme. Positioning copy must name developmental value. Page-count gate +2. | `bonus_pages_present_gate` at pdf_prepare; `positioning_copy_developmental_value_gate` at storefront copy | Auto-generate bonus pages via new helper `buildBonusPages`; storefront copy re-gen with developmental-value directive |

## Part 2 — Code changes

### New/updated files
- `supabase/functions/_shared/kids-picture-pdf.ts`
  - Rewrite `drawCaptionOverlay`: palette-tinted panel (accept `paletteHint`), warm-ink text, rounded feathered look via multiple stacked rects w/ decreasing opacity.
  - Rewrite `addTitlePage`: shrink-to-fit (measure width, step 34→28→22→18→14; then wrap).
  - New `addBonusSpotCluesPage(doc, clues[])` and `addBonusDiscussionPage(doc, questions[])`.
  - New `assertTextSafeBox(text, font, size, x, y, maxW)` helper used everywhere text is stamped.
- `supabase/functions/_shared/kids-segments.ts` (or wherever page text is finalized)
  - Add `validatePageTextCompleteness(segments)` — fails on non-terminal punct / trailing stopwords; auto-repair by pulling from next segment.
- `supabase/functions/_shared/kids-vision-qc.ts`
  - Per-batch page prompt: compare against `character_sheet_url` (new arg); rubric fields: species_match, face_match, proportions_match, palette_match, accessories_match, human_like_body (must be false), title_text_present (must be false).
- `supabase/functions/kids-build-character-sheet/index.ts` (NEW)
  - Generate a 4-pose sheet from the cover-style prompt + character bible; store on `ebooks_kids.character_sheet_url` (add column via migration).
- `supabase/functions/kids-render-interior/index.ts`
  - Gate: refuse to start if `character_sheet_url` missing → invoke build-sheet, then continue.
  - Pin sheet URL into every page prompt as a locked reference alongside cover.
  - After batch verify, apply new gates (title-echo + character-sheet-match); reaction routes to `kids-regenerate-offmodel-pages`.
- `supabase/functions/kids-build-picture-pdf/index.ts`
  - Insert bonus pages before "The End".
  - Assert text-safe frame on every stamped page; if fail → shrink-to-fit path.
- `supabase/functions/_shared/story-craft-skill.ts` + `supabase/functions/kids-generate-storefront-copy/index.ts`
  - Add "developmental-value line required" directive to description/preview generation.
- New helper `supabase/functions/_shared/bonus-pages.ts`
  - Extract clues (concrete nouns repeated ≥2× in manuscript) + generate 4 discussion Qs via Lovable AI.

### Migrations
1. `pipeline_skills` inserts for skills A–F (id, key, rule, source='learned', version).
2. `ebooks_kids` add column `character_sheet_url text`.
3. Update page-count expectation: assembly gate uses `illustrations + 4 + 2` (bonus).

## Part 3 — Apply to 27a1fe60 (Detective Pip)

1. Build character sheet from best on-model pages (owner-implicit: not 5,8,11,17,23,29). Pick highest-agreement fingerprint pages.
2. Regenerate off-model pages: 5, 8, 11, 17, 23, 29.
3. Regenerate title-echo pages: 7, 9, 10, 14, 21.
4. Fix truncated segments on pages 24, 27, 30 — extend from next paragraph or complete via rewrite; re-layout shrink-to-fit.
5. Fix clipping on title page (shrink-to-fit).
6. Cover: regenerate via `kids-repair-cover-from-interior` with directive "Pip centered/prominent, holding magnifying glass and detective bag".
7. Append 2 bonus pages (Spot the Clues: pebble, thimble, blue ribbon; Talk About: empathy/problem-solving).
8. Re-render full PDF with SKILL B caption treatment; re-run QC with upgraded rubric; keep live only on pass.
9. Update storefront copy to include developmental-value line.

## Part 4 — Audit table (post in reply)

Extend the gate/reaction table with rows for text_safe_frame, caption_integration, character_sheet_required, character_match, interior_title_echo, page_text_completeness, bonus_pages_present, positioning_copy_developmental_value — all marked WIRED.

## Assumptions (flag for correction)
- Character sheet is stored as a single composite PNG at `ebooks_kids.character_sheet_url` (add column). If you prefer a JSONB with multiple pose URLs, say so.
- Bonus-page clue extraction uses a lightweight LLM call (Gemini flash via gateway) — cost is one extra call per book.
- Batch stays running throughout; changes apply to books not yet at interior_build. In-flight books at later stages will be repaired opportunistically by the supervisor when they hit the new gates.
- I will NOT rewrite the entire manuscript for 27a1fe60 — only complete the 3 truncated segments and shrink-to-fit layout.

Ready to implement on approval.
