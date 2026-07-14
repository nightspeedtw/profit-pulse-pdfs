# Kids Pipeline Cost Instrumentation + Savings Plan

Goal: measure real cost per book, then cut image spend from ~$2.3–2.6 to ~$0.8–1.2/book by routing around gateway markup, batching vision QC, and enforcing model tiering. Zero change to quality gates, thresholds, image resolution, or reference-conditioning.

Do NOT touch the in-flight run for ebook `1078077b` (Detective Dot).

---

## 1. Shared cost-logging helper + price table

New file `supabase/functions/_shared/cost-log.ts`:
- `PRICE_TABLE` constant with per-1K-token in/out rates and per-image rates:
  - `google/gemini-3.1-pro-preview`: in $1.25 / out $10 per 1M
  - `google/gemini-2.5-flash` / `2.5-flash-lite` / `3-flash-preview`: in $0.075 / out $0.30
  - `google/gemini-3.1-flash-image` (Nano Banana 2): $0.067 / image @ 1K
  - `google/gemini-2.5-flash-image`: $0.039 / image
  - `google/gemini-2.5-pro` (vision QC): in $1.25 / out $10
  - `fal-ai/flux/schnell`: $0.003 / MP
  - `fal-ai/recraft-v3`: $0.04 / image
- `estimateCost({model, input_tokens, output_tokens, images})` → USD number.
- `logAiCost(db, { ebook_id, step, model, input_tokens?, output_tokens?, images?, cost_usd?, provider? })`:
  - Fire-and-forget: wraps `db.from('cost_log').insert(...)` in try/catch and swallows errors (logs to console only).
  - If `cost_usd` not supplied, compute from PRICE_TABLE.
  - Stores `images` count into `output_tokens` column (per directive) plus `metadata.image_count` for clarity.

## 2. Wire logAiCost into every kids AI call

Audit + patch these functions to call `logAiCost` after each AI call (chat, image, vision, Fal):
- `_shared/kids-image-gen.ts` (generateWithReference) → log after gateway returns.
- `_shared/fal.ts` (falFluxSchnell / falRecraftV3) → log with provider="fal".
- `_shared/kids-vision-qc.ts`, `_shared/kids-story-judge.ts`, `_shared/thumbnail-qc-photoreal.ts`.
- `_shared/kids-visual-bible.ts`, `_shared/kids-interior.ts`, `_shared/kids-picture-pdf.ts` (any direct model calls).
- Edge functions: `kids-concept-preflight`, `rewrite-kids-manuscript`, `kids-repair-story-gate`, `kids-surgical-story-repair`, `kids-generate-storefront-copy`, `kids-skill-learner`, `kids-final-text-repair`, `kids-repair-cover`, `kids-repair-book`, `kids-qc-run`, `kids-one-click-build`.

Each call site passes `ebook_id` (available in scope) and a stable `step` string matching the pipeline step name.

## 3. `ebook_costs` view + admin surfacing

Migration adds:
```sql
CREATE OR REPLACE VIEW public.ebook_costs AS
SELECT
  ebook_id,
  SUM(cost_usd)::numeric(10,4) AS total_usd,
  SUM(CASE WHEN model ILIKE '%image%' OR model ILIKE '%flux%' OR model ILIKE '%recraft%' THEN cost_usd ELSE 0 END)::numeric(10,4) AS image_usd,
  SUM(CASE WHEN model NOT ILIKE '%image%' AND model NOT ILIKE '%flux%' AND model NOT ILIKE '%recraft%' THEN cost_usd ELSE 0 END)::numeric(10,4) AS text_usd,
  SUM(COALESCE((metadata->>'image_count')::int, 0)) AS n_images,
  COUNT(*) AS n_calls
FROM public.cost_log
WHERE ebook_id IS NOT NULL
GROUP BY ebook_id;

GRANT SELECT ON public.ebook_costs TO authenticated, service_role;
```

- On publish (in `kids-publish-if-qc-passed`), read `ebook_costs` for the book and write total into `ebooks_kids.storefront_meta.production_cost_usd`.
- Admin run list (`src/pages/admin/KidsAutopilot.tsx` / `KidsLibrary.tsx`): fetch `ebook_costs` per row, render `ต้นทุน ~$X.XX` with image/text split tooltip.

## 4. External API keys (bypass gateway markup)

Two new optional secrets: `GEMINI_API_KEY`, `FAL_KEY` (FAL_KEY already exists as `FAL_API_KEY` — reuse; document both).

