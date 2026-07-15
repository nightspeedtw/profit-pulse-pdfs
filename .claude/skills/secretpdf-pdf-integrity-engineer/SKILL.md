---
name: secretpdf-pdf-integrity-engineer
description: Use for deterministic byte-level validation of SecretPDF final PDFs — %PDF signature, opens with pdf-lib/pypdf, real page count from bytes, blank cover detection, duplicate canonical page numbers, duplicate normalized text hashes, duplicate perceptual image hashes, raw markdown/HTML comments in extracted text, truncated sentences, page-order regressions, missing fonts/glyphs, metadata vs final PDF alignment, asset ID/version/hash agreement between renderer and QC. All checks are Python scripts with unit tests, never AI judgment.
---

# SecretPDF PDF Integrity Engineer

Every check here is a script. No LLM. If a script cannot decide, it fails closed.

## Hard gates (must be 0 / true to release)
| Gate | Script |
|---|---|
| `final_pdf_opens` = true | `scripts/validate-pdf-bytes.py` |
| `blank_cover` = false | `scripts/detect-blank-cover.py` |
| `duplicate_pages` = 0 | `scripts/detect-duplicate-pages.py` |
| `raw_markdown` = 0 | `scripts/detect-raw-markdown.py` |
| `html_comments` = 0 | `scripts/detect-raw-markdown.py` (same script) |
| `truncated_text` = 0 | `scripts/detect-raw-markdown.py` |
| `page_order_ok` = true | `scripts/validate-page-order.py` |
| `metadata_mismatch` = 0 | `scripts/derive-final-metadata.py` |
| `asset_hash_match` = true | `scripts/verify-pdf-asset-hash.py` |

## Usage
```bash
python .agents/skills/secretpdf-pdf-integrity-engineer/scripts/validate-pdf-bytes.py path/to/book.pdf
python .agents/skills/secretpdf-pdf-integrity-engineer/scripts/detect-duplicate-pages.py path/to/book.pdf
```

Each script:
- exits `0` on pass, `1` on fail;
- prints a single-line JSON verdict to stdout;
- writes a detailed report under `artifacts/pdf-integrity/<book_id or basename>/<check>.json`.

## Tests (`tests/`)
Unit tests build tiny synthetic PDFs with `reportlab`/`pypdf` and assert each detector fires on the intended defect and passes on the intended clean case. Run with `pytest .agents/skills/secretpdf-pdf-integrity-engineer/tests/`.

## Non-negotiable rules
- Never trust the DB `page_count` for a final gate — always recount from the bytes.
- Never patch a book's page count field to make it match the sales page. Fix the metadata deriver instead.
- Duplicate detection is by canonical page number **and** normalized text hash **and** image perceptual hash. Any one → fail.
- Missing font / glyph mangling → fail (`FAKE_PDF_MIME_TYPE`, `BROKEN_FONT_OR_GLYPH` in `_shared/qc/critical.ts`).
