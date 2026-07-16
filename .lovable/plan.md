## Status: stuck, not still running

Book `a05a5086` (Ocean Friends) has been parked at **"Generating cover artwork (ladder)" 92%** since 04:20 UTC. The `coloring-book-cover` edge function is not making progress — every invocation dies with **`CPU Time exceeded`** (~30s wall-clock cap) before the ladder can finish:

```
04:15:06 booted → 04:15:38 CPU Time exceeded → shutdown
04:20:06 booted → 04:20:37 CPU Time exceeded → shutdown
```

Root cause: the unified cover ladder runs up to 4 heavy generator rungs (Ideogram A → Ideogram B → Recraft → Gemini) **plus** SVG fallback + title-treatment compositing **in a single edge invocation**. Each FAL/Gemini call is 8–20s; two dead rungs + one live rung blows the per-invocation CPU budget. The book never advances because the function is killed before it can write `cover_url` or chain to assemble.

Nothing is retrying it either — `coloring-worker-tick` dispatched it once when `awaiting='cover_pdf_publish'` appeared, and the row has been idle since.

## Fix plan (class-level, not this row only)

### 1. Split the ladder across invocations (`supabase/functions/coloring-book-cover/index.ts`)
Rung-at-a-time state machine, persisted in `metadata.coloring_cover_ladder`:

```
metadata.coloring_cover_ladder = {
  next_rung: "ideogram_v3_a" | ... | "svg_synthetic_fallback" | "done",
  reports: [ {rung, reason, produced_bytes}, ... ],
  started_at, updated_at
}
```

Each invocation:
- Reads `next_rung`, runs **exactly one** rung via the ladder module.
- If rung produces a live (non-dead) frame → composite title treatment, upload, set `cover_url`, chain `coloring-book-assemble`, mark ladder `done`.
- If rung fails/dead → append report, advance `next_rung`, **self-invoke** (`EdgeRuntime.waitUntil(fetch(..., {ebook_id}))`) and return.
- SVG fallback rung is dead-impossible → guaranteed terminal success.

This keeps every invocation well under the 30s CPU cap and preserves the "dead frames never consume retire budget" contract already tested in `src/lib/kidsCoverLadder.test.ts`.

### 2. Extract rung executor from `_shared/covers/kids-cover-ladder.ts`
Add a sibling export `runSingleCoverRung(input, rung)` that returns `{bytes, report}` for one rung only. Keep `renderKidsCoverWithLadder` as a thin loop over `runSingleCoverRung` so the kids storybook lane (which currently fits in one invocation because it only runs once per book with different budgets) stays behind the same API.

### 3. Worker-tick heals stuck cover rows
Extend `coloring-worker-tick` (already dispatches `awaiting='cover_pdf_publish'`) with a **staleness rule**: if `metadata.coloring_current_step_label` starts with "Generating cover artwork" AND `updated_at` older than 90s AND `cover_url IS NULL` → re-dispatch `coloring-book-cover` with `{ebook_id, resume: true}`. This ensures a lost self-invocation (rare edge platform hiccup) still recovers without human intervention.

### 4. Regression test (`src/lib/kidsCoverLadder.test.ts`)
Add cases:
- Ladder state-machine resumes from `next_rung="recraft_v3_ref"` after two prior dead reports, does not re-run rungs 1–2.
- After SVG fallback rung, `next_rung="done"` and cover_url is set.
- Every rung transition writes exactly one row-update (no duplicate reports).

### 5. Unblock the current book
After deploy, run one manual dispatch of `coloring-book-cover {ebook_id: 'a05a5086-…'}` with a fresh ladder state (clear `metadata.coloring_cover_ladder`). The worker-tick heal in step 3 would also pick it up, but a direct dispatch is faster. No DB score edits, no gate lowering — this is a machinery fix.

### 6. Acceptance
- `a05a5086` reaches `cover_url IS NOT NULL` and chains into assemble → publish.
- Second queued coloring book `19ca7a86` (Cute Sea Animals) flows through the same cover step under 30s per invocation.
- Cover ladder tests pass (`bunx vitest run src/lib/kidsCoverLadder.test.ts`).
- Autopilot enable still gated on the 3-fresh-book proof — unchanged.

## Files to touch
- `supabase/functions/_shared/covers/kids-cover-ladder.ts` — extract `runSingleCoverRung`.
- `supabase/functions/coloring-book-cover/index.ts` — convert to per-rung state machine + self-invoke.
- `supabase/functions/coloring-worker-tick/index.ts` — stale-cover heal branch.
- `src/lib/kidsCoverLadder.test.ts` — resume/state-machine regression cases.

No schema changes. No threshold changes. No gate bypass.
