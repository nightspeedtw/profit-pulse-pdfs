# Coloring-Book Lean Mode + Start 1 Book

Scope: coloring books ONLY (picture-story pipeline unchanged). Owner rules:
- Cloudflare Flux (free) = PRIMARY for coloring interiors AND covers. Runware = fallback. fal.ai = last resort.
- Story/title gate: relaxed. Simple titles like "Cute Puppy", "Naughty Cat", "Dinosaur Land", "Mermaid Adventure" must PASS. No high-quality bar.
- Non-negotiable gates kept: (a) cover spelling correct, (b) cover characters match interior (same species/style).
- Interior-first cover law (already built for picture books) extended to coloring: generate interior pages first, then reuse those characters as reference for the cover.
- After changes deploy, immediately dispatch 1 new coloring book end-to-end.

## Changes

### 1. Provider policy: Cloudflare-primary for coloring
`supabase/functions/_shared/image-providers.ts` + coloring-specific readers.
- Coloring lane policy: `cloudflare_flux_schnell` → `runware_flux_schnell` → `fal_flux_schnell`.
- Applies to both `coloring_interior` and `coloring_cover` steps.
- Picture-book (kids story) lane unchanged (Runware primary).

Also DB flip on `platform_settings.image_provider_policy` (coloring row) to `cloudflare_primary_runware_fallback`.

### 2. Relax coloring story/title gate
`supabase/functions/_shared/coloring/*` (title/theme validator + `publish-contract.ts` coloring branch).
- Drop rer/buyer subjective score thresholds for coloring.
- Keep only: title spelling valid, length ≤ 45 chars, contains age-appropriate noun (animal/theme keyword). Simple 2-3 word titles auto-pass.
- Remove repair loop for coloring story gate (no repair beyond attempt 1 — waive + proceed).
- Cuts Gemini-Pro rewrite spend for this lane to ~0.

### 3. Cover NON-negotiable gates kept
- Spelling: `verifyExactCoverText` v3 remains strict, non-waivable.
- Character-cover match: use interior-first pattern — coloring cover generator receives 2-3 interior page URLs as `referenceImageURLs` (Runware img2img) OR Cloudflare with reference conditioning; if CF can't accept refs, escalate to Runware for cover only (covers are 1/book, cost is bounded).

### 4. Interior-first ordering for coloring
`coloring-book-assemble` / `coloring-book-cover` sequencing:
- Cover step gated: `waitForInteriorPct >= 50%`.
- Cover prompt seeded from actual interior character descriptions (already captured in page-plan).

### 5. Dispatch 1 book after deploy
- Pick 1 queued coloring draft (or create a fresh simple concept like "Cute Puppy Playtime"), set `focus_run=true`, reset invocation counters, trigger `coloring-book-orchestrator`.
- Watch through to LIVE; report cost + pass/fail per gate.

## Files touched (est.)
- `supabase/functions/_shared/image-providers.ts` (coloring policy branch)
- `supabase/functions/_shared/coloring/qc-mode.ts` (relaxed title gate)
- `supabase/functions/_shared/coloring/publish-contract.ts` (skip subjective story gate for coloring)
- `supabase/functions/coloring-book-cover/index.ts` (interior-first + reference URLs)
- `supabase/functions/coloring-book-orchestrator/index.ts` (ordering guard)
- One `platform_settings` row update
- One `ebooks_kids` seed + dispatch call

## Non-goals
- No changes to picture-book lane.
- No changes to spelling gate strictness.
- No lowering of PDF integrity / trim-lock gates.

## Reports back
- Which provider served cover vs interior (from cost_log).
- Total token/$$ spent on the 1 book.
- Cover spelling + character-match verdict.
- Final LIVE URL.
