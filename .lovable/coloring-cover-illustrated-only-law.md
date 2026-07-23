# OWNER LAW — `cover_illustrated_only_v12`

Effective 2026-07-23. Permanent.

## Rule
Coloring-book covers MUST be fully painted illustrations where the title is HAND-LETTERED into the artwork by the image model. Deterministic SVG/font typography compositing is FORBIDDEN on the coloring lane.

## Enforcement (defense in depth)
1. `supabase/functions/coloring-v2-cover/index.ts` — the only allowed cover generator for the coloring lane. It calls Gemini 2.5 Flash Image → OpenAI `gpt-image-1` with an illustrated hand-lettered prompt and NEVER imports `coloring-cover-compositor`, `premium-cover-overlay`, or `typography-source-verifier`.
2. **Sticky short-circuit** — if any `cover_final` asset for the book has `meta.law` in `{cover_illustrated_hand_lettered_once_v1, cover_illustrated_only_v12}`, the cover stage re-approves it and advances to QC. Repair sweeps can never overwrite an owner-approved hand-lettered cover.
3. **Provider ladder** — Gemini direct, then OpenAI direct. Lovable AI gateway is bypassed (`BYPASS_LOVABLE_GATEWAY=1`).
4. **Retry cap** — 3 dispatches. On exhaustion the book is parked at `stage='failed'` and a critical `alert_log` row is raised for the admin dashboard.

## Regression test
`src/__tests__/coloring-cover-illustrated-only-v12.test.ts` asserts:
- `coloring-v2-cover/index.ts` contains no import of the SVG typography modules.
- Both sticky-law strings appear in the short-circuit set.
- Uploaded `cover_final` meta uses `text_mode: 'illustrated_hand_lettered_baked'`.

## What this replaces
Supersedes `cover_v2_deterministic_typography` and `cover_source_of_truth_v11` for the coloring lane. Picture-book covers keep their existing pipeline.
