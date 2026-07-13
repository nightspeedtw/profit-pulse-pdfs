# Never-stop kids autopilot + Force-Finish action

Two problems to solve for `Luna's Little Lights` and every future run:
1. A single failing step (here: image generation returned no `b64_json`) marks the whole run `failed` and stops. It should retry and, if still unrecoverable, substitute a safe fallback and continue.
2. Admin has no button to resume a stuck run — currently they can only "start one book".

## Fix

### 1. Resilient step loop in `autopilot-kids-pipeline`

- Wrap each step's execution in a **retry helper**: up to 3 attempts with 2s → 6s backoff. Retry only on transient signatures (`no image`, `AI 429`, `AI 5xx`, `fetch failed`, `timeout`).
- If all retries fail, run a step-specific **fallback** so the pipeline never dead-ends:
  - `generate_idea` / `generate_manuscript`: no fallback possible → mark step failed, but still continue to later steps that don't depend on prose (skip render/qc/publish, mark run `failed`, keep row visible for admin retry).
  - `generate_cover`: generate a **placeholder SVG cover** (title text + gradient), upload it as `cover.png` via a small SVG-to-PNG rasterization (use a data URL SVG uploaded as-is — bucket accepts `image/svg+xml`; or embed the SVG inside a 1024×1536 PNG generated with a tiny canvas polyfill using `npm:@napi-rs/canvas` — actually simplest: upload the SVG bytes and store the signed URL). Mark the step `completed_with_fallback` and continue.
  - `render_pdf`: fallback = minimal single-page HTML "book pending render" so the run finishes and the QC/publish steps can still evaluate.
  - `qc`: on failure, downgrade scores to `needs_revision` but do NOT throw — let publish decide.
  - `publish_live`: never fails; only marks live if cover + pdf exist, else marks `ready` (not `live`).
- Step-loop change: instead of `return` on caught error, record `status: 'failed_recovered'` or `'failed'` on the step, and **continue the for-loop**. Only mark the whole run `failed` at the end if *critical* steps (idea/manuscript) failed.
- Add a `force_finish` flag on the request. When true, the loop skips already-`completed` steps and re-runs remaining ones fresh.

### 2. Admin UI "Force finish" button

- On `/admin/kids/autopilot` runs list, add a **"Force finish"** button on any run whose status is `failed` or `running` (stale). It calls `autopilot-kids-pipeline` with `{ run_id, force_finish: true }`.
- Add a "Retry step" chip next to each failed step row in the run detail view.

### 3. Immediate recovery for the current book

After deploying, invoke the function once with `{ run_id: <Luna run id>, force_finish: true }` so it retries the cover, falls back to placeholder if still failing, and reaches `live` (or at least `ready`).

## Verification

- Curl the function with `force_finish: true` on the Luna run → response `ok: true`, run row shows `status='completed'`, at least a placeholder `cover_url`.
- Simulate a cover failure locally by temporarily forcing `no image` → run still finishes; step logged as `failed_recovered` with `fallback_used: true`.
- UI shows the new "Force finish" button and it works end-to-end.

No schema changes required (using existing `status`, `blocker_reason`, `output` columns; fallback flag stored inside `output.jsonb`).