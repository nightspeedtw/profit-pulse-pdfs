# PDF Integrity Contract

## Deterministic preflight

Before visual scoring, verify:

- valid PDF bytes and MIME type;
- nonzero size and page count;
- expected asset ID/version/hash;
- unique canonical pages;
- correct page order;
- complete text blocks;
- embedded fonts or valid font fallbacks;
- safe margins and no clipping;
- final cover is present and nonblank.

## Duplicate prevention

Reject if any of these exceed zero:

- duplicate canonical page number;
- duplicate normalized story-text hash;
- duplicate illustration hash where the page is expected to differ;
- repeated chunk or repeated spread sequence.

Retry logic must upsert the logical page rather than append it.

## Text sanitation

Reject public PDF content containing raw:

- Markdown headings, rules, blockquotes, code fences, or bold markers;
- HTML comments or internal page keys;
- prompt fragments or generation notes;
- truncated quotes or dangling sentences.

## Cover

Require a complete commercial cover with the canonical character/style, legible title, safe margins, no blank placeholder, and no inherited body-page layout.

## Evidence

Record rule ID, page number, measured value, threshold, screenshot/evidence path, repair action, and verification result for every finding.
