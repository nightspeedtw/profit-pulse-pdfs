---
name: secretpdf-image-artifact-guard
description: Use to guard SecretPDF illustrations against embedded artifacts — watermarks, artist signatures, URLs, random letters, gibberish, AI-embedded story text, prompt fragments, book title stamped into interior art, malformed speech bubbles, or ANY typography inside an AI image. Enforces the rule "AI image = textless illustration only; all approved text is rendered by the HTML/CSS/SVG overlay layer". Distinct from illustrated-continuity-director (which owns character/style continuity) and pdf-integrity-engineer (which owns PDF byte-level checks).
---

# SecretPDF Image Artifact Guard

Every AI-rendered interior or cover image MUST be textless. Text on the
printed page comes exclusively from the controlled layout layer.

## Textless negative prompt (inject into every image request)
```
no text, no letters, no words, no captions, no title, no book cover text,
no speech bubbles, no signatures, no artist mark, no watermark, no logo,
no URL, no numbers, no page numbers, no labels, no signage with legible
writing, no prompt fragments, no random typography, no gibberish glyphs
```

## Pre-PDF gates (must all be 0)
| Gate | Detection |
|---|---|
| `watermark_count` | OCR + edge-density signature in corners; matches known watermark patterns |
| `random_text_count` | OCR any legible glyph → non-empty = fail |
| `unapproved_embedded_text` | OCR text ∉ approved caption for that page |
| `signature_count` | OCR bottom-right region for `©`, `by `, artist-name patterns |
| `gibberish_count` | OCR text present but not a dictionary word / not in approved caption |

## Detection
Run `scripts/detect-image-text.py` on every rendered page image before
appending to the PDF:

```bash
python .agents/skills/secretpdf-image-artifact-guard/scripts/detect-image-text.py \
    path/to/page-15.png --approved-caption "$(cat page-15.caption.txt)"
```

Requires `pytesseract` (already available in the sandbox toolchain).

## Repair rule
If any gate fires: **regenerate the image**. Never crop the artifact out —
cropping shifts composition and produces new continuity defects.

## Where this loads
- Immediately after `kids-render-interior` writes each page image.
- Immediately after `generate-cover` writes cover art.
- In the finalize path of `kids-build-picture-pdf` as a belt-and-suspenders
  check before PDF promotion.
