## Phase Goal
One admin click → fully autonomous kids-book pipeline that always ends in either **published live** or **exhausted-with-plain-language-reason** — never in `human_review_required`. Add stall self-healing, tighten story-repair prompts, and expose finished books on the public storefront (no payments yet).

## Problem-by-problem fix plan

### 1. Story-gate dead-ends → auto-retire + new concept

**File:** `supabase/functions/kids-one-click-build/index.ts`
- In `pollUntilResolved`, treat `pipeline_status='human_review_required'` **with** `blocker_reason` matching `story_gate|needs_concept|budget_exhausted:story_gate|oscillat` as a terminal `shelved_story` outcome (not a supervisor-poke), so the parent loop moves on to the next concept batch immediately.
- Ensure the shelved child ebook is marked `pipeline_status='retired'` (new value) so it doesn't pollute admin views.
- Raise `MAX_CONCEPT_BATCHES` default to configurable via body (`max_concept_batches`, default 3 fresh concepts / 5 total batches).

**File:** `supabase/functions/kids-repair-story-gate/index.ts`
- Feed the reviser the **verbatim judge critique** for each failing dimension (evidence rows already exist — add `report.evidence[].quote` + `report.evidence[].reason` per failing dim, grouped).
- Add explicit refrain/callback/parent-takeaway templates in the dimensional guidance blocks (rer/emo/buyer) — the current text is already close, tighten it and inject the previous attempt's judge critique so the LLM stops guessing.
- After MAX_ATTEMPTS, set `pipeline_status='retired'` + `blocker_reason='story_gate_retired_for_fresh_concept'` (instead of `human_review_required`), so parent loop's poll classifies it as `shelved_story` and starts a new concept batch.

**File:** `supabase/functions/kids-repair-supervisor/index.ts`
- On `story_gate` budget-exhaustion or oscillation, set `pipeline_status='retired'` (not `human_review_required`). Parent loop will see the shelve marker and rotate concepts.

### 2. Orphaned parent jobs stuck at `concept_preflight`

**Root cause:** the background `runLoop` in `kids-one-click-build` runs inside `EdgeRuntime.waitUntil`. If the worker times out or crashes before the first `saveParent` fires, the parent row is stuck forever at `concept_preflight` with no `parent_job` metadata.

**Fixes:**
- **File:** `kids-one-click-build/index.ts` — write the initial `parent_job` metadata **before** returning from the HTTP handler (not from inside `runLoop`), so a crash mid-loop is still detectable. Move the initial `saveParent` call to before `rt.waitUntil(task)`.
- **New edge function:** `supabase/functions/kids-autopilot-watchdog/index.ts` — scans `ebooks_kids` where `pipeline_status NOT IN ('published','live','retired','exhausted','shelved')` and `updated_at < now() - interval '20 minutes'`; for each, invokes `kids-repair-supervisor` (which resumes or shelves). Idempotent.
- **DB migration:** enable `pg_cron` + `pg_net` if not enabled; schedule the watchdog every 10 minutes.
- **Cleanup insert:** mark the two named rows (5593b3e4…, 0b781246…) with `pipeline_status='retired'`, `listing_status='draft'`.

### 3. PDF/vision defects — verify auto-repair loop

- `kids-build-picture-pdf`, `kids-final-text-repair`, `kids-global-style-fallback` are already wired into the supervisor. Bump `MAX_PER_CLASS.pdf_glyph` from 1 → 2 and `character_identity` from 2 → 3 so a single glyph or style regression doesn't shelve.
- Confirm `IMAGE_MISSING` from PDF preflight surfaces as `blocker_class='qc_missing'` — add explicit detection: if any interior page has no image, classify as `character_identity` (triggers global-style-fallback rebuild). Add branch in `detectBlocker`.

### 4. Admin UI simplification

**File:** `src/components/admin/BuildKidsBookButton.tsx`
- Simplify to a single primary button labeled **"สร้างหนังสือ + ขึ้นขาย (Auto)"** — no dialog, no tone/length/theme knobs. On click: call `kids-one-click-build` with defaults (age 4-6, all default lanes). Keeps advanced dialog behind a small "Advanced…" text link.

**File:** `src/pages/admin/KidsAutopilot.tsx` — verify the existing runs table shows: title, plain-language stage (already via `friendlyLabel`), QC score, live product link + PDF link when done, plain-language reason on failure. Minor tweaks only.

### 5. Public storefront visible without payments

**File:** `src/pages/Kids.tsx` — already queries `listing_status='live' AND sellable=true`. Verify product card links go to `/product/:id`.

**File:** `src/pages/Product.tsx` — audit: replace any Stripe/checkout CTA with a disabled placeholder button "Coming soon — checkout" so live books display without requiring payment infra. Preview / cover / title / description / price all render.

### 6. Deploy

Deploy in one batch: `kids-one-click-build`, `kids-repair-story-gate`, `kids-repair-supervisor`, `kids-autopilot-watchdog` (new).

---

## Acceptance
Single click on the admin button → within ~30 min the parent run resolves to `published` with `pdf_url`, `cover_url`, `thumbnail_url` populated, `listing_status='live'`, `sellable=true`, book appears on `/kids`. If not, the run row shows a plain-language reason and the book row is `retired` (never `human_review_required`).

## Non-goals
- No payment/checkout wiring.
- No QC threshold changes.
- No Shopify.
