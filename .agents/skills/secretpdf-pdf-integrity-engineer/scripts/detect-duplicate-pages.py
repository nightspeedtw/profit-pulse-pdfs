#!/usr/bin/env python3
"""Detect duplicate story pages by normalized text hash and image content.

Fires on the Chef Pip regression (pages 4-8 repeated at 9-13).
"""
import hashlib, json, re, sys, os, pathlib, io
from pypdf import PdfReader

WS = re.compile(r"\s+")

def norm(t: str) -> str:
    return WS.sub(" ", (t or "")).strip().lower()

def page_text_hash(t: str) -> str:
    n = norm(t)
    if len(n) < 20:  # too short to be a reliable dedup key
        return ""
    return hashlib.sha256(n.encode("utf-8")).hexdigest()

def image_hashes_on_page(page) -> list[str]:
    out = []
    try:
        for img in page.images:  # pypdf ≥ 3.x
            b = img.data if hasattr(img, "data") else bytes(img)
            out.append(hashlib.sha256(b).hexdigest())
    except Exception:
        pass
    return out

def check(path: str) -> dict:
    r = PdfReader(path)
    text_hashes: dict[str, list[int]] = {}
    image_hashes: dict[str, list[int]] = {}
    for i, page in enumerate(r.pages, 1):
        try:
            t = page.extract_text() or ""
        except Exception:
            t = ""
        th = page_text_hash(t)
        if th:
            text_hashes.setdefault(th, []).append(i)
        for ih in image_hashes_on_page(page):
            image_hashes.setdefault(ih, []).append(i)
    dup_text = {h: pages for h, pages in text_hashes.items() if len(pages) > 1}
    dup_image = {h: pages for h, pages in image_hashes.items() if len(pages) > 1}
    ok = not dup_text and not dup_image
    return {
        "ok": ok,
        "duplicate_text_blocks": sum(len(p) - 1 for p in dup_text.values()),
        "duplicate_image_hashes": sum(len(p) - 1 for p in dup_image.values()),
        "duplicate_text_groups": {h[:12]: pages for h, pages in dup_text.items()},
        "duplicate_image_groups": {h[:12]: pages for h, pages in dup_image.items()},
        "total_pages": len(r.pages),
    }

def main():
    if len(sys.argv) < 2:
        print("usage: detect-duplicate-pages.py <pdf>", file=sys.stderr); sys.exit(2)
    v = check(sys.argv[1])
    print(json.dumps({k: v[k] for k in ("ok","duplicate_text_blocks","duplicate_image_hashes","total_pages")}))
    os.makedirs("artifacts/pdf-integrity", exist_ok=True)
    stem = pathlib.Path(sys.argv[1]).stem
    with open(f"artifacts/pdf-integrity/{stem}-duplicates.json", "w") as f:
        json.dump(v, f, indent=2)
    sys.exit(0 if v["ok"] else 1)

if __name__ == "__main__":
    main()
