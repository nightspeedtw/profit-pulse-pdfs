#!/usr/bin/env python3

import copy
import unittest

from validate_release_manifest import validate_manifest


VALID = {
    "final_status": "final_pdf_ready",
    "assets": {
        "cover_present": True,
        "cover_blank": False,
        "final_pdf_present": True,
        "final_pdf_opens": True,
        "thumbnail_present": True,
    },
    "defect_counts": {
        "duplicate_pages": 0,
        "duplicate_text_blocks": 0,
        "duplicate_image_hashes": 0,
        "raw_markdown": 0,
        "html_comments": 0,
        "watermarks": 0,
        "random_image_text": 0,
        "truncated_text": 0,
        "metadata_mismatches": 0,
        "unverified_public_claims": 0,
        "placeholder_assets": 0,
    },
    "scores": {
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
    },
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


class ReleaseManifestTest(unittest.TestCase):
    def test_valid_manifest(self):
        self.assertEqual(validate_manifest(copy.deepcopy(VALID)), [])

    def test_duplicate_page_blocks_release(self):
        data = copy.deepcopy(VALID)
        data["defect_counts"]["duplicate_pages"] = 1
        self.assertTrue(any("duplicate_pages" in item for item in validate_manifest(data)))

    def test_threshold_reduction_blocks_release(self):
        data = copy.deepcopy(VALID)
        data["proof"]["threshold_reductions"] = 1
        self.assertTrue(any("threshold_reductions" in item for item in validate_manifest(data)))

    def test_requires_three_fresh_books(self):
        data = copy.deepcopy(VALID)
        data["proof"]["consecutive_fresh_books_passed"] = 2
        self.assertTrue(any("consecutive_fresh_books_passed" in item for item in validate_manifest(data)))

    def test_low_character_score_blocks_release(self):
        data = copy.deepcopy(VALID)
        data["scores"]["character_consistency"] = 94
        self.assertTrue(any("character_consistency" in item for item in validate_manifest(data)))


if __name__ == "__main__":
    unittest.main()
