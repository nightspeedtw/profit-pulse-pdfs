#!/usr/bin/env python3
"""Detect raw markdown, HTML comments, and truncated sentences in the PDF body."""
import json, os, re, sys, pathlib
from pypdf import PdfReader

MD_RX = re.compile(r"(^|\s)(\*\*[^*]+\*\*|__[^_]+__|#{1,6}\s|\[[^\]]+\]\([^)]+\)|```)")
HTML_COMMENT_RX = re.compile(r"<!--.*?-->", re.S)
INTERNAL_KEY_RX = re.compile(r"<!--\s*page\s*\d+\s*-->|Story rule:|Callbacks:|Buyer hook:|Final payoff:|Why reread:", re.I)
TRUNC_RX = re.compile(r"[a-z],\s*$|[a-z]\s+for\s+his\s+happy\s*$", re.I)

def check(path: str) -> dict:
    r = PdfReader(path)
    md_hits, comment_hits, internal_hits, trunc_hits = [], [], [], []
    for i, p in enumerate(r.pages, 1):
        try:
            t = p.extract_text() or ""
        except Exception:
            t = ""
        if MD_RX.search(t): md_hits.append(i)
        if HTML_COMMENT_RX.search(t): comment_hits.append(i)
        if INTERNAL_KEY_RX.search(t): internal_hits.append(i)
        for line in t.splitlines():
            if TRUNC_RX.search(line.strip()):
                trunc_hits.append(i); break
    ok = not (md_hits or comment_hits or internal_hits or trunc_hits)
    return {
        "ok": ok,
        "raw_markdown": len(md_hits),
        "html_comments": len(comment_hits),
        "internal_brief_leak": len(internal_hits),
        "truncated_text": len(trunc_hits),
        "raw_markdown_pages": md_hits,
        "html_comment_pages": comment_hits,
        "internal_leak_pages": internal_hits,
        "truncated_pages": trunc_hits,
    }

def main():
    if len(sys.argv) < 2:
        print("usage: detect-raw-markdown.py <pdf>", file=sys.stderr); sys.exit(2)
    v = check(sys.argv[1])
    print(json.dumps({k: v[k] for k in ("ok","raw_markdown","html_comments","internal_brief_leak","truncated_text")}))
    os.makedirs("artifacts/pdf-integrity", exist_ok=True)
    stem = pathlib.Path(sys.argv[1]).stem
    with open(f"artifacts/pdf-integrity/{stem}-text-artifacts.json", "w") as f:
        json.dump(v, f, indent=2)
    sys.exit(0 if v["ok"] else 1)

if __name__ == "__main__":
    main()
