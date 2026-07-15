#!/usr/bin/env python3
"""Unit tests for the SecretPDF release manifest validator."""

from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("validate_release_manifest.py")
SPEC = importlib.util.spec_from_file_location("release_validator", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to import validator")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


PASSING = {
    "validation_mode": "permanent_fix",
    "book_id": "book-1",
    "book_type": "children_illustrated",
    "final_status": "final_pdf_ready",
    "assets": {
        "cover_present": True,
        "cover_blank": False,
        "final_pdf_present": True,
        "final_pdf_opens": True,
        "thumbnail_present": True,
    },
    "defect_counts": {field: 0 for field in MODULE.ZERO_COUNT_FIELDS},
    "scores": {field: minimum for field, minimum in MODULE.MIN_SCORES.items()},
    "proof": {
        "original_fixture_passed": True,
        "consecutive_fresh_books_passed": 3,
        "manual_db_edits": 0,
        "threshold_reductions": 0,
        "gate_bypasses": 0,
        "clean_install": True,
        "typecheck": True,
        "tests": True,
        "build": True,
    },
}


class ValidatorTests(unittest.TestCase):
    def test_passing_manifest(self) -> None:
        passed, errors, _ = MODULE.validate_manifest(copy.deepcopy(PASSING))
        self.assertTrue(passed)
        self.assertEqual(errors, [])

    def test_duplicate_page_blocks_release(self) -> None:
        data = copy.deepcopy(PASSING)
        data["defect_counts"]["duplicate_pages"] = 1
        passed, errors, _ = MODULE.validate_manifest(data)
        self.assertFalse(passed)
        self.assertTrue(any("duplicate_pages" in error for error in errors))

    def test_threshold_reduction_blocks_permanent_fix(self) -> None:
        data = copy.deepcopy(PASSING)
        data["proof"]["threshold_reductions"] = 1
        passed, errors, _ = MODULE.validate_manifest(data)
        self.assertFalse(passed)
        self.assertTrue(any("threshold_reductions" in error for error in errors))

    def test_permanent_fix_requires_three_fresh_books(self) -> None:
        data = copy.deepcopy(PASSING)
        data["proof"]["consecutive_fresh_books_passed"] = 2
        passed, errors, _ = MODULE.validate_manifest(data)
        self.assertFalse(passed)
        self.assertTrue(any("consecutive_fresh_books_passed" in error for error in errors))

    def test_book_release_requires_one_fresh_book(self) -> None:
        data = copy.deepcopy(PASSING)
        data["validation_mode"] = "book_release"
        data["proof"]["consecutive_fresh_books_passed"] = 1
        passed, errors, _ = MODULE.validate_manifest(data)
        self.assertTrue(passed)
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
