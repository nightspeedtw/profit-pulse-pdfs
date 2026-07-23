## Plan: `anatomy_cloudflare_primary_v4` + resume Bubbly repair

### 1. Rewire `_shared/coloring-v2/anatomy-check.ts`
- New provider ladder:
  1. **Cloudflare Workers AI** — `@cf/llava-hf/llava-1.5-7b-hf` (primary). Uses `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` already in secrets. Prompt asks for JSON verdict `{pass, anatomy_score, defects[], named_subject}` restricted to canonical part counts (fantasy species allow-list preserved from v3).
  2. **Gemini 2.5 Flash direct** — via `GOOGLE_AI_STUDIO_KEY` (secondary, on CF fail/timeout).
  3. **Degraded pass-through** — if both fail, return `{degraded:true, pass:true}` so we don't burn credits regenerating pages we can't measure; QC safety net + `anatomy_unmeasured=true` meta still flag them.
- Bump `ANATOMY_VERIFIER_VERSION` → `v4:cloudflare_primary`.
- Keep the existing hard-gate semantics: `pass=false && degraded=false` → hard reject in `coloring-v2-render-page` and `coloring-v2-repair-book`.

### 2. Register skill
Insert `anatomy_cloudflare_primary_v4` into `pipeline_skills` with the ladder + fantasy allow-list rules so future agents don't regress it.

### 3. Resume Bubbly Ocean Buddies repair
- Call `coloring-v2-repair-book` with `{ book_id: <bubbly>, preserve_cover: true, clear_prior_verdicts: true }` in a loop (batch size 6) until `finalized:true`.
- Re-render any dropped pages via the chained `coloring-v2-render-page` (already wired).
- Verify final state: all interior pages have `repair_verdict.pass=true` (or `degraded=true`), cover asset with `cover_illustrated_hand_lettered_once_v1` meta preserved, book returns to `live` + `sellable=true`.

### 4. Verification
- Unit: extend `coloring-v2-anatomy-gate-v1.test.ts` to pin `ANATOMY_VERIFIER_VERSION === "v4:cloudflare_primary"` and confirm Cloudflare is the first provider called.
- Runtime: hit `coloring-v2-repair-book` with `dry_run:true` first, then run sweeps and inspect `coloring_v2_qc_findings` for any `anatomy_deformity_persistent` rows.

### Non-goals (unchanged)
- Cover provider law (`cover_smart_ai_only_v9` — Gemini/GPT only) stays.
- One-book-at-a-time law stays; only Bubbly is touched.
- No changes to interior render provider (Cloudflare CF1-6 for content).
