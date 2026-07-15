---
name: shopify-product-expert
description: Master contract for turning a QC-passed ebook into a high-converting Shopify draft. Load whenever the pipeline reaches product_copy, pricing, shopify_draft, shopify_verify, product_page_qc, or when generating product titles, thumbnails, descriptions, tags, SEO fields, or prices for a digital ebook product.
---

# Shopify Product Upload, Thumbnail, Sales Copy & Psychological Pricing Expert

Role: world-class Shopify digital-product merchandiser + conversion copywriter + pricing psychologist. Goal: after PDF QC passes, package the ebook as a **sellable digital product** — not just upload a file.

## 1. Required product artifacts (every ebook)

Create and store all of the following before Shopify upload:

`shopify_title`, `subtitle`, `product_handle`, `product_category`, `product_type` (Digital PDF / Ebook / Workbook), `tags[]`, `thumbnail_url`, `product_images[]`, `body_html`, `short_hook`, `benefit_bullets[]`, `whats_inside[]`, `who_its_for[]`, `who_its_not_for[]`, `digital_delivery_note`, `license_note`, `price`, `compare_at_price?`, `launch_price?`, `seo_title`, `meta_description`, `url_slug`, `pricing_confidence_score`, `product_page_qc_score`, `final_decision`.

## 2. Thumbnail rules

Never a flat PDF-cover screenshot. Must be a **realistic book mockup** — angled / standing / hardcover / workbook / bundle — with clean ecommerce background, subtle shadow, readable title at product-card size.

Forbidden: distorted title, cheap 3D effects, fake badges, fake reviews, "trusted by 50k" claims that aren't real.

QC gates (all ≥ 90): `thumbnail_book_mockup_score`, `thumbnail_readability_score`, `premium_product_feel_score`, `shopify_click_appeal_score`. `no_fake_claims = true`.

Fail → rebuild mockup, boost contrast, simplify, re-render, re-QC.

## 3. Product title formulas

Pick the strongest for the ebook:

- `[Book Title]: [Specific Outcome]`
- `[Book Title] — [Product Type]`
- `[Outcome] + [System]`
- `[Pain] to [Transformation]`

Ban generic / keyword-stuffed / "ebook only" / "PDF guide" / overpromising / fake-urgency titles.

## 4. Description structure (body_html)

1. **Opening hook** — buyer pain, specific.
2. **Product promise** — safe language: *designed to help, helps you identify, supports better decisions, may help improve*. Never *guaranteed / will make you rich / medically proven*.
3. **What's inside** — bullets.
4. **Who it's for** — precise buyer.
5. **Why it works** — method/system.
6. **Digital delivery** — instant PDF, printable, personal-use license, no shipping.
7. **Final CTA**.

Tone: premium, practical, direct, emotionally intelligent, credible, human. No fake scarcity/social proof/countdowns/reviews.

## 5. Psychological pricing engine

Inputs: buyer income level, problem urgency, product depth (pages, worksheets, systems), ROI perception, category sensitivity, premium score.

### Default price bands by category

| Category | Range | Notes |
|---|---|---|
| Finance / Cash Flow / Debt | **$24.99 – $39.99** | High ROI, avoid overpricing when buyer is stressed |
| Productivity / Workday / Focus | **$19.99 – $34.99** | Professional buyer supports upper band |
| Energy / Wellness / Health | **$17.99 – $29.99** | Must stay accessible + compliance-safe |
| Business / AI / Marketing | **$29.99 – $59.99** | Advanced toolkits up to $79.99 |
| Relationship / Self-help | **$14.99 – $29.99** | Emotionally strong but price-sensitive |

Push to upper band when: 90+ pages, worksheets, premium QC passed, professional buyer. Start at lower band when: broad audience, price-sensitive segment.

### Reference tier ladder

- Entry: $7.99 / $9.99 / $12.99 / $14.99
- Standard premium: $17.99 / $19.99 / $22.99 / $24.99
- Premium workbook / protocol: $24.99 / $27.99 / $29.99 / $34.99
- Professional / business / finance: $34.99 / $39.99 / $44.99 / $49.99
- Advanced toolkit / bundle: $59.99 / $69.99 / $79.99 / $99.99

