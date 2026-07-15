#!/usr/bin/env python3
"""Validate PDF signature + opens + page count from bytes."""
import json, sys, os, pathlib
from pypdf import PdfReader
from pypdf.errors import PdfReadError

def check(path: str) -> dict:
    p = pathlib.Path(path)
    if not p.exists():
        return {"ok": False, "reason": "file_missing", "path": path}
    b = p.read_bytes()
    if len(b) < 5 or b[:5] != b"%PDF-":
        return {"ok": False, "reason": "not_pdf_signature", "size": len(b)}
    try:
        r = PdfReader(str(p))
        n = len(r.pages)
        # touch every page to force lazy parse
        for pg in r.pages:
            pg.mediabox
        return {"ok": True, "size": len(b), "page_count": n}
    except (PdfReadError, Exception) as e:
        return {"ok": False, "reason": "pdf_read_error", "error": str(e)[:200]}

def main():
    if len(sys.argv) < 2:
        print("usage: validate-pdf-bytes.py <pdf>", file=sys.stderr); sys.exit(2)
    v = check(sys.argv[1])
    print(json.dumps(v))
    os.makedirs("artifacts/pdf-integrity", exist_ok=True)
    stem = pathlib.Path(sys.argv[1]).stem
    with open(f"artifacts/pdf-integrity/{stem}-bytes.json", "w") as f:
        json.dump(v, f, indent=2)
    sys.exit(0 if v.get("ok") else 1)

if __name__ == "__main__":
    main()
