
## Evidence gathered

**Hypothesis (a) — skill IS reaching the writer.** All three writer paths call `loadStoryCraftBlock(db, ageBand)` before prompting:
- `supabase/functions/rewrite-kids-manuscript/index.ts:57`
- `supabase/functions/kids-repair-story-gate/index.ts:220`
- `supabase/functions/kids-concept-preflight/index.ts:420`

The skill-learner has written 21 versions of `playbook_reread_value` (latest `2026-07-14 09:31Z`, 4504 chars, source=`learned`). Loader in `_shared/story-craft-skill.ts:495` overlays the learned rows on top of the bundled seed. The writer is receiving the latest playbook. **This is not the wall.**

**Hypothesis (b) — the JUDGE is the wall.** In `_shared/kids-story-judge.ts` the prompt has 60+ lines of criterion-based rubric anchors for `generic_story_risk_score` (0-25 / 40-60 / 75-100 with example books) but **zero rubric anchors for `reread_value_score`** — the judge is asked for a number with no definition of what earns 85/90/95. LLM judges default to the safe "80" every time. No amount of playbook v22, v23 changes writer output enough to break the anchor bias, because the judge doesn't know what a 90 looks like.

**Rotation regression.** Recent runs died in ~30s at `start_run` / `manuscript_qc` with `status=needs_admin`. The ebook's `pipeline_status` gets set to `human_review_required` at `autopilot-kids-pipeline/index.ts:162 & 175` and `kids-repair-story-gate/index.ts:356`. `kids-one-click-build`'s rotation check at line 210 only branches on `pipeline_status === 'retired'`, so `human_review_required` never rotates → run dead-ends. Also the last 3 runs never even entered the `kids-one-click-build` polling loop — they were direct `autopilot-kids-pipeline` invocations that ended at story_gate without an orchestrator.

## Changes

### 1. Give the judge a criterion-based reread rubric (fixes hypothesis b)
Edit `supabase/functions/_shared/kids-story-judge.ts`:
- Add a `REREAD_VALUE RUBRIC ANCHORS` block modeled on the `generic_story_risk` section. Explicit measurable criteria:
  - **90-100:** chantable refrain appears ≥3× with variation; call-and-response OR body-movement beats kids can perform aloud; cumulative/predictable structure; ≥1 hidden-detail thread across spreads for re-read hunts; last line invites another read.
  - **80-89:** refrain present but non-chantable OR appears <3×; some participation beats but not on every spread.
  - **60-79:** decorative repetition only; no participation trigger; nothing to hunt across spreads.
  - **<60:** no repetition, no participation, purely narrated.
- Add matching `reread_evidence` fields the judge must fill (refrain_text, refrain_count, participation_beats[], hidden_thread) so we can hard-verify with regex — if the judge claims 90 but refrain_count<3, we cap the score deterministically.
- Apply the same deterministic-cap treatment for `parent_buyer_value` (also chronically stuck at 80) using the existing PARENT_BUYER_VALUE playbook criteria.

### 2. Deterministic post-judge score verifier
In the same file, after `runKidsStoryJudge` parses the report, run a `verifyRereadClaim(report, manuscript_md)` that:
- Counts refrain occurrences in `manuscript_md` (case-insensitive).
- Confirms `participation_beats` phrases actually appear.
- If judge said ≥85 but evidence fails, cap the score at 80 with a `judge_cap_applied` note.
- If evidence passes AND judge said 80, floor at 85 with `evidence_floor_applied`.
This kills the "vibes 80" default in both directions and gives the skill-learner a real signal.

### 3. Bump `playbook_reread_value` to v22 (source=learned) via `kids-skill-learner`
Update its prompt guidance so the manuscript writer explicitly targets the new judge criteria (refrain ≥3×, one participation beat per spread, hidden thread). This is a data-only insert into `pipeline_skills` — no schema change.

### 4. Restore concept rotation for `human_review_required`
Edit `supabase/functions/kids-one-click-build/index.ts` around line 210:
- Treat `pipeline_status in ('retired','human_review_required')` with a story-gate blocker as the same terminal-rotate path.
- Auto-flip such ebooks to `retired` with `blocker_reason='auto_retired_for_fresh_concept: <reason>'` and continue the outer loop (same as line 220-228 already does for story-terminal blockers).

Edit `supabase/functions/autopilot-kids-pipeline/index.ts` (lines 162, 175) and `kids-repair-story-gate/index.ts:356`:
- When a story-gate exhausts repair budget, set `pipeline_status='retired'` directly (not `human_review_required`) with a clear blocker_reason. Autopilot must never rest in a human-review state per the owner's standing rule.

### 5. Fire one fresh one-click build
Invoke `kids-one-click-build` with defaults after the code deploys. Report each stage's outcome from `autopilot_pipeline_steps` + `ebooks_kids.pipeline_status`.

## Out of scope
- Do NOT un-retire Detective Pip.
- Do NOT lower any gate threshold.
- Do NOT touch cover/PDF/QC gate code — those are hardened and working.

## Verification
1. Deploy edge functions, then replay the judge on the last 3 story_gate failures (`kids-story-judge-replay`) and confirm the new rubric + verifier now produce differentiated scores (some ≥85, some capped correctly).
2. Insert playbook_reread_value v22 and confirm loader returns it.
3. Fire one-click build; watch it flow concept → story_gate PASS (or rotate to fresh concept, never dead-end) → interiors → cover → PDF → QC → live. Report each stage's score.
4. When a book goes live, provide `pdf_url` + `cover_url` for the owner to render pages and independently verify.
