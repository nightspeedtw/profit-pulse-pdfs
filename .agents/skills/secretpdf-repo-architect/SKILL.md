---
name: secretpdf-repo-architect
description: Use when auditing the SecretPDF repository, tracing pipeline entry points, identifying duplicate orchestrators, selecting canonical tables, cleaning legacy code, verifying Phase 1 does not call Shopify/SEO/publish, or planning a root-cause architectural repair before large fixes. Does NOT touch runtime state, QC contracts, or PDF bytes — those belong to the pipeline-orchestrator, qc-contract-auditor, and pdf-integrity-engineer skills.
---

# SecretPDF Repo Architect

Audit before editing. Every large fix in this repo starts here. Produce an architecture report; do not change production behavior until the map is done and the canonical path is chosen.

## When to load
- New P0 incident whose class is unclear.
- Owner asks for a "fix all", "consolidate", or "why did X regress".
- Adding a new step, worker, table, or entry point.
- After merging any orchestrator/worker change.

## Deliverables (always as `SECRET_PDF_ARCHITECTURE_REPORT.md`)
1. Entry-point inventory (HTTP triggers, cron, buttons, webhooks) → target function.
2. Chosen canonical orchestrator + list of bypass paths marked for retirement.
3. Canonical tables/fields per stage (producer → persistence field → gate reader).
4. Duplicate/legacy functions with retire vs. merge decision.
5. Feature-flag map (env, `platform_settings`, `generation_settings`) + defaults.
6. Phase-1 boundary check: any code path from kids/adult PDF pipeline into Shopify / SEO / publishing / royalty / trading is a P0 violation.
7. Dead code list with evidence (zero call sites in `src/` + `supabase/functions/`).

## Deterministic scripts (`scripts/`)
Run from repo root. Each writes to `artifacts/architecture/` and exits nonzero on structural violations.

- `map-entry-points.sh` — grep Deno.serve + cron + `supabase.functions.invoke` calls.
- `find-duplicate-functions.sh` — same exported symbol in >1 file.
- `find-table-read-write-paths.sh` — every `.from('<table>')` read/write, grouped.
- `check-feature-flags.sh` — every `Deno.env.get`, `import.meta.env`, `platform_settings` read + default.
- `check-phase1-boundary.sh` — fails if kids/pdf paths import Shopify/publish/SEO/royalty/trading modules.

## Non-negotiable rules
- Do not delete code in the same pass as the audit. Mark → confirm → delete in a follow-up.
- If two orchestrators exist for the same lifecycle, pick one, document why, and route triggers through it before removing the other.
- The report is the deliverable — no PRs until the owner (or the next skill) consumes it.
