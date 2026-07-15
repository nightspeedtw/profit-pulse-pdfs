# SecretPDF — P0 Mission (Claude / Lovable agent charter)

Supersedes all queued feature work until the acceptance criterion below is met.

## Mission
Make the children's illustrated-book pipeline reliably produce final high-quality PDFs, three fresh books in a row, with zero manual intervention and zero gate bypass.

## Freeze
- No NEW book creation is initiated during the Step-1 audit (in-flight runs preserved).
- No feature work. No Shopify / SEO / blog / royalty / exchange / payments / publishing changes.
- No lowering thresholds. No manual per-ebook DB patches.

## Steps (execute in order)
1. Written architecture audit (this repo's `SECRET_PDF_PRELIMINARY_AUDIT.md`).
2. One canonical orchestrator — every trigger calls it; it alone owns steps, deps, retries, checkpoints, repair dispatch, terminal status, final report.
3. One canonical data model for kids production (ebook, run, step, segments, bibles, cover, interiors, PDF hash, scorecard, repair history, final report). Adapters only for migration.
4. Phase 1 genuinely PDF-only: step list ends at `final_report` after `final_pdf_ready`. Remove product / pricing / publish from the Phase-1 graph. Nothing in Phase 1 calls anything with `publish:true`.
5. Typed recovery replaces destructive retirement — see failure taxonomy in audit §7.
6. Separate skill learning (manuscript quality only, versioned, rollback on regression) from code repair (repro test → patch → typecheck/test/build → regression proof).
7. Sequential-safe: one parent, one heavy content job, one image batch, one PDF assembly. DB-backed lease with owner/heartbeat/expires — not row counting.
8. Fix status/repair races with canonical states and compare-and-set finalization.
9. Reproducible build (bun, synced lockfile, documented commands).
10. Gates stay strict; missing technical input = `null` / `not_evaluated`, never `0`.
11. Regression test per fixed blocker class (12 classes; list in audit §12).
12. Cleanup only after acceptance: quarantine legacy paths behind flags with zero-call telemetry first; archive later.

## Acceptance (P0 closes only when all true)
Three consecutive fresh books in sequential-safe mode, each:
- new concept (no reuse), no manual DB edits, no gate bypass / threshold cut;
- expected page count, complete page text, character + style continuity;
- no watermark, no random model chatter, no leftover markdown;
- openable final PDF (valid `%PDF-`, correct page count, hash recorded);
- numeric QC scores persisted (never synthesized zeros);
- final report captures: run id, title, cycle time, model calls, skill versions, repairs attempted, scorecards, PDF hash, failure classes seen, no-intervention evidence.

If the same blocker class appears twice → autopause + fix with a failing test first.

## Deliverables required to claim "P0 done"
1. Architecture audit
2. Canonical-orchestrator decision + code
3. Canonical data contract + migration plan
4. Code changes list
5. Migrations / adapters
6. Clean-install / typecheck / test / build evidence
7. Regression test list (12 classes)
8. Quarantine list (legacy paths, flags, telemetry proof)
9. Three-run acceptance report
10. Remaining config blockers (if any)
