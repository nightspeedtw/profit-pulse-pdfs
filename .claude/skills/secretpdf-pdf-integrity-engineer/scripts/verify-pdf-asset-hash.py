#!/usr/bin/env python3
"""Verify the renderer-recorded PDF SHA-256 matches the PDF actually stored
and served. Consumes a JSON descriptor: {"pdf_path": "...", "recorded_sha256": "..."}
"""
import hashlib, json, sys, pathlib

def sha256(p: str) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def main():
    if len(sys.argv) < 2:
        print("usage: verify-pdf-asset-hash.py <descriptor.json>", file=sys.stderr); sys.exit(2)
    d = json.loads(pathlib.Path(sys.argv[1]).read_text())
    actual = sha256(d["pdf_path"])
    ok = actual == d["recorded_sha256"]
    print(json.dumps({"ok": ok, "actual": actual, "recorded": d["recorded_sha256"]}))
    sys.exit(0 if ok else 1)

if __name__ == "__main__": main()
