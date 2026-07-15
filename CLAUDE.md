# SecretPDF Engineering Rules

## Current mission
P0: make the children's illustrated-book pipeline reliably produce final high-quality PDFs. Stop feature expansion until three consecutive fresh books pass.

## Read before editing
- Read the relevant project skills under `.claude/skills/`.
- Read the P0 audit and current regression log (`SECRET_PDF_PRELIMINARY_AUDIT.md`, `SECRET_PDF_CLAUDE_P0_MISSION.md`).
- Trace the call graph and data contracts before patching a symptom.

## Non-negotiable rules
- Never lower quality thresholds. Never bypass a gate.
- Never mark missing input as a quality score of zero or as passing.
- Never manually patch one ebook when the bug can affect future books.
- Every fixed blocker class gets a permanent regression test.
- Triggers may differ; state-transition logic must be owned by one canonical orchestrator.
- Phase 1 ends at final PDF and final report. Shopify, SEO, blog, exchange, royalty and payment code must not block it.
- Use sequential-safe mode until P0 acceptance passes.
- Preserve valid upstream assets and resume from the last verified checkpoint.

## Definition of done
P0 is complete only after three consecutive fresh books reach final PDF with no manual database edits, no gate bypass, strict character/style continuity, and complete evidence reports.

## Reproducible build (target — see audit)
- One package manager (bun). Synced lockfile.
- Scripts: `bun install`, `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build`.
- Clean install must pass before any P0 change is claimed done.
