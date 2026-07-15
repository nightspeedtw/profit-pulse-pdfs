#!/usr/bin/env python3
"""Validate a SecretPDF release manifest against non-negotiable release gates."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

ZERO_COUNT_FIELDS = (
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
)

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

REQUIRED_ASSETS = (
    "cover_present",
    "final_pdf_present",
    "final_pdf_opens",
    "thumbnail_present",
)

ALLOWED_FINAL_STATUSES = {"final_pdf_ready", "release_ready", "published"}


def _get_mapping(data: Dict[str, Any], key: str, errors: List[str]) -> Dict[str, Any]:
    value = data.get(key)
    if not isinstance(value, dict):
        errors.append(f"{key} must be an object")
        return {}
    return value


def validate_manifest(data: Dict[str, Any]) -> Tuple[bool, List[str], List[str]]:
    errors: List[str] = []
    warnings: List[str] = []

    mode = data.get("validation_mode")
    if mode not in {"book_release", "permanent_fix"}:
        errors.append("validation_mode must be 'book_release' or 'permanent_fix'")

    if not data.get("book_id"):
        errors.append("book_id is required")
    if not data.get("book_type"):
        errors.append("book_type is required")
    if data.get("final_status") not in ALLOWED_FINAL_STATUSES:
        errors.append(
            "final_status must be one of: " + ", ".join(sorted(ALLOWED_FINAL_STATUSES))
        )

    assets = _get_mapping(data, "assets", errors)
    for field in REQUIRED_ASSETS:
        if assets.get(field) is not True:
            errors.append(f"assets.{field} must be true")
    if assets.get("cover_blank") is not False:
        errors.append("assets.cover_blank must be false")

    counts = _get_mapping(data, "defect_counts", errors)
    for field in ZERO_COUNT_FIELDS:
        value = counts.get(field)
        if not isinstance(value, int):
            errors.append(f"defect_counts.{field} must be an integer")
        elif value != 0:
            errors.append(f"defect_counts.{field} must equal 0 (got {value})")

    scores = _get_mapping(data, "scores", errors)
    for field, minimum in MIN_SCORES.items():
        value = scores.get(field)
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            errors.append(f"scores.{field} must be numeric")
        elif value < minimum:
            errors.append(f"scores.{field} must be >= {minimum} (got {value})")
        elif value > 100:
            errors.append(f"scores.{field} cannot exceed 100 (got {value})")

    proof = _get_mapping(data, "proof", errors)
    required_true = ("original_fixture_passed", "clean_install", "typecheck", "tests", "build")
    for field in required_true:
        if proof.get(field) is not True:
            errors.append(f"proof.{field} must be true")

    for field in ("manual_db_edits", "threshold_reductions", "gate_bypasses"):
        value = proof.get(field)
        if not isinstance(value, int):
            errors.append(f"proof.{field} must be an integer")
        elif value != 0:
            errors.append(f"proof.{field} must equal 0 (got {value})")

    fresh = proof.get("consecutive_fresh_books_passed")
    if not isinstance(fresh, int):
        errors.append("proof.consecutive_fresh_books_passed must be an integer")
    else:
        required_fresh = 3 if mode == "permanent_fix" else 1
        if fresh < required_fresh:
            errors.append(
                "proof.consecutive_fresh_books_passed must be >= "
                f"{required_fresh} for {mode} mode (got {fresh})"
            )

    if data.get("book_type") != "children_illustrated":
        warnings.append(
            "This manifest uses illustrated-book visual thresholds; confirm they are appropriate "
            "for the selected book_type."
        )

    return not errors, errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="Path to release manifest JSON")
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit the validation result as JSON",
    )
    args = parser.parse_args()

    try:
        raw = args.manifest.read_text(encoding="utf-8")
        data = json.loads(raw)
    except FileNotFoundError:
        print(f"Manifest not found: {args.manifest}", file=sys.stderr)
        return 2
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Unable to read manifest: {exc}", file=sys.stderr)
        return 2

    if not isinstance(data, dict):
        print("Manifest root must be a JSON object", file=sys.stderr)
        return 2

    passed, errors, warnings = validate_manifest(data)
    result = {
        "passed": passed,
        "manifest": str(args.manifest),
        "errors": errors,
        "warnings": warnings,
    }

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print("PASS" if passed else "BLOCKED")
        for warning in warnings:
            print(f"WARNING: {warning}")
        for error in errors:
            print(f"ERROR: {error}")

    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
