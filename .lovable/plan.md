## Goal
Make Coloring V2 permanently run one book at a time for heavy production, so it cannot spread interior rendering across many books and burn Cloudflare credits before one book finishes.

## Confirmed current state
- Autopilot config already says `daily_cap: 1` and `max_in_flight: 1`, but that only limits new book creation.
- Existing backlog still has many active books: `317 page_plan`, `116 interior_render`, `1 qc`, plus live cover-sweep leftovers.
- The tick dispatcher uses `MAX_SLOTS = 1`, but it selects the oldest idle active book, not the single closest-to-done book required by the owner law.
- Stage functions self-chain with `fireStage()`, so multiple books can continue independently after earlier invocations started them.
- Some books have more than 32 interior assets despite `page_count = 32`, which confirms duplicate/parallel render activity has already happened.

## Permanent fix
1. **Add a production lease before any heavy spend**
   - Use the existing backend lock pattern (`try_acquire_lock` / `release_lock`) with one lock name for Coloring V2 heavy production.
   - Every spend-heavy stage must acquire the same lock before running:
     - page plan handoff into interiors
     - interior render
     - cover
     - QC/PDF/publish handoff if they dispatch more work
   - If another book holds the lock, the function returns `waiting_for_lock` without calling AI/image providers.

2. **Make the dispatcher choose the correct single book**
   - Change `coloring-v2-tick` selection to follow the owner law:
     ```text
     final_pdf_asset_id exists
     → pdf
     → qc
     → cover
     → interior_render with most completed pages
     → page_plan
     → style_bible/concept/queued
     ```
   - Do not dispatch queued/newer books while any older/closer active book is unfinished.

3. **Stop self-chaining from bypassing one-book mode**
   - Update `fireStage()` to include and respect a `chain_owner_book_id` / run token.
   - Stage functions will only chain if they still own the active production lock.
   - This prevents old invocations from continuing another book after the dispatcher has selected a different owner.

4. **Interior renderer hard tripwire**
   - Before every image call, re-check:
     - book is still `interior_render`
     - current book holds the active lock
     - exact page is not already rendered
     - logical page count has not exceeded `page_count`
   - If page assets already exceed the expected count, park the book as `needs_code_fix`/failed with evidence instead of spending more.

5. **Backlog repair without deleting evidence**
   - Do not delete duplicate assets.
   - For books with duplicate interiors, select the latest valid asset per page as canonical for PDF building.
   - Reset only the single closest-to-done book to continue; leave the rest waiting for the lock.

6. **Regression coverage**
   - Add tests that prove:
     - tick ranks one closest-to-done book, not oldest/random
     - render-page refuses to spend without the lock
     - self-chaining does not bypass the lock
     - duplicate interior assets do not trigger more rendering

7. **Deploy + resume carefully**
   - Deploy only the touched Coloring V2 functions.
   - Clear stale locks/latches only as needed.
   - Resume from the closest-to-done book and verify logs show one book/page chain at a time.

## Files likely to change
- `supabase/functions/coloring-v2-tick/index.ts`
- `supabase/functions/coloring-v2-render-page/index.ts`
- `supabase/functions/coloring-v2-page-plan/index.ts`
- `supabase/functions/_shared/coloring-v2/state.ts`
- Small shared helper/test files for ranking and lock enforcement

## Acceptance criteria
- At most one Coloring V2 book can enter image-spending stages at any time.
- No queued/newer book starts while an active book is unfinished.
- Old self-chained invocations cannot continue unless they hold the lock.
- Cloudflare cost logs after deployment show one book progressing page-by-page, not many books in parallel.
- Existing evidence/assets are preserved.