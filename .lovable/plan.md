
## Goal
Complete the 3 unblocked coloring books (Fierce Sea Animals, Cute Cozy, Fierce Floral) to LIVE, then report total token/credit usage including Lovable credits.

## Provider tiering (per your directive)

**Covers (high accuracy required):**
- Tier 1: `gpt-image-1` (OpenAI direct) — $0.04/img, 3/3 spelling pass
- Tier 2: Ideogram via Runware (`ideogram:4@1`) — $0.06/img
- Tier 3: Runware base model / Cloudflare — emergency

**Interior coloring pages (line art, cheaper models fine):**
- Tier 1: Runware (fast, cheap ~$0.005-0.01/img)
- Tier 2: Cloudflare Workers AI (flux-schnell, near-free)
- Tier 3: fal.ai (only if others exhausted)

This matches your instruction: coloring interiors are simple line art and don't need premium models — reserve GPT Image budget for covers only.

## Execution steps

1. **Verify interior routing already prefers cheap tier.** Read `_shared/coloring/page-generator.ts` (or equivalent) + `_shared/image-providers.ts` to confirm interior lane = Runware → Cloudflare → fal, and cover lane = GPT Image → Ideogram/Runware → fal. Patch if the interior lane is accidentally hitting GPT Image.

2. **Kick the 3 books through the pipeline sequentially** (one at a time to avoid retry storms):
   - Reset `coloring_cover_invocations=0`, clear `blocker_reason`, set `focus_run=true`, `qc_mode='learning'` on each (already done for the 3).
   - Invoke `coloring-worker-tick` with `{ focus: true }` in a loop, polling `ebooks_kids` status every ~60s.
   - Cap total wait at ~15 min per book. If a book stalls on a specific gate, log the reason and move on (Batch Learning Mode already permits this).

3. **Verify LIVE state for each book:**
   - `listing_status='live'`, `sellable=true`, `pdf_url`, `cover_url`, `thumbnail_url` all populated.
   - Cover uniqueness (dHash) + spelling (v3) gates passed or waived-with-defect logged.

4. **Report token/credit usage** in a single summary:
   - **Lovable credits**: `credits--get_credit_balance` — current balance, used this period, delta vs before this run.
   - **Runtime AI $ cost**: `cost_log` grouped by provider (gpt_image_direct, runware_direct, cloudflare, ideogram, gemini_direct, openai_direct, lovable_gateway) for the last 24h and specifically the window of this run.
   - **Per-book breakdown**: cost per book (cover attempts, interior pages, QC calls).
   - **Cover Tier-1 pass rate**: fresh sample of GPT Image attempts from `coloring_book_events`.

## Guardrails
- Retry ceiling (5 cover invocations/book) stays enforced — no new $118 storm.
- If GPT Image fails 2× on a book, auto-fallback to Ideogram (already wired).
- No threshold lowering; waived defects logged to ledger per Batch Learning Mode.
- One book at a time through the worker (dispatcher cooldown 90s already active).

## Deliverable
Chat reply with:
- LIVE/blocked status for each of the 3 books.
- Full cost table (Lovable credits + runtime $ by provider + per-book).
- GPT Image pass-rate update.
- Next recommendation.
