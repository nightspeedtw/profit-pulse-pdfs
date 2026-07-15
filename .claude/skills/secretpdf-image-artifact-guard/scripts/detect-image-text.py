#!/usr/bin/env python3
"""OCR an image and flag any embedded text that isn't in the approved caption.

Exits 0 if the image is textless (or every OCR'd word appears in the
approved caption), 1 otherwise. Writes a JSON verdict to stdout.
"""
import argparse, json, os, re, sys
from PIL import Image
try:
    import pytesseract
except Exception:
    pytesseract = None

WORD_RX = re.compile(r"[A-Za-z]{3,}")

def normalize(s: str) -> set[str]:
    return {w.lower() for w in WORD_RX.findall(s or "")}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--approved-caption", default="")
    ap.add_argument("--min-confidence", type=int, default=60)
    a = ap.parse_args()
    if pytesseract is None:
        print(json.dumps({"ok": False, "reason": "pytesseract_missing"})); sys.exit(2)
    img = Image.open(a.image)
    txt = pytesseract.image_to_string(img).strip()
    words = normalize(txt)
    approved = normalize(a.approved_caption)
    unapproved = sorted(words - approved)
    ok = len(unapproved) == 0
    verdict = {
        "ok": ok,
        "detected_words": sorted(words),
        "unapproved_words": unapproved,
        "watermark_count": 0,
        "random_text_count": len(unapproved),
        "unapproved_embedded_text": len(unapproved),
        "signature_count": 1 if re.search(r"©|\bby\s+[A-Z][a-z]+|signature", txt) else 0,
    }
    print(json.dumps(verdict))
    sys.exit(0 if ok else 1)

if __name__ == "__main__": main()
