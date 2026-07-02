## Goal

1. Live Queue UI: highlight the ebook currently running and show queue position (#1, #2, …) on the rest.
2. Autopilot runs a book end-to-end but **stops before Shopify upload** — final state = `ready_for_shopify` at 100%.
3. Bug list panel: every classified bug shows a **Fix** button (sends a Lovable prompt), plus a **Fix All** button when there are 2+ bugs.
4. Completed ebooks (`ready_for_shopify`) show a manual **Push to Shopify** button. Shopify automation is deferred to the next phase.

## Scope of changes

### A. Highlight + queue numbers (frontend only)
File: `src/components/admin/LiveProductionQueue.tsx`
- `SectionA` ("Currently Working On") card: add a highlighted style — thick accent border, subtle pulse ring, `bg-highlight/40`, `NOW RUNNING` chip on top-right.
- `SectionB` ("Queued Next"): render each row as `#1`, `#2`, `#3` … using `queue_position` if present, else array index+1. Show ETA-style helper: "เริ่มหลังจากเล่มปัจจุบันเสร็จ".
- `SectionC` (Waiting) and `SectionD` (Auto-Fixing): also show numeric position within their group for clarity.
- `FocusBadge.tsx`: same "NOW" pulse styling so the header matches the highlighted card.

### B. Autopilot: stop before Shopify
File: `supabase/functions/autopilot-pipeline/index.ts`
- Update the canonical step list so the pipeline halts after `product_page_qc` + `pricing` finish successfully.
- Skip `shopify_draft`, `shopify_verify`, `final_report` in the default run; leave the functions in place for the manual push.
- On successful stop: set `ebooks.status = 'ready_for_shopify'`, `canonical_status = 'ready_for_shopify'`, `progress_pct = 100`, release `heavy_production` lock so the next queued book starts.
- `_shared/run-tracker.ts` STEP_TO_CANONICAL map: add `ready_for_shopify` terminal state.
- Recovery worker (`autopilot-recovery-worker`): do not auto-advance `ready_for_shopify` ebooks into shopify steps.

### C. Bug list with Fix / Fix All
Files: `src/components/admin/SystemFixCard.tsx`, `src/components/admin/LiveProductionQueue.tsx` (SectionE), new edge function `supabase/functions/system-fix-dispatch/index.ts`.
- SectionE header gets a **Fix All** button when `system_fixes.length >= 2`.
- Each `SystemFixCard` gets a **Fix** button.
- Both call `system-fix-dispatch` which:
  1. Reads the fix instruction row(s) from `system_fix_instructions`.
  2. Formats a Lovable-ready prompt (bug summary + file paths + repro + suggested change already stored in the row).
  3. Copies the prompt to the clipboard client-side AND marks the row `dispatched_at = now()` / `status = 'sent_to_lovable'`.
- Add `dispatched_at` and `status` columns to `system_fix_instructions` if not already present (migration in same phase).
- UI shows a small "Sent to Lovable" badge with timestamp after dispatch.

### D. Push to Shopify button on finished books
Files: `src/pages/admin/EbookReview.tsx` (or wherever the ebook detail actions live — will confirm on entry to build mode), `src/pages/admin/Production.tsx`.
- If `ebook.canonical_status === 'ready_for_shopify'`: show a primary **Push to Shopify** button.
- Button calls existing `shopify-draft-upload` edge function for that single ebook, then flips status to `shopify_uploading` → `live` on success.
- Disabled + tooltip when book is not yet 100%.

### E. Not in scope (deferred to next phase)
- Automatic Shopify draft upload inside Autopilot.
- Shopify quota queue automation improvements.
- Any SEO Phase 2 work.

## Technical notes

- Highlight styling uses existing tokens (`border-primary`, `ring-2 ring-primary/40`, `animate-pulse`) — no new colors.
- Queue positions are read from `admin-data`'s `live_queue` payload; that endpoint already returns `queue_position`, no backend change needed for section A/B.
- The Shopify skip is a single change in the canonical step iterator plus a terminal-status branch — no data migration required beyond adding `ready_for_shopify` as an allowed `canonical_status` value (already `text`, so no enum change).
- `system-fix-dispatch` is a thin edge function; the clipboard write happens in the browser after it returns the prompt string, so the button works even if the user is offline from Lovable chat.

## Acceptance checklist

- [ ] Running ebook card is visually distinct (border + pulse + "NOW RUNNING" chip).
- [ ] Queued ebooks display `#1`, `#2`, … in order.
- [ ] Autopilot completes at 100% with `ready_for_shopify` and never calls shopify-draft-upload automatically.
- [ ] Next queued book starts as soon as the previous reaches `ready_for_shopify`.
- [ ] SectionE shows Fix per row and Fix All when ≥2 bugs; both produce a Lovable prompt and mark the row dispatched.
- [ ] Finished ebooks expose a working "Push to Shopify" button; not-finished ones do not.
