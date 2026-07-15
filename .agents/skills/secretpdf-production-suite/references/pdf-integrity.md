# PDF Integrity and Asset Identity

## Objective

Make PDF validation deterministic. Visual judgment complements, but does not replace, structural checks.

## Canonical PDF asset

Identify a PDF by:

```json
{
  "asset_id": "",
  "book_id": "",
  "run_id": "",
  "bucket": "",
  "storage_path": "",
  "version": 1,
  "sha256": "",
  "size_bytes": 0,
  "mime_type": "application/pdf",
  "created_at": "",
  "status": "rendered|qc_passed"
}
```

Never use an expiring signed URL as the canonical identity. Generate a fresh URL or service-role download from bucket and path.

The renderer and PDF QC must use the same `asset_id`, `version`, and hash.

## Input validation before scoring

Before PDF quality evaluation, verify:

- object exists
- download succeeds
- content type is PDF
- bytes start with `%PDF-`
- size exceeds a configured minimum
- parser opens the file
- page count is greater than zero
- downloaded SHA-256 equals the rendered asset hash

If any check fails, return a technical error with score `null`. Never return quality score `0` for inaccessible input.

## Page manifest

Before assembly, generate:

```json
{
  "book_id": "",
  "content_version": 1,
  "pages": [
    {
      "canonical_page_number": 1,
      "page_type": "cover",
      "text_hash": "",
      "image_hash": "",
      "asset_id": "",
      "asset_version": 1,
      "story_event_id": "",
      "approved": true
    }
  ]
}
```

Run `scripts/validate_page_manifest.py` before rendering.

## Duplicate prevention

Hard fail when any of these duplicate unexpectedly:

- canonical page number
- normalized story text hash
- illustration perceptual hash
- story event ID

Allow intentional repetition only when explicitly marked and justified, such as a refrain with a new scene image.

Retry must update the same logical page or create a higher version while leaving one canonical pointer.

## Chronology

Validate story order using event dependencies:

```text
setup → trigger → escalation → low point → repair → climax → resolution
```

Do not sort pages by creation time, database row ID, provider completion time, or asset URL.

## Text sanitation

Hard fail on public page text containing raw production syntax:

- Markdown headings or separators
- raw blockquote markers
- code fences
- HTML comments
- internal page keys
- prompt fragments
- incomplete sentences
- dangling quotes

Body text must remain a real text layer. Do not bake story text into AI illustrations.

## Cover integrity

The PDF cover must:

- fill the intended trim size
- be nonblank
- include the approved main character when required
- include verified title spelling
- use safe margins
- match the interior visual style

For standard A4 ebooks use a dedicated zero-margin cover page. For children's picture books use the selected trim size, not A4 by default.

## Metadata derivation

Derive after the final PDF passes:

- page count from the PDF parser
- read time from final word count
- illustration count from unique approved illustration assets
- file size from the canonical object
- cover and preview IDs from approved assets

Storefront metadata must not come from the draft outline.

## Deterministic hard gates

```text
final_pdf_opens = true
pdf_hash_matches_renderer = true
duplicate_page_count = 0
duplicate_text_block_count = 0
duplicate_image_hash_count = 0
raw_markdown_count = 0
html_comment_count = 0
truncated_text_count = 0
page_sequence_valid = true
metadata_mismatch_count = 0
```

## Recommended validation order

1. validate page manifest
2. assemble PDF
3. validate PDF bytes and hash
4. derive metadata
5. render representative page screenshots
6. run typography/layout checks
7. run cover/interior and text/image visual checks
8. persist final PDF and report
