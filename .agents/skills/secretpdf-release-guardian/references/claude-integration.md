# Claude Code Integration

## Install

Place this skill at:

`.claude/skills/secretpdf-release-guardian/`

or run from the unpacked skill directory:

```bash
python scripts/install_for_claude.py --repo /path/to/secretpdf-repo
```

## Root CLAUDE.md snippet

Add:

```markdown
For any SecretPDF book-generation, PDF, illustrated-book, QC, preview, storefront, recurring-regression, or Fix-All task, load `.claude/skills/secretpdf-release-guardian/SKILL.md` first and follow it as a release-blocking policy.

Do not lower quality thresholds, bypass gates, manually edit QC scores, or claim a permanent fix without the required fixture and fresh-book proof. Run the release-manifest validator before declaring completion.
```

## Recommended trigger prompt

```text
Invoke the secretpdf-release-guardian skill. Treat this as a P0 reliability incident. Audit first, reproduce the failure, add a failing regression test, fix the defect class, repair the current fixture, and prove permanence with fresh books. Do not lower thresholds or bypass gates.
```

## Completion command

```bash
python .claude/skills/secretpdf-release-guardian/scripts/validate_release_manifest.py artifacts/secretpdf-release-manifest.json
```

A nonzero result blocks completion.
