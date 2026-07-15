# Release Gates

## Phase 1 release definition

A run is complete only when it reaches `final_pdf_ready` with an openable PDF and a verified final report.

## Hard defect counts

All must equal zero:

```text
duplicate_pages
duplicate_text_blocks
duplicate_image_hashes
raw_markdown
html_comments
watermarks
random_image_text
truncated_text
metadata_mismatches
unverified_public_claims
placeholder_assets
```

## Required assets

```text
cover_present = true
cover_blank = false
final_pdf_present = true
final_pdf_opens = true
thumbnail_present = true
```

## Illustrated-book scores

```text
character_consistency >= 95
cover_to_interior_match >= 95
style_consistency >= 95
page_continuity >= 95
text_image_match >= 95
story_chronology >= 98
age_appropriateness >= 95
```

## General product scores

```text
typography_layout >= 95
cover_quality >= 90
thumbnail_quality >= 90
sales_page_sanitization = 100
product_metadata_match = 100
final_sellable >= 92
```

## Permanent-fix proof

```text
original_fixture_passed = true
consecutive_fresh_books_passed >= 3
manual_db_edits = 0
threshold_reductions = 0
gate_bypasses = 0
clean_install = true
typecheck = true
tests = true
build = true
```

Use `scripts/validate_release_manifest.py` to enforce these values.
