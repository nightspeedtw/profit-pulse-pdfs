# OWNER LAW — ONE BOOK AT A TIME (v1, 2026-07-22, PERMANENT)

## Rule
Even when a batch/multi-book command is issued, the pipeline MUST finish
books **one at a time, to completion**. Concurrency across books is
forbidden until the current book reaches a terminal stage
(`publish` or `failed`).

## Order of operations
1. Pick the SINGLE candidate closest to done, ranked by:
   - has `final_pdf_asset_id`  →
   - stage `pdf` → `qc` → `cover` → `interior_render` → earlier →
   - highest interior page count →
   - lowest `stage_attempt_count` →
   - most-recent `updated_at`.
2. Drive that one book through every remaining stage until
   `publish` (success) or `failed` (report + stop).
3. Only then move to the next-closest book.

## Cover provider law (permanent)
Covers use ONLY smart AI:
- `google/gemini-2.5-flash-image` (direct)
- OpenAI `gpt-image-1` (direct)

No Runware, no Ideogram, no Cloudflare fallback for covers. Interior
pages MAY use cheaper providers.

## Failure handling
On failure at any stage: stop, record `last_error`, and REPORT the
problem to the owner. Do NOT silently jump to another book.