In `_shared/kids-image-gen.ts`:
- If `GEMINI_API_KEY` is set, POST directly to `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with the same prompt + reference-image parts (base64 fetch → inlineData). Same model IDs, same output parsing → PNG bytes. Fallback to gateway path on any error or missing key.

In `_shared/fal.ts`:
- Already uses `FAL_API_KEY` direct. No change needed — confirm and mention in docs.

Add `_shared/gemini-direct.ts` for a text/chat direct-call helper too (used by high-volume flash calls): same model IDs, same body shape adapter (OpenAI-chat → generateContent). Wire into concept preflight, revisions, and other flash-tier callers.

Every direct call still passes through `logAiCost` with `provider: 'google_direct'` / `'fal_direct'` so the cost view accurately reflects direct-billing pricing (roughly ~50% of gateway).

Admin Settings UI (`src/pages/admin/Settings.tsx`): show 2 rows — "Gemini direct API" and "Fal direct API" — with green/gray dot fetched from an edge function `settings-secret-status` (returns booleans only, never values). Note: "ใส่ API key ตรงเพื่อประหยัด ~30–50%".

## 5. Vision QC batching (3×3 contact sheets)

In `_shared/kids-vision-qc.ts`:
- New function `qcSpreadsBatch(pageImages: {index, bytes}[])`:
  - Chunk into groups of 9.
  - Composite each group into a 3×3 grid (1024×1024 or 1536×1536 total) with cell labels "1"–"9" burned into the top-left corner of each cell (use `image-scripting`/canvas via Deno `imagescript`).
  - Send ONE vision call to `google/gemini-2.5-pro` asking for a JSON array of per-cell verdicts (`{cell:1, pass:true, issues:[]}`).
  - Return per-page results keyed by original index.
- Callers in `kids-qc-run` and `kids-interior` switch to batch path for full-book QC.
- Single-page path preserved for repair re-checks (`kids-repair-book` when re-verifying one regenerated page).

Expected impact: 35 pages → 4 vision calls instead of 35 (~90% fewer).

## 6. Model tiering policy

Store as `pipeline_skills` row (`slug=cost_policy`, source=`system`):
```json
{
  "pro_only": ["story_gate_judge", "final_qc_scorecard", "vision_qc_batch"],
  "flash_default": "google/gemini-2.5-flash",
  "flash_used_by": ["concept", "scene_plan", "draft", "revision", "storefront_copy", "final_text_repair"]
}
```

Audit + fix any step currently using a `-pro` model when it should be flash. Grep for `gemini-3.1-pro-preview` and `gemini-2.5-pro` in edge functions; downgrade non-judge/non-QC callers to `gemini-2.5-flash`.

Do NOT change: gate thresholds, 1024px image resolution, reference-conditioning params.

## 7. Verification

After deploy (and after the Detective Dot run finishes):
- Trigger a fresh one-click build.
- Query `select * from ebook_costs where ebook_id = '<new>'` → expect total_usd in $0.8–1.2 range.
- Confirm cost badge renders on admin run list.
- Confirm no story_gate / final_qc regressions (scores unchanged).

## Technical notes

- Migration is additive: new view + no table changes → won't disturb the running Detective Dot build.
- All new AI-call routing is conditional on env presence; the running build proceeds on the current gateway path unchanged.
- `logAiCost` is fire-and-forget so a schema mismatch on `cost_log` can never break the pipeline.
- No changes to `_shared/story-craft-skill.ts`, gate thresholds, or QC rubrics.

## Files touched (new / edited)

New:
- `supabase/functions/_shared/cost-log.ts`
- `supabase/functions/_shared/gemini-direct.ts`
- `supabase/functions/settings-secret-status/index.ts`
- `supabase/migrations/<ts>_ebook_costs_view.sql`

Edited:
- `_shared/kids-image-gen.ts`, `_shared/fal.ts`, `_shared/kids-vision-qc.ts`, `_shared/kids-story-judge.ts`, `_shared/thumbnail-qc-photoreal.ts`, `_shared/kids-visual-bible.ts`, `_shared/kids-interior.ts`, `_shared/kids-picture-pdf.ts`
- `kids-concept-preflight`, `rewrite-kids-manuscript`, `kids-repair-story-gate`, `kids-surgical-story-repair`, `kids-generate-storefront-copy`, `kids-skill-learner`, `kids-final-text-repair`, `kids-repair-cover`, `kids-repair-book`, `kids-qc-run`, `kids-one-click-build`, `kids-publish-if-qc-passed`
- `src/pages/admin/KidsAutopilot.tsx`, `src/pages/admin/KidsLibrary.tsx`, `src/pages/admin/Settings.tsx`

Approve to proceed, or tell me which sections to defer / adjust.
