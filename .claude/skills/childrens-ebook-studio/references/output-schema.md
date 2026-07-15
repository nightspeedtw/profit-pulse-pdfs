# Structured Output Schema

Use this structure for database, API, or autopilot output.

```json
{
  "project": {
    "title": "",
    "subtitle": "",
    "language": "en-US",
    "age_min": 4,
    "age_max": 7,
    "format": "picture_book",
    "trim_size": "8.5x8.5in",
    "page_count": 32,
    "target_words": 750,
    "status": "draft"
  },
  "brief": {},
  "concepts": [],
  "selected_concept": {},
  "story_bible": {},
  "characters": [],
  "visual_bible": {},
  "pages": [
    {
      "page_number": 1,
      "spread_number": 1,
      "page_type": "story",
      "text": "",
      "visual_beat": "",
      "illustration_prompt": "",
      "negative_prompt": "",
      "continuity": {},
      "qc": {}
    }
  ],
  "cover": {
    "concepts": [],
    "selected": {},
    "front_prompt": "",
    "back_prompt": "",
    "spine_copy": ""
  },
  "front_matter": {},
  "back_matter": {},
  "metadata": {
    "description": "",
    "keywords": [],
    "categories": [],
    "age_range": "",
    "grade_range": ""
  },
  "qc": {
    "hard_gates": [],
    "scores": {},
    "total": 0,
    "issues": [],
    "revisions": [],
    "human_review": [],
    "release_status": "draft"
  }
}
```

Require stable IDs for projects, versions, characters, pages, and generated assets in an application.
