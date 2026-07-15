---
name: secretpdf-release-guardian
description: Audit, repair, and permanently harden SecretPDF/Ebook Factory pipelines that generate ebooks, illustrated children's books, covers, thumbnails, PDFs, previews, and sales pages. Use when Claude or another coding agent must diagnose recurring bugs, stop endless Fix All loops, unify orchestrators and data contracts, enforce story/character/style continuity, remove duplicate pages, markdown, watermarks, random image text and public-copy leaks, add regression tests, and prove one-click PDF completion without lowering quality thresholds or bypassing gates.
---

# SecretPDF Release Guardian

Treat every repeated defect as a release-engineering incident, not as a one-book prompt problem. Fix the defect class, add proof, and prevent recurrence.

## Operating principles

- Audit before editing. Trace the real call graph, tables, fields, workers, assets, and gates.
- Keep one canonical orchestrator, one canonical book record, one canonical page identity, and one canonical final-PDF asset contract.
- Separate content defects, technical dependency failures, persistence bugs, concurrency bugs, and public-page defects.
- Never convert a missing/inaccessible asset into a quality score of zero.
- Never lower thresholds, bypass a gate, manually edit scores, or patch only one database row to claim success.
- Make retries idempotent: repair or replace the same logical artifact; never append a duplicate.
- Derive public metadata from the final approved artifact, not from a draft outline.
- Keep internal prompts, story briefs, diagnostics, comments, and generation metadata out of public pages.
- Do not declare a permanent fix until the original fixture and fresh books pass the acceptance proof.

## Choose the task mode

1. **Active P0 regression**: a defect recorded as fixed has returned, production loops, or valid books cannot finish.
2. **Current-book repair**: repair one book while also fixing the defect class that caused it.
3. **Architecture hardening**: unify pipeline paths, persistence contracts, queues, and release gates.
4. **Release review**: inspect a PDF, thumbnail, preview, and sales page before publication.

For P0 work, read `references/p0-regression-workflow.md` first. For illustrated books, also read `references/illustrated-book-contract.md`. For PDF or page-order defects, read `references/pdf-integrity-contract.md`. For public storefront defects, read `references/sales-page-contract.md`. Apply thresholds from `references/release-gates.md`.

## Required workflow

### 1. Freeze scope and preserve evidence

- Pause creation of new books when a P0 regression is active.
- Let safe in-flight work checkpoint; prevent new heavy jobs from starting.
- Preserve failing records, logs, assets, hashes, prompts, model versions, and run IDs.
- Quarantine defective public listings rather than deleting diagnostic evidence.

### 2. Build the evidence map

Document:

- every trigger and entry point;
- the canonical orchestrator and any bypass paths;
- tables and fields read/written at each step;
- producer → persistence field → gate reader mapping;
- page identity and retry behavior;
- asset ID/path/version/hash flow;
- status transitions and lock ownership;
- public-page field mapping.

Do not edit production behavior until the root-cause hypothesis is supported by this map.

### 3. Classify each failure

Use one class:

- `content_quality`: story, language, age fit, character or art direction;
- `dependency_missing`: upstream output absent or invalid;
- `asset_access`: stale URL, wrong version, missing file, invalid bytes;
- `persistence_contract`: producer and gate use different fields or versions;
- `idempotency`: retry appends duplicates or reuses stale artifacts;
- `state_machine`: illegal transition, skipped dependency, incorrect terminal state;
- `concurrency`: multiple workers own the same book or render simultaneously;
- `public_copy_leak`: internal brief, comments, markdown, or false metadata shown publicly;
- `code_regression`: a previously covered defect returned.

Only `content_quality` should improve writing/art prompts. All other classes require code and regression tests.

### 4. Create a failing test before the fix

Reproduce the smallest failing condition. Prefer deterministic tests for:

- duplicate page numbers, normalized text hashes, or image hashes;
- stale asset versions and mismatched hashes;
- producer/gate field mapping;
- illegal state transitions;
- retry append behavior;
- raw markdown, HTML comments, watermark or random-text flags;
- final page-count/read-time mismatch;
- internal-copy leakage;
- publication despite a hard gate.

The test must fail before the patch and pass after it.

### 5. Repair the whole defect class

- Route all triggers through the same orchestrator and step contracts.
- Make page upserts unique by book, canonical page number, and content version.
- Store immutable artifact versions and hashes; pass exact asset IDs between steps.
- Reload persisted records before recomputing gates.
- Distinguish technical input failure from content-quality failure.
- Regenerate only the failed artifact when possible.
- Stop repeated repairs when the output hash and scores do not improve; raise `needs_code_fix` with evidence.

### 6. Rebuild the affected book from canonical data

For illustrated books, use this connected chain:

Story Bible → Character Bible → Character Reference → Style Bible → Cover → Page Plan → Interior Art → Layout → PDF → Public Assets.

The approved character/style references are immutable for that book version. Do not allow independent cover and interior generation.

### 7. Validate the release manifest

Create a release manifest using `references/release-manifest-example.json`, then run:

```bash
python .claude/skills/secretpdf-release-guardian/scripts/validate_release_manifest.py path/to/release-manifest.json
```

Treat a nonzero exit code as a blocked release. Do not override it manually.

### 8. Prove permanence

For a book-specific repair:

- the original fixture must pass;
- one fresh book of the same type must pass without manual database edits.

For an architecture/P0 fix:

- the original fixture must pass;
- three consecutive fresh books must reach `final_pdf_ready`;
- manual DB edits, threshold reductions, and gate bypasses must all be zero.

### 9. Report truthfully

Use this structure:

1. Root cause and evidence
2. Defect class
3. Canonical contract chosen
4. Files/migrations changed
5. Failing regression test added
6. Current fixture result
7. Fresh-book proof
8. Threshold/gate diff confirmation
9. Remaining blockers
10. `p0_closed: true|false`

Do not use “fixed”, “done”, or “permanent” when the acceptance proof is incomplete.

## Illustrated-book hard rules

- Use the same character identity, proportions, costume, props, line art, coloring, and world style from cover through every interior page.
- Generate AI illustrations without body text, labels, signatures, watermarks, URLs, or random typography. Render approved text with controlled layout code.
- Require exact text-to-image scene contracts and chronology.
- Never accept duplicate logical pages, repeated chunks, truncated sentences, blank covers, or mismatched supporting characters.
- Never show a cover/product mockup built from an unapproved cover.

See `references/illustrated-book-contract.md` for the complete contract.

## Sales-page hard rules

- Use separate fields for internal generation briefs and customer-facing copy.
- Strip HTML comments, markdown markers, page keys, prompt notes, and diagnostics.
- Use verified final page count, read time, age range, assets, price, and features.
- Curate preview spreads; do not dump raw draft pages or repetitive text.
- Hide guarantees, audience counts, encryption claims, and delivery claims unless implemented and evidenced.

See `references/sales-page-contract.md`.

## Completion guard

Before ending work, run repository tests plus the release-manifest validator. If available, use `scripts/install_for_claude.py` to install this skill into the target repository and place the project instruction snippet from `references/claude-integration.md` in the root `CLAUDE.md`.
