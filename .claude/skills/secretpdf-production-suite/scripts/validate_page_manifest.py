#!/usr/bin/env python3
"""Validate canonical page identity, ordering, uniqueness, and sanitation."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

MARKDOWN_PATTERNS = [
    re.compile(r"(^|\n)\s{0,3}#{1,6}\s+"),
    re.compile(r"(^|\n)\s*>\s+"),
    re.compile(r"(^|\n)\s*```"),
    re.compile(r"<!--.*?-->", re.DOTALL),
]


def load_manifest(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Page manifest root must be an object")
    return data


def validate(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    pages = data.get("pages")
    if not isinstance(pages, list) or not pages:
        return ["pages must be a non-empty array"]

    numbers: list[int] = []
    text_hashes: list[str] = []
    image_hashes: list[str] = []
    event_ids: list[str] = []

    for index, page in enumerate(pages):
        if not isinstance(page, dict):
            errors.append(f"pages[{index}] must be an object")
            continue

        number = page.get("canonical_page_number")
        if not isinstance(number, int) or isinstance(number, bool) or number < 1:
            errors.append(f"pages[{index}].canonical_page_number must be a positive integer")
        else:
            numbers.append(number)

        if page.get("approved") is not True:
            errors.append(f"pages[{index}].approved must be true")

        text_hash = page.get("text_hash")
        if isinstance(text_hash, str) and text_hash:
            text_hashes.append(text_hash)

        image_hash = page.get("image_hash")
        if isinstance(image_hash, str) and image_hash:
            image_hashes.append(image_hash)

        event_id = page.get("story_event_id")
        if isinstance(event_id, str) and event_id:
            event_ids.append(event_id)

        text = page.get("story_text", "")
        if text is not None and not isinstance(text, str):
            errors.append(f"pages[{index}].story_text must be a string")
        elif isinstance(text, str):
            for pattern in MARKDOWN_PATTERNS:
                if pattern.search(text):
                    errors.append(f"pages[{index}].story_text contains raw production markup")
                    break
            if page.get("text_complete") is False:
                errors.append(f"pages[{index}] is marked text_complete=false")

        if page.get("watermark_detected") is True:
            errors.append(f"pages[{index}] contains a watermark")
        if page.get("random_text_detected") is True:
            errors.append(f"pages[{index}] contains random embedded text")

    for label, values in (
        ("canonical_page_number", numbers),
        ("text_hash", text_hashes),
        ("image_hash", image_hashes),
        ("story_event_id", event_ids),
    ):
        duplicates = [value for value, count in Counter(values).items() if count > 1]
        if duplicates:
            errors.append(f"duplicate {label}: {duplicates}")

    if numbers and numbers != sorted(numbers):
        errors.append("pages are not sorted by canonical_page_number")
    if numbers and numbers != list(range(1, len(numbers) + 1)):
        errors.append("canonical_page_number must be contiguous from 1")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()

    try:
        errors = validate(load_manifest(args.manifest))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        errors = [str(exc)]

    if errors:
        print("SECRET_PDF_PAGE_MANIFEST_BLOCKED")
        for error in errors:
            print(f"- {error}")
        return 1

    print("SECRET_PDF_PAGE_MANIFEST_PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
