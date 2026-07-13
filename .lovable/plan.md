
# QC v2 — "Sellable" Gate, Evidence-Based Scoring, Auto-Repair Loop

Replaces the current cosmetic QC (hard-coded 92/94/96, "cover_url + pdf_url = publish") with an evidence-based system that measures real files, blocks placeholders, and auto-repairs targeted defects.

## Scope

Applies to the kids track (`ebooks_kids`, `autopilot-kids-pipeline`). The adult track keeps its current QC; a follow-up can port the same engine once this proves out.

## 1. New pipeline statuses

Extend `autopilot_kids_runs.status` with the vocabulary you specified:

```
draft → story_qc → character_bible_locked → style_bible_locked →
illustrating → illustration_qc → layouting → layout_qc →
pdf_rendering → pdf_preflight → commercial_qc →
auto_repairing → human_review_required → sellable → published
```

`published` is only reachable from `sellable`. Nothing else can flip a row live.

## 2. Character Bible + Style Bible lock

New table `kids_book_bibles` (one row per book) storing:

- `character_bible_json` — the exact schema you listed (name, face, hair, eyes, skin, spacesuit, helmet, chest_patch, proportions, style, `forbidden_changes[]`)
- `style_bible_json` — medium, mood, palette hexes, lighting, line quality, texture, detail level, negative constraints
- `character_reference_image_url` — the locked reference used as image-to-image seed for every subsequent illustration
- `locked_at`, `locked_by`

Pipeline cannot enter `illustrating` until both bibles exist and `locked_at IS NOT NULL`. Every illustration prompt is built by concatenating the bible JSON + page-specific action, and every image generation call passes the reference image as visual seed.

## 3. Evidence-based QC rules (no hard-coded scores)

New table `qc_findings` — one row per rule check:

```
rule_id, ebook_id, page_number, category,
measured_value (jsonb), threshold (jsonb),
passed (bool), severity ('critical'|'major'|'minor'),
evidence_url (screenshot / bbox crop), repair_action, verification_result
```

Scores are **computed** from findings, never authored by the LLM:

```
category_score = 100 - (weighted penalty from failed rules in that category)
overall_score  = Σ(category_score × weight)   // weights per your table
```

Weights (fixed constants in `_shared/qc/kids-weights.ts`):

```
story_structure 15, age_appropriateness 10, grammar 10,
character_consistency 15, illustration_style 10,
cover_interior_match 10, typography_layout 15,
pdf_preflight 10, commercial_metadata 5
```

## 4. Critical errors (any one = NOT sellable)

Hard-coded rule IDs enforced in `_shared/qc/critical.ts`:

```
TEXT_OVERFLOW, TEXT_CLIPPED, TEXT_OUTSIDE_SAFE_AREA,
MISSING_PAGE, BLANK_UNINTENDED_PAGE, BROKEN_FONT_OR_GLYPH,
IMAGE_MISSING, IMAGE_PLACEHOLDER, INVALID_PDF, FAKE_PDF_MIME_TYPE,
UNREADABLE_TEXT, COVER_TITLE_MISMATCH, CHARACTER_IDENTITY_BREAK,
WRONG_LANGUAGE, COPYRIGHT_PLACEHOLDER, DUPLICATED_PAGE,
PAGE_ORDER_ERROR, CONTENT_UNSAFE_FOR_AGE
```

## 5. Real PDF preflight (`_shared/pdf-preflight.ts`)

Runs on the actual rendered PDF, not on model self-report:

- Download PDF bytes, verify magic header `%PDF-`, reject if `content-type` lies (→ `FAKE_PDF_MIME_TYPE`, `INVALID_PDF`).
- Parse with `npm:pdfjs-dist` → page count matches manifest (→ `MISSING_PAGE`, `DUPLICATED_PAGE`, `PAGE_ORDER_ERROR`).
- For each page: rasterize at 150dpi → screenshot stored as evidence.
- For each text run: real bounding box check
  ```
  x >= safeLeft && y >= safeTop &&
  x + w <= pageWidth - safeRight &&
  y + h <= pageHeight - safeBottom
  ```
  Fails → `TEXT_OUTSIDE_SAFE_AREA` / `TEXT_CLIPPED` / `TEXT_OVERFLOW` with the exact bbox stored in `measured_value`.
- Font checks: embedded? glyph coverage? → `BROKEN_FONT_OR_GLYPH`.
- Body font size ≥ 18pt, line-height 1.30-1.55, ≤ 65 chars/line, orphan/widow detection, no split words across pages.
- Perceptual-hash detect against known placeholder SVG → `IMAGE_PLACEHOLDER`.
- Text extraction empty on a page that should have prose → `UNREADABLE_TEXT`.
- Language detect on extracted text → non-English → `WRONG_LANGUAGE`.

## 6. Visual QC (`_shared/qc/visual.ts`)

- **Character consistency**: CLIP embedding of each interior character crop vs. the locked reference. Cosine distance > threshold → `CHARACTER_IDENTITY_BREAK`.
- **Style consistency**: palette histogram + edge-style metrics per page vs. cover. Deviation > threshold → `illustration_style` finding.
- **Cover-to-interior match**: cover title text OCR vs. `ebooks_kids.title` → mismatch = `COVER_TITLE_MISMATCH`. Palette/style deltas contribute to `cover_interior_match`.

## 7. Sellable gate (`_shared/qc/sellable.ts`)

```ts
sellable =
  overall >= 90 &&
  criticalErrors.length === 0 &&
  all category scores >= 85 &&
  typography_layout >= 95 &&
  character_consistency >= 90 &&
  cover_interior_match >= 90 &&
  pdf_preflight.allPagesRendered &&
  !anyFinding.evidence.matches(placeholderHash)
```

`publish_live` step is rewritten: refuses to run unless `sellable = true`. Existing "has cover_url + pdf_url" shortcut is deleted.

## 8. Targeted auto-repair loop

Replace the current retry-with-fallback loop. New engine in `_shared/qc/repair.ts`:

```
generate → render → detect → classify → targetedRepair → re-render → re-qc
```

Per finding class:

- `TEXT_OVERFLOW`: reflow → shrink font 0.5pt (floor 18pt) → grow textbox → cut paragraph spacing → move to text-only page → LLM-rewrite paragraph shorter preserving meaning.
- `CHARACTER_IDENTITY_BREAK`: regenerate ONLY that page with reference image + tightened prompt + seed lock.
- `illustration_style` mismatch: extract palette from approved cover, regenerate that page with palette clamp.
- `INVALID_PDF` / `BROKEN_FONT_OR_GLYPH`: rebuild from source, embed fonts, convert to sRGB, re-render via secondary renderer.

Limits (enforced in loop):

- 8 attempts per individual error
- 5 full-book QC cycles
- Transient API: 5 retries with backoff 2/5/10/20/40s
- **A `completed_with_fallback` result NEVER counts as pass.**
- When exhausted:
  ```
  status = 'human_review_required'
  production_finished = true
  sellable = false
  blocker_reason = unresolved rule_ids joined
  ```

## 9. Admin QC report UI

`/admin/kids/:id/qc` shows per-book:

- Overall score + SELLABLE/NOT badge
- Critical errors list
- Per-category scores with weights
- Failed-page thumbnails with bbox overlays
- Before/after repair image pairs
- Repair attempt count, AI confidence
- Technical preflight result, final PDF SHA-256
- QC rule version

Action buttons wired to new edge endpoints:
`Auto Repair All`, `Repair Selected Page`, `Re-run Visual Consistency`, `Re-render PDF`, `Compare Cover vs Interior`, `Approve for Sale` (admin override, audit-logged), `Reject and Regenerate`, `Download QC Report` (JSON + PDF).

## 10. Immediate cleanup of current defects

Deletes the current false-pass paths:

- Remove hard-coded `92/94/96` scores in `autopilot-kids-pipeline` and `qc-check`.
- Remove `Object.values(scores).every(v => v >= 85)` short-circuit.
- Remove placeholder-SVG fallback path for covers (it stays as a *repair attempt*, but marks the step failed, never `completed_with_fallback = pass`).
- Backfill: mark every existing kids book whose `cover_url` matches the placeholder hash back to `human_review_required`.

## Files & migrations (technical)

**Migrations**
- `kids_book_bibles` (character + style bibles + reference image, RLS admin-only + service_role)
- `qc_findings` (evidence rows, indexed by ebook_id + rule_id)
- `qc_rule_versions` (rule_id, version, threshold_json — so historical findings stay reproducible)
- Extend `autopilot_kids_runs.status` enum with the 14 new values
- Add `ebooks_kids.sellable boolean default false`, `ebooks_kids.overall_qc_score int`, `ebooks_kids.qc_rule_version text`

**New shared modules**
- `supabase/functions/_shared/qc/critical.ts` — critical rule IDs + detectors
- `supabase/functions/_shared/qc/weights.ts` — category weights
- `supabase/functions/_shared/qc/sellable.ts` — gate function
- `supabase/functions/_shared/qc/repair.ts` — repair strategies
- `supabase/functions/_shared/pdf-preflight.ts` — pdfjs bbox + font + language
- `supabase/functions/_shared/visual-consistency.ts` — CLIP-style embedding via Lovable AI vision
- `supabase/functions/_shared/placeholder-hash.ts` — known placeholder detection

**New edge functions**
- `kids-lock-bibles` — build + lock character/style bibles, generate reference image
- `kids-qc-run` — full evidence-based QC pass, writes `qc_findings`
- `kids-qc-repair` — runs targeted repair for one finding or all
- `kids-qc-report` — assembles admin JSON + downloadable PDF report

**Modified**
- `autopilot-kids-pipeline/index.ts` — new state machine, no fallback-as-pass, calls `kids-qc-run` and `kids-qc-repair`
- `qc-check/index.ts` — evidence-based; removes hard-coded scoring
- `src/pages/admin/KidsAutopilot.tsx` — status badges for new vocabulary
- New `src/pages/admin/KidsQcReport.tsx` — the report view described in §9

## Rollout order

1. Migrations (bibles, findings, statuses, sellable column).
2. Shared modules + pdf-preflight + placeholder-hash.
3. `kids-lock-bibles` + `kids-qc-run` + `kids-qc-repair`.
4. Rewrite `autopilot-kids-pipeline` state machine.
5. Admin QC Report UI.
6. Backfill: re-QC existing kids books, demote placeholders to `human_review_required`.

## Out of scope

- Adult (`ebooks`) pipeline — same engine can be ported later.
- No new AI provider or key; uses existing Lovable AI Gateway for vision embeddings and rewrites.
- No permission/`projects:write` changes needed on Lovable Cloud — that error message in your brief refers to an external tooling account, not this project. All changes here run through the standard migration + edge-function tools.
