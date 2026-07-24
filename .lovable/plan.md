## Plan: Anatomy verifier — skip when uninterpretable, keep book moving

**Problem**: Bouncy Bubble Letters got parked at `anatomy_unrecoverable_page_29` because the verifier returned `unrecognizable_subject:tree branch...`. That's not a deformity — the verifier couldn't interpret the scene. Current code treats any non-pass verdict as a hard defect and parks the book after 3 attempts.

**Rule (owner order)**: If the verifier can't verify or can't interpret, treat as *unmeasured* → upload the page, flag `anatomy_unmeasured=true`, continue to the next page, finish the book. Only *measured, clear* deformities (missing/extra/fused/severed/floating limbs, wrong part counts on real animals) may block.

### Changes

1. **`supabase/functions/_shared/coloring-v2/anatomy-check.ts`**
   - Add an "uninterpretable" verdict class. When the model output includes `unrecognizable_subject`, `cannot_determine`, `not_a_creature`, `abstract_subject`, or the parser can't map a real anatomy defect, return `{ pass: true, degraded: true, defects: [...], reason: "uninterpretable" }` instead of `pass: false`.
   - Only real anatomy defect tokens (two_heads, extra_limb, missing_limb, fused_limbs, severed_*, floating_*, wrong_number_of_*, malformed_body) count as a measured fail.
   - Bump gate version to `v7:uninterpretable_skips`.

2. **`supabase/functions/coloring-v2-render-page/index.ts`**
   - Treat `verdict.degraded === true` OR `verdict.reason === "uninterpretable"` as the existing "upload with `anatomy_unmeasured=true`, do not retry, do not park" path (already implemented for degraded — extend it).
   - Only measured defects (`!verdict.pass && !verdict.degraded && verdict.defects` contains a real anatomy token) retry with the negative clause and, after `MAX_ATTEMPTS`, park.

3. **`supabase/functions/coloring-v2-qc/index.ts`**
   - Already downgrades unmeasured pages to a warning under `verifier_degraded_v2`. Keep that behavior; uninterpretable pages flow through the same warn path.

4. **Unpark Bouncy Bubble Letters** (`e2b5a66b`)
   - Delete the failed page 29 asset, reset `stage='interior_render'`, `stage_attempt_count=0`, clear `last_error`, fire `coloring-v2-render-page` for page 29. New logic will let it through even if the verifier still can't parse "branch with hanging star".

5. **Regression test**: extend `src/__tests__/coloring-v2-anatomy-gate-v1.test.ts` (or a new sibling) to assert:
   - `unrecognizable_subject` → `pass: true, degraded: true`
   - `two_heads` still → `pass: false, degraded: false`
   - render-page does not park when verdict is uninterpretable

### Non-goals
- No threshold changes for real deformities.
- No changes to QC anatomy hard-gate for measured defects.
- No changes to cover pipeline.

### Success
- Bouncy Bubble Letters reaches `live`.
- Future books never park on `unrecognizable_subject`-style verdicts.
- Real anatomy deformities (measured) still block as before.
