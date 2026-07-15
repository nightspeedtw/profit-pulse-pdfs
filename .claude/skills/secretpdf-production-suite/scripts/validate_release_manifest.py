#!/usr/bin/env python3
"""Validate a SecretPDF release manifest against non-negotiable gates."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REQUIRED_ASSET_BOOLEANS = {
    "cover_present": True,
    "cover_blank": False,
    "final_pdf_present": True,
    "final_pdf_opens": True,
    "thumbnail_present": True,
}

ZERO_DEFECTS = [
    "duplicate_pages",
    "duplicate_text_blocks",
    "duplicate_image_hashes",
    "raw_markdown",
    "html_comments",
    "watermarks",
    "random_image_text",
    "truncated_text",
    "metadata_mismatches",
    "unverified_public_claims",
    "placeholder_assets",
]

MIN_SCORES = {
    "character_consistency": 95,
    "cover_to_interior_match": 95,
    "style_consistency": 95,
    "page_continuity": 95,
    "text_image_match": 95,
    "story_chronology": 98,
    "age_appropriateness": 95,
    "typography_layout": 95,
    "cover_quality": 90,
    "thumbnail_quality": 90,
    "sales_page_sanitization": 100,
    "product_metadata_match": 100,
    "final_sellable": 92,
}

REQUIRED_PROOF_BOOLEANS = [
    "original_fixture_passed",
    "clean_install",
    "typecheck",
    "tests",
    "build",
]


def _load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"Manifest not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("Manifest root must be an object")
    return data


def validate_manifest(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    if data.get("final_status") != "final_pdf_ready":
        errors.append("final_status must equal 'final_pdf_ready'")

    assets = data.get("assets")
    if not isinstance(assets, dict):
        errors.append("assets must be an object")
    else:
        for key, expected in REQUIRED_ASSET_BOOLEANS.items():
            if assets.get(key) is not expected:
                errors.append(f"assets.{key} must be {expected}")

    defects = data.get("defect_counts")
    if not isinstance(defects, dict):
        errors.append("defect_counts must be an object")
    else:
        for key in ZERO_DEFECTS:
            value = defects.get(key)
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                errors.append(f"defect_counts.{key} must be numeric")
            elif value != 0:
                errors.append(f"defect_counts.{key} must equal 0, got {value}")

    scores = data.get("scores")
    if not isinstance(scores, dict):
        errors.append("scores must be an object")
    else:
        for key, minimum in MIN_SCORES.items():
            value = scores.get(key)
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                errors.append(f"scores.{key} must be numeric")
            elif value < minimum:
                errors.append(f"scores.{key} must be >= {minimum}, got {value}")

    proof = data.get("proof")
    if not isinstance(proof, dict):
        errors.append("proof must be an object")
    else:
        for key in REQUIRED_PROOF_BOOLEANS:
            if proof.get(key) is not True:
                errors.append(f"proof.{key} must be true")

        fresh = proof.get("consecutive_fresh_books_passed")
        if not isinstance(fresh, int) or isinstance(fresh, bool) or fresh < 3:
            errors.append("proof.consecutive_fresh_books_passed must be an integer >= 3")

        for key in ("manual_db_edits", "threshold_reductions", "gate_bypasses"):
            value = proof.get(key)
            if not isinstance(value, int) or isinstance(value, bool) or value != 0:
                errors.append(f"proof.{key} must be integer 0")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="Path to release manifest JSON")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable result")
    args = parser.parse_args()

    try:
        data = _load_json(args.manifest)
        errors = validate_manifest(data)
    except ValueError as exc:
        errors = [str(exc)]

    if args.json:
        print(json.dumps({"passed": not errors, "errors": errors}, indent=2))
    elif errors:
        print("SECRET_PDF_RELEASE_BLOCKED")
        for error in errors:
            print(f"- {error}")
    else:
        print("SECRET_PDF_RELEASE_PASSED")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
