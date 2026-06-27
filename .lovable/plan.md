## AI Ebook Factory — Full A-Z Autopilot System

Transform the current semi-manual pipeline into a hands-off autopilot that generates, QCs, writes, packages, and uploads premium PDF ebooks to Shopify — with automated quality gates at every step.

---

### 1. Database changes (one migration)

Extend `ebook_ideas` and `ebooks` with QC + autopilot fields:

**`ebook_ideas`** — add:
- `premium_score`, `hard_sell_score`, `commercial_intent_score`, `clarity_score`, `compliance_risk_score` (int)
- `outline_structure_score`, `outline_practical_score`, `outline_buyer_score`, `outline_depth_score`, `outline_premium_score`, `outline_duplicate_score` (int)
- `topic_rewrite_count`, `outline_rewrite_count` (int default 0)
- `auto_rejected_reason` (text)

**`ebooks`** — add:
- `chapter_qc` (jsonb — per-chapter scores + rewrite counts)
- `editorial_qc` (jsonb — final editorial scores + issues)
- `product_page_qc` (jsonb — conversion/hook/clarity/premium/compliance/seo)
- `final_quality_score`, `conversion_score`, `compliance_safety_score` (int)
- `shopify_product_id`, `shopify_status` (text: draft|published|failed)
- `autopilot_mode` (text: safe|full|manual)
- `autopilot_state` (text: running|paused|rejected|done|needs_review)
- `needs_review_reason` (text)
- `cover_image_url` (text)
- `product_copy` (jsonb — title, subtitle, bullets, faq, meta, tags, handle)

New table **`autopilot_runs`** — log every pipeline step (step, status, score, cost, duration, error) for the dashboard.

---

### 2. Edge functions (new + refactored)

**New shared module** `supabase/functions/_shared/qc.ts`:
- Single `scoreContent(kind, payload)` helper that calls Lovable AI Gateway and returns strict JSON scores. Uses a robust balanced-brace JSON extractor.
- Threshold constants and a `gate(scores, rules)` helper returning `{pass, failedFields, action}`.

**New functions:**
- `autopilot-orchestrator` — the brain. Given an `ebook_idea_id` and `mode`, walks the entire pipeline by chaining the existing/new step functions. Writes progress to `ebooks.autopilot_state` and `autopilot_runs`.
- `qc-topic` — scores topic across 6 dimensions, auto-rewrites up to 2x via the existing premium copywriter prompt, rejects if still failing.
- `qc-outline` — scores outline 6 dims, auto-improves up to 2x, rejects on failure.
- `qc-chapter` — runs after each chapter writes; rewrites chapter in place if any score <80.
- `qc-editorial` — full-book pass; fixes repetition, thin content, missing disclaimers; up to 2 rewrite rounds.
- `generate-product-copy` — Shopify copy + meta + tags + handle.
- `qc-product-copy` — 6-dim score + auto-rewrite.
- `generate-cover` — premium cover prompt → Lovable AI image gen → upload to `ebook-covers` bucket.
- `shopify-upload-draft` — creates Shopify draft product (Admin API), attaches cover + PDF link, sets price/tags/SEO.
- `qc-final-product` — pre-publish checklist (all assets exist, no placeholders, link works).
- `shopify-publish` — flips draft to active **only** if final gate passes; otherwise marks `needs_review`.

**Refactored:**
- `promote-idea` and `resume-generation` — call `qc-chapter` after each chapter; on fail, rewrite once before continuing.
- `generate-idea` — single best title only (already done); now also stores the 6 topic scores and triggers `qc-topic` inline.

---

### 3. Auto rules (enforced server-side)

| Gate | Threshold | Action if fail |
|---|---|---|
| Topic Buyer/Premium/Hard-Sell | ≥80 | rewrite ×2 → reject |
| Topic Compliance Risk | ≤4 | rewrite safer ×2 → reject |
| Outline (all 6) | ≥80 | improve ×2 → reject |
| Chapter (all 6) | ≥80 | rewrite that chapter once |
| Editorial | pass full checklist | auto-fix ×2 → reject |
| Product copy | ≥80 | rewrite once |
| Final ebook quality | ≥90 | else draft only |
| Conversion | ≥85 | else draft only |
| Compliance safety | ≥90 | else draft only |

Full Autopilot publishes only when **all** publish-gates pass.
Safe Autopilot stops at draft, never publishes.

---

### 4. Dashboard (`src/pages/admin/`)

**New page** `Autopilot.tsx`:
- Pipeline view per ebook: timeline of steps with status pill, score, rewrite count, cost.
- Filters: running / needs_review / rejected / published.
- Per-row buttons: Pause, Resume, Regenerate, Force Draft Upload, Force Publish, Reject, View QC Report.
- Mode toggle: Safe Autopilot / Full Autopilot / Manual.

**Update** `EbookReview.tsx`:
- Show all QC reports (topic, outline, per-chapter, editorial, product, final).
- Show Shopify status + link to draft.

**Update** `Pipeline.tsx`:
- Add lanes: `qc_topic`, `qc_outline`, `writing`, `qc_chapter`, `qc_editorial`, `cover`, `product_copy`, `shopify_draft`, `qc_final`, `published`, `needs_review`, `rejected`.

---

### 5. Shopify integration

Use existing Shopify connection (already authorized). On `shopify-upload-draft`:
- Upload cover to Shopify Files API.
- Create product as `status: DRAFT` with title, body_html (from product_copy), price, tags, SEO meta, product_type=Digital.
- Add a variant with `requires_shipping: false`.
- Attach PDF via a metafield (`custom.pdf_url`) pointing to a signed URL from `ebook-pdfs` bucket (24h expiry → refreshed on customer order via existing/future fulfillment flow).
- Store returned `shopify_product_id`.

On `shopify-publish`: PATCH product status → `ACTIVE`.

---

### 6. Safety / compliance

- Compliance rewriter prompt: strip absolute claims, add educational framing, add disclaimer chapter when category ∈ {finance, health, legal, relationships}.
- Auto-injected disclaimer page in PDF when compliance category triggered.
- Never publish if `compliance_safety_score < 90`.

---

### Technical notes

- All AI outputs return JSON only; every parser uses the shared balanced-brace extractor in `_shared/qc.ts`.
- Orchestrator is idempotent — safe to resume from any step using `ebooks.autopilot_state`.
- All long steps run async (orchestrator returns 202, work continues in background via `EdgeRuntime.waitUntil`).
- Costs logged to existing `cost_log` table tagged by step.
- Default model: `google/gemini-3-flash-preview` for QC/scoring; same for writing (already set).

---

### Out of scope (this round)

- Customer-facing PDF fulfillment automation (signed-URL email on order).
- A/B testing of titles after publish.
- Multi-language output.

Confirm and I'll start with the migration, then ship orchestrator + QC functions, then the Autopilot dashboard.