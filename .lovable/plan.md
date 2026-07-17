# Coloring autopilot — quota-aware, self-resuming pipeline

## Goal
No coloring book ever silently dies on external quota/billing. Provider exhaustion produces a **distinct state** with a **real scheduled resume**, and interior generation is **paced** so we don't burn Cloudflare's 10k/day allocation in one burst.

## Root causes confirmed
1. **Bursty interior generation**: `coloring-book-render` fires the full production batch (up to 32 pages × ~4 steps ≈ 128 neuron-inferences × several books) in one tick — after 2-3 books it hits CF's 10k/day cap, then FAL fallback is 403 billing-locked, so the whole lane stalls.
2. **Wrong terminal state**: today's stuck books are `pipeline_status='queued'` with a `blocker_reason` string but **no scheduled retry** — the CF latch resumes CF at 00:00 UTC, but nothing wakes these specific books up.
3. **Error classifier gap**: the shared `error-classifier.ts` doesn't yet emit dedicated `cloudflare_neuron_quota` / `fal_billing_locked` signatures; ops UI shows a raw provider string.

## Changes

### 1. New pipeline states + scheduled resume (no schema change; use existing columns)
- Introduce two `pipeline_status` values by convention (string column, no enum): `awaiting_quota_reset` and `awaiting_billing`. Use `next_retry_at` (already on `ebooks_kids` per recovery.ts convention — verify; add via migration if missing) to store the wake time.
- **`awaiting_quota_reset`** (Cloudflare 429 neuron cap, and FAL is also unavailable): `next_retry_at = next UTC midnight + 2 min jitter`. Automatic — no human needed.
- **`awaiting_billing`** (FAL 403 billing-locked while CF is also latched): `next_retry_at = now + 30 min` (cheap re-check; the top-up is external and could happen any moment). Surface a persistent admin toast.
- Extend `coloring-book-render` line ~452 halt branch so instead of leaving `pipeline_status='queued'`, it sets the correct awaiting state based on **which providers are dry** at that moment (`readImageProviderPolicy` return + `readCfBillingLockedUntil` + `provider_billing_blocked.fal.active`).

### 2. Quota-aware interior pacing (Cloudflare-primary path)
- New `_shared/coloring/interior-pacer.ts`:
  - Config in `generation_settings.coloring_autopilot.interior_pacing`:
    `{ cf_daily_neuron_budget: 9500, cf_neurons_per_image: 12, safety_reserve_pct: 5 }` (defaults; safe buffer under the 10k cap).
  - `estimateNeuronsSpentToday(db)` sums today's `cost_log` rows where `provider='cloudflare_direct'` × `neurons_per_image`.
  - `neuronsRemainingToday(db)` returns budget minus spent.
  - `maxCfImagesThisTick(db, requestedBatch)` clamps the per-tick batch to fit remaining budget; when 0, caller should either fall back to FAL for this tick (if fal has budget) or park the book in `awaiting_quota_reset`.
- In `coloring-book-render` before the per-page dispatch loop, cap `plan` slice by `maxCfImagesThisTick` when policy primary is CF. Chain the rest via `selfInvoke` after 15 min (goes through worker-tick which already respects the latch).

### 3. Scheduler wakes up parked books
- Extend the existing `coloring-worker-tick` (already cron-driven) to, in addition to its normal queued sweep, look for rows where `pipeline_status IN ('awaiting_quota_reset','awaiting_billing') AND next_retry_at <= now()` AND the relevant provider is no longer dry, then:
  - Reset `pipeline_status='queued'`, `blocker_reason=null`, and immediately invoke `coloring-book-render` for that book.
- If CF latch has passed (`cf_billing_locked_until < now`) and today is a new UTC day, clear `provider_billing_blocked.cloudflare.active`.

### 4. Shared error classifier signatures
- Add to `_shared/error-classifier.ts` `KNOWN_SIGNATURES`:
  - **cloudflare_neuron_quota**: matches `/daily free allocation/i`, `/neurons/i`, `/workers paid/i` with cloudflare in the message → `error_type: 'quota_wait'`, `suggested_status: 'awaiting_quota_reset'`, `next_retry_at` = next UTC midnight, `needs_code_fix: false`.
  - **fal_billing_locked**: matches `/exhausted balance/i`, `/user is locked/i` → `error_type: 'quota_wait'` (or new `provider_billing_locked` if the union allows), `suggested_status: 'awaiting_billing'`, `needs_code_fix: false`, `user_friendly_message` "Top up fal.ai balance to resume".
- This is the "permanent pattern registration" the owner asked for — future books of any type route through the same routing.

### 5. Rescue the 10 currently-stuck books
- One-shot script via `supabase--insert`:
  - For each `ebook_kids` with `book_type='coloring_book'` AND `pipeline_status='queued'` AND `blocker_reason ILIKE '%daily free allocation%' OR '%user is locked%' OR '%Exhausted balance%'`:
    - Set `pipeline_status='awaiting_quota_reset'` (CF class) or `'awaiting_billing'` (FAL class), `next_retry_at` per above, keep `blocker_reason` for audit trail.
  - The `coloring-worker-tick` cron will then wake them the moment providers recover.

### 6. Regression tests (vitest)
- `src/lib/coloringInteriorPacing.test.ts` — pacer clamps batch, returns 0 when budget spent.
- `src/lib/coloringQuotaStates.test.ts` — classifier maps CF-429-neurons → `awaiting_quota_reset` with `next_retry_at ≈ next UTC midnight`; fal-403-locked → `awaiting_billing`.
- `src/lib/coloringAwaitingWake.test.ts` — worker-tick wake filter picks parked rows whose provider is healthy again and skips those still dry.

### 7. Verification
- Run `bun run test` (new tests must pass).
- After deploy: read `ebooks_kids` where `book_type='coloring_book' AND pipeline_status IN ('awaiting_quota_reset','awaiting_billing')` and confirm all 10 formerly-stuck rows have `next_retry_at` set.
- If FAL is still 403 at run time, that's expected — the owner needs to top up; the awaiting_billing state is the correct terminal-until-resume.

## Non-goals (explicit)
- No QC threshold changes.
- No brute-force retry loops.
- No new secrets required (CF + FAL already configured).
- No changes to picture-book pipeline behavior.

## Files
- **New**: `supabase/functions/_shared/coloring/interior-pacer.ts`, three `src/lib/coloring*.test.ts`.
- **Edited**: `supabase/functions/_shared/error-classifier.ts`, `supabase/functions/coloring-book-render/index.ts` (halt branch + pacing cap), `supabase/functions/coloring-worker-tick/index.ts` (wake sweep + latch clear on new UTC day).
- **Data**: one `UPDATE` on 10 stuck `ebooks_kids` rows.
- **Migration** (only if `next_retry_at` missing on `ebooks_kids`): `ALTER TABLE public.ebooks_kids ADD COLUMN IF NOT EXISTS next_retry_at timestamptz`.

Approve to proceed?
