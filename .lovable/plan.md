## Plan: Resume overnight book production (One-Book-At-A-Time)

**Goal**: Continue publishing coloring books, starting with those closest to done, without stopping — report only if a blocker appears.

### Order of operations (per OWNER LAW)
1. Rank candidates: `final_pdf_asset_id` present → stage `pdf` → `qc` → `cover` → `interior_render` → earlier stages → highest page count → lowest `stage_attempt_count` → newest `updated_at`.
2. Drive one book to `publish` (or `failed`), then move to the next.

### Steps
1. **Query state**: pull top 20 candidates by the ranking above from `coloring_v2_books` (exclude `live`/`failed`).
2. **Trigger `coloring-v2-tick`** repeatedly (bounded 6 slots per call) to advance the closest-to-done books. Cloudflare-only interiors; Gemini/OpenAI for covers (illustrated-only v12 + lettering v13).
3. **Per-book drive**: for the #1 candidate, invoke the exact stage function (`coloring-v2-cover`, `coloring-v2-qc`, `coloring-v2-pdf`, `coloring-v2-publish`) until it reaches `live` or hard-fails.
4. **Failure handling**: on 3rd consecutive stage attempt failing → park the book (record `last_error`) and **report the blocker to the user** with book id, stage, and error class. Do not silently skip.
5. **Loop**: after each `live`, pick the next-closest and repeat.
6. **Budget guard**: respect the $300/day paid ceiling and Cloudflare quota. If CF quota exhausts → stop and report.

### Non-goals
- No code changes to pipeline logic, laws, or providers.
- No threshold lowering, no gate bypass, no manual QC edits.
- No new features — production drive only.

### Reporting
- Each `live` book: id, title, page count.
- Any blocker: book id, stage, error, suggested next action (A/B options).
