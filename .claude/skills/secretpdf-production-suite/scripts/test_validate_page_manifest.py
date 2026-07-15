#!/usr/bin/env python3

import copy
import unittest

from validate_page_manifest import validate


VALID = {
    "pages": [
        {
            "canonical_page_number": 1,
            "approved": True,
            "text_hash": "t1",
            "image_hash": "i1",
            "story_event_id": "e1",
            "story_text": "A clean cover title layer.",
            "text_complete": True,
        },
        {
            "canonical_page_number": 2,
            "approved": True,
            "text_hash": "t2",
            "image_hash": "i2",
            "story_event_id": "e2",
            "story_text": "The story begins.",
            "text_complete": True,
        },
    ]
}


class PageManifestTest(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(validate(copy.deepcopy(VALID)), [])

    def test_duplicate_number(self):
        data = copy.deepcopy(VALID)
        data["pages"][1]["canonical_page_number"] = 1
        self.assertTrue(any("duplicate canonical_page_number" in item for item in validate(data)))

    def test_duplicate_hash(self):
        data = copy.deepcopy(VALID)
        data["pages"][1]["image_hash"] = "i1"
        self.assertTrue(any("duplicate image_hash" in item for item in validate(data)))

    def test_raw_comment(self):
        data = copy.deepcopy(VALID)
        data["pages"][1]["story_text"] = "<!-- page 2 -->Story"
        self.assertTrue(any("raw production markup" in item for item in validate(data)))


if __name__ == "__main__":
    unittest.main()