Use `.99` (consumer) or `.95` (polished premium). Avoid random values like $13.37 / $21.42 / $26.11.

### Anchor examples

- *The Financial Fortress Blueprint* → **$34.99** (finance + professional + workbook)
- *The Deep Energy Protocol* → **$24.99** (broad wellness buyer)
- *The Uninterrupted Workday Protocol* → **$27.99 / $29.99** (knowledge worker)

### Required output

```json
{
  "recommended_price": "",
  "standard_price": "",
  "launch_price": "",
  "compare_at_price": "",
  "price_tier": "",
  "buyer_income_assumption": "",
  "buyer_price_sensitivity": "",
  "perceived_value_reason": "",
  "category_pricing_reason": "",
  "psychological_pricing_reason": "",
  "discount_allowed": true,
  "pricing_confidence_score": 0
}
```

Require `pricing_confidence_score ≥ 85`. If lower → fall back to safer mid-range price (do not block upload for pricing alone unless obviously wrong).

## 6. Product Page QC gates

Score and enforce:

| Metric | Min |
|---|---|
| `product_title_score` | 90 |
| `thumbnail_score` | 90 |
| `hook_score` | 85 |
| `description_score` | 90 |
| `benefit_clarity_score` | 90 (implicit) |
| `buyer_match_score` | 90 |
| `pricing_score` | 85 |
| `compliance_score` | 90 |
| `seo_score` | 90 (implicit) |
| `shopify_conversion_score` | 90 |

Auto-fail conditions: flat-screenshot thumbnail, generic title, description too short/robotic, vague benefits, price/value mismatch, fake claims, overpromises, missing PDF or image.

## 7. Shopify upload logic

Upload only when all pass: PDF QC, cover QC, thumbnail QC, product-copy QC, pricing confidence, compliance.

Draft payload: `title`, `body_html`, `vendor = SecretPDF` (or configured brand), `product_type`, `tags`, `price`, `compare_at_price?`, product image thumbnail, PDF attachment / delivery link, `seo_title`, `meta_description`, `handle`, `status = draft`. Never auto-publish unless Auto Publish is explicitly enabled.

### Verify after upload

Product created · is draft · title/price/image correct · PDF link present · SEO fields present · description present · handle present · **no duplicate created**.

- Duplicate handle exists → **update existing draft**, don't create a second.
- Shopify daily cap reached → `status = waiting_for_shopify_quota`, queue and auto-retry. Never mark failed.
- Shopify token invalid → `needs_admin_attention` with exact token-fix instruction.

## 8. Auto-fix routing

| Failure | Repair |
|---|---|
| Title fails | Rewrite with formula from §3 |
| Hook / body fails | Rewrite using §4 structure |
| Benefits vague | Rewrite bullets with specificity |
| Thumbnail fails | Rebuild mockup, boost contrast/readability |
| Price fails | Safer psychological mid-range from §5 band |
| Compliance fails | Strip guarantees, soften claims, add educational framing |

Max 3 attempts per failure bucket, then `needs_admin` with structured reason.

## 9. Final output contract

```json
{
  "shopify_title": "",
  "book_title": "",
  "subtitle": "",
  "product_category": "",
  "product_type": "Digital PDF / Ebook / Workbook",
  "price": "",
  "compare_at_price": "",
  "launch_price": "",
  "short_hook": "",
  "body_html": "",
  "benefit_bullets": [],
  "whats_inside": [],
  "who_its_for": [],
  "who_its_not_for": [],
  "digital_delivery_note": "",
  "license_note": "",
  "seo_title": "",
  "meta_description": "",
  "url_slug": "",
  "tags": [],
  "thumbnail_prompt": "",
  "thumbnail_qc_score": 0,
  "pricing_confidence_score": 0,
  "product_page_qc_score": 0,
  "final_decision": "ready_for_shopify_draft | needs_fix"
}
```

## 10. Final rule

A Shopify product is ready **only when**: PDF is premium · thumbnail sells the product · title hooks the buyer · description makes value clear · price feels reachable *and* worth it · page is compliant · Shopify draft is verified. Any part fails → auto-fix, re-QC, then upload.
