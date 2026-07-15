#!/usr/bin/env python3
"""Detect blank / near-solid-color cover on page 1 by luminance variance.

Extracts the first embedded image on page 1 (the cover art) and computes
mean/variance in grayscale. Solid-white / solid-gray fixture pages (Chef Pip
regression) score variance < 400 and mean > 240 or < 15 → fail.
"""
import io, json, os, sys, pathlib, statistics
from pypdf import PdfReader
from PIL import Image

def luma_stats(img: Image.Image) -> tuple[float, float]:
    g = img.convert("L").resize((64, 64))
    px = list(g.getdata())
    m = sum(px) / len(px)
    var = statistics.pvariance(px)
    return m, var

def check(path: str) -> dict:
    r = PdfReader(path)
    if len(r.pages) == 0:
        return {"ok": False, "reason": "no_pages"}
    page1 = r.pages[0]
    imgs = list(page1.images) if hasattr(page1, "images") else []
    if not imgs:
        # No image at all on the cover → blank cover regression (title-only page).
        return {"ok": False, "reason": "no_image_on_cover_page"}
    img_bytes = imgs[0].data if hasattr(imgs[0], "data") else bytes(imgs[0])
    try:
        img = Image.open(io.BytesIO(img_bytes))
    except Exception as e:
        return {"ok": False, "reason": "cover_image_undecodable", "error": str(e)[:200]}
    mean, var = luma_stats(img)
    dead = var < 400 and (mean > 240 or mean < 15)
    return {"ok": not dead, "mean": round(mean, 1), "variance": round(var, 1), "dead": dead}

def main():
    if len(sys.argv) < 2:
        print("usage: detect-blank-cover.py <pdf>", file=sys.stderr); sys.exit(2)
    v = check(sys.argv[1])
    print(json.dumps(v))
    os.makedirs("artifacts/pdf-integrity", exist_ok=True)
    stem = pathlib.Path(sys.argv[1]).stem
    with open(f"artifacts/pdf-integrity/{stem}-cover.json", "w") as f:
        json.dump(v, f, indent=2)
    sys.exit(0 if v["ok"] else 1)

if __name__ == "__main__":
    main()
