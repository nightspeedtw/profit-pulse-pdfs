# Sales Page and Conversion Copy

## Objective

Generate a clean customer-facing product page from verified final assets and metadata. Never expose internal production instructions.

## Separate internal and public data

Use different fields:

```text
internal_story_brief_json
internal_buyer_analysis_json
customer_product_description_html
customer_short_hook
customer_benefits_json
verified_product_metadata_json
```

Never use an internal brief as a fallback for public description.

## Build only from approved outputs

Sales copy uses:

- final approved title and subtitle
- final PDF metadata
- approved cover and thumbnail
- verified age/category tags
- actual worksheets, illustrations, and features
- actual delivery and refund policy

Do not claim features from the outline that are absent from the final book.

## Product-page structure

1. category and audience badges
2. strong title
3. one-line emotional promise
4. price and verified product facts
5. primary CTA
6. customer problem hook
7. child/reader benefits
8. parent/buyer benefits
9. curated preview
10. what is inside
11. delivery/license information
12. FAQ and truthful trust information

## Copy pattern for children's books

### Headline

Promise the emotional experience, not the production method.

### Subheadline

Describe the conflict, participation, and payoff without spoiling the ending.

### Benefits

Use concrete, supportable benefits:

- encourages trying again
- invites read-aloud participation
- supports discussion about feelings
- offers a playful mystery or adventure

Avoid medical, educational, or behavioral guarantees.

## Preview selection

Do not automatically show the first six pages or expose the full story.

Select 3–5 spreads that demonstrate:

- protagonist appeal
- inciting problem
- escalation
- visual variety
- emotional value

Avoid duplicate pages, spoilers, failed illustrations, and unverified assets.

Use a carousel or clean sample grid. Remove:

- HTML comments
- Markdown markers
- internal page IDs
- prompt notes
- debug labels

## Conversion copy sanitation

Hard fail if public copy contains:

- Story rule
- Callbacks
- Final payoff
- Why parent buys
- internal score notes
- prompt fragments
- raw JSON
- HTML comments
- placeholder tokens

## Metadata validation

The product page must match the final artifact:

- page count
- read time
- language
- age range
- trim size
- file type
- delivery format
- illustration count
- included worksheets or extras

## Trust claims

Show only verified claims. Hide or rewrite claims such as reader counts, guarantees, encryption, instant email delivery, and refund promises unless the actual system and policy support them.

## CTA

Use direct, product-specific language:

- Read the Adventure — $7.99
- Get the Illustrated Story
- Download the Workbook

Avoid false urgency and guaranteed outcomes.

## Sales-page gates

```text
internal_copy_leak_count = 0
html_comment_count = 0
placeholder_count = 0
metadata_match = 100
preview_assets_approved = true
preview_duplicate_count = 0
claim_verification = 100
sales_page_sanitization = 100
conversion_copy_score >= 90
```
