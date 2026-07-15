#!/usr/bin/env python3
"""Derive final metadata from the PDF, not from any draft outline.

Outputs: page_count, story_word_count, read_aloud_minutes (150 wpm),
and a metadata_mismatch verdict against a supplied expected.json.
"""
import argparse, json, os, pathlib, re, sys
from pypdf import PdfReader

WORD_RX = re.compile(r"[A-Za-z][A-Za-z'-]+")
WPM = 150

def derive(pdf_path: str, front_matter: int, closing: int, bonus: int) -> dict:
    r = PdfReader(pdf_path)
    total = len(r.pages)
    story_start = front_matter
    story_end = total - closing - bonus
    words = 0
    for p in r.pages[story_start:story_end]:
        try:
            t = p.extract_text() or ""
        except Exception:
            t = ""
        words += len(WORD_RX.findall(t))
    minutes = round(words / WPM, 1) if words else 0.0
    return {"page_count": total, "story_word_count": words, "read_aloud_minutes": minutes}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--expected", help="expected.json with keys page_count / read_aloud_minutes")
    ap.add_argument("--front-matter", type=int, default=3)
    ap.add_argument("--closing", type=int, default=1)
    ap.add_argument("--bonus", type=int, default=0)
    a = ap.parse_args()
    d = derive(a.pdf, a.front_matter, a.closing, a.bonus)
    mismatch = []
    if a.expected:
        exp = json.loads(pathlib.Path(a.expected).read_text())
        for k in ("page_count", "read_aloud_minutes"):
            if k in exp and exp[k] != d[k]:
                mismatch.append({"field": k, "expected": exp[k], "actual": d[k]})
    d["metadata_mismatches"] = len(mismatch)
    d["mismatches"] = mismatch
    d["ok"] = not mismatch
    print(json.dumps({k: d[k] for k in ("ok","page_count","story_word_count","read_aloud_minutes","metadata_mismatches")}))
    os.makedirs("artifacts/pdf-integrity", exist_ok=True)
    stem = pathlib.Path(a.pdf).stem
    with open(f"artifacts/pdf-integrity/{stem}-metadata.json", "w") as f: json.dump(d, f, indent=2)
    sys.exit(0 if d["ok"] else 1)

if __name__ == "__main__": main()
