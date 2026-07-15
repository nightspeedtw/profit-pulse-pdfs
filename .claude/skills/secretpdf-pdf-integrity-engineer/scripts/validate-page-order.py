#!/usr/bin/env python3
"""Validate the story-page sequence against a ledger of expected canonical
page numbers. Consumes a ledger JSON (produced by the pipeline) or accepts
--expected N to just check the total.
"""
import json, os, sys, pathlib, argparse
from pypdf import PdfReader

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--ledger", help="Path to page_ledger JSON")
    ap.add_argument("--front-matter", type=int, default=3)
    ap.add_argument("--closing-pages", type=int, default=1)
    ap.add_argument("--bonus-pages", type=int, default=0)
    ap.add_argument("--expected-story-pages", type=int)
    a = ap.parse_args()
    r = PdfReader(a.pdf)
    total = len(r.pages)
    story = total - a.front_matter - a.closing_pages - a.bonus_pages
    v = {"ok": True, "total_pages": total, "story_pages": story, "errors": []}
    if a.ledger:
        ledger = json.loads(pathlib.Path(a.ledger).read_text())
        nums = sorted(e["canonical_page_number"] for e in ledger)
        if nums != list(range(1, len(nums) + 1)):
            v["ok"] = False; v["errors"].append(f"non-contiguous ledger: {nums[:20]}...")
        if len(nums) != story:
            v["ok"] = False; v["errors"].append(f"ledger len {len(nums)} != story pages {story}")
    if a.expected_story_pages is not None and story != a.expected_story_pages:
        v["ok"] = False; v["errors"].append(f"story pages {story} != expected {a.expected_story_pages}")
    print(json.dumps(v))
    os.makedirs("artifacts/pdf-integrity", exist_ok=True)
    stem = pathlib.Path(a.pdf).stem
    with open(f"artifacts/pdf-integrity/{stem}-order.json", "w") as f: json.dump(v, f, indent=2)
    sys.exit(0 if v["ok"] else 1)

if __name__ == "__main__": main()
