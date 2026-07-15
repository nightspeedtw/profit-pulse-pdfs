# AGENTS.md — supabase/functions/

Every edge function is a step in the canonical pipeline. Before editing
one, load the matching skill.

- Adding / modifying an orchestrator or state transition → load
  `secretpdf-pipeline-orchestrator` first.
- Adding / modifying a QC gate → load `secretpdf-qc-contract-auditor` and
  audit the producer→persist→gate contract before merging.
- Touching PDF assembly (`kids-build-picture-pdf`, `kids-picture-pdf.ts`,
  `pdf-preflight.ts`, `build-pdf`) → load `secretpdf-pdf-integrity-engineer`
  and run its scripts on any produced PDF.
- Touching illustrations, covers, thumbnails → load
  `secretpdf-illustrated-continuity-director` and
  `secretpdf-image-artifact-guard`.
- Logging, error handling, retry/repair chaining → load
  `secretpdf-observability-p0-responder`.

Contract minimums for every step:
- Emit a `pipeline_step_logs` record with input/output asset IDs + hashes.
- Raise typed errors with `error_class` from the orchestrator taxonomy.
- Never write to `ebooks_kids.pipeline_status` / `listing_status` directly;
  route through the orchestrator.
- Idempotent upserts only. No append-without-key.

See root `AGENTS.md` for non-negotiable rules.
