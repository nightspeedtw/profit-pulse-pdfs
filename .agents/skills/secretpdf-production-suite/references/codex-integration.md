# Codex Integration

## Install

From the unpacked skill directory:

```bash
python scripts/install_for_codex.py --repo /path/to/profit-pulse-pdfs-main
```

This copies the skill to:

```text
<repo>/.agents/skills/secretpdf-production-suite/
```

## Root AGENTS.md snippet

```markdown
# SecretPDF Engineering Policy

For any SecretPDF repository, pipeline, PDF, QC, illustrated continuity,
cover, thumbnail, sales-page, Fix All, or recurring-regression task, invoke:

$secretpdf-production-suite

Never lower quality thresholds, bypass gates, manually edit QC scores, or
claim a permanent fix without the original fixture and three fresh-book proof.

Current default scope is Phase 1 PDF-only unless the task explicitly enables
another phase.
```

## Invocation examples

```text
$secretpdf-production-suite audit every kids-book entry point and identify the canonical orchestrator.
```

```text
$secretpdf-production-suite trace the reader QC producer, persistence field, and gate read path. Fix the n/a loop with a regression test.
```

```text
$secretpdf-production-suite repair duplicate PDF pages and prove retry idempotency.
```

```text
$secretpdf-production-suite lock the cover and interior character design, then regenerate only inconsistent pages.
```

```text
$secretpdf-production-suite sanitize the public sales page and rebuild conversion copy from verified final metadata.
```

## Completion requirement

Codex must create:

```text
artifacts/secretpdf-release-manifest.json
```

Then run the bundled validator. A nonzero exit code blocks completion.
