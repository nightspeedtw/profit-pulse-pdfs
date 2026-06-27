# AI Ebook Factory — Build Plan

## 1. Foundation (Lovable Cloud)
- Enable Lovable Cloud (Postgres + Auth + Storage + Edge Functions + Cron).
- Email/password auth, single-admin gate via `user_roles` table + `has_role()` security-definer.
- Seed first admin: any user who signs up while `user_roles` is empty auto-becomes admin (one-time bootstrap).
- Route `/admin/*` protected; redirects to `/admin/login` if not admin.

## 2. Database schema
- `categories` — id, name, slug, default_price, cover_style_prompt.
- `ebook_ideas` — id, category_id, title, subtitle, target_buyer, hook, scores (jsonb: urgency, transformation, commercial, evergreen, emotional, clarity, total), status (`idea|outline|writing|qc_failed|approved|uploaded|published`), cost_usd, created_at.
- `ebooks` — id, idea_id, toc (jsonb), chapters (jsonb[]), bonuses (jsonb), product_description, seo_title, seo_meta, tags, cover_prompt, cover_url, pdf_url, word_count, qc (jsonb: duplicate, generic, grammar, value_score, appeal_score, refund_risk, unsafe_claims[]), shopify_product_id, shopify_handle, price, vendor, status, cost_usd.
- `generation_settings` — singleton row: daily_quota (5/10/20/50/custom), mode (`low_cost|premium|hybrid`), enabled_categories[], auto_publish (bool, default false).
- `cost_log` — id, ebook_id, step, model, input_tokens, output_tokens, cost_usd, created_at.
- `generation_jobs` — id, type, payload jsonb, status, error, created_at — for queueing async work.
- Storage buckets (private): `ebook-pdfs`, `ebook-covers`.
- RLS: admin-only on all tables via `has_role(auth.uid(),'admin')`.

## 3. Edge functions (Lovable AI Gateway)
- `generate-idea` — given category, produce {title, subtitle, target_buyer, hook} + score 6 buyer-psych dimensions (1–10 each, total weighted) using `google/gemini-3-flash-preview`. Reject if total < threshold.
- `generate-outline` — TOC + chapter briefs.
- `generate-content` — full chapters (loop per chapter to stay under token limits), bonuses (checklist, workbook, templates, action plan).
- `generate-marketing` — product description (hook → pain → benefits → what's inside → who-for → bonuses → FAQ → CTA), SEO title/meta, tags, cover prompt.
- `qc-check` — duplicate title (DB lookup + semantic), generic-phrase detector, min word count, grammar pass, value/appeal/refund-risk scoring, unsafe-claim regex + LLM review. Sets `qc_failed` or `approved`.
- `generate-cover` — only after QC pass; `google/gemini-3-pro-image`, upload to storage.
- `build-pdf` — uses `reportlab` via… wait, edge functions are Deno. We'll use `pdf-lib` (npm:pdf-lib) to compose cover + TOC + chapters + bonus pages from a styled template. Upload to `ebook-pdfs` bucket, generate signed URL.
- `push-to-shopify` — `shopify--create_product` (draft status), attach cover image, set price/vendor/type/tags/SEO, store handle. Digital download URL goes in description + product metafield (manual Digital Downloads app linkage noted).
- `daily-cron` — scheduled via Supabase pg_cron, runs based on `generation_settings.daily_quota`, enqueues `generation_jobs`.
- `process-job` — worker invoked by cron/trigger; runs full pipeline for one ebook.

## 4. Frontend — `/admin` dashboard
Layout: sidebar nav + topbar with cost-today counter.

- **Dashboard** (`/admin`): today's stats (ideas, approved, uploaded, cost), 7-day chart, quick "Generate now" button.
- **Settings** (`/admin/settings`): daily quota (5/10/20/50/custom slider), mode toggle, auto-publish switch, category multiselect, score threshold sliders.
- **Categories** (`/admin/categories`): CRUD categories + default price + cover style.
- **Ideas** (`/admin/ideas`): table with score breakdown, filter by status, bulk approve/reject, "promote to outline".
- **Pipeline** (`/admin/pipeline`): kanban (idea → outline → writing → QC → approved → uploaded → published).
- **Ebook review** (`/admin/ebook/:id`): full editor — edit title, subtitle, price, tags, SEO, description (rich textarea), per-chapter content (collapsible), cover preview + regenerate, QC scorecard, "Build PDF" → "Push to Shopify Draft" → "Publish" actions.
- **Costs** (`/admin/costs`): per-ebook + daily totals, breakdown by step.

## 5. Quality-first guardrails
- Hard min word count: 8,000 (configurable). Below = auto-fail QC.
- Refund-risk score ≥ 7 blocks upload.
- Unsafe-claim regex list (medical, financial guarantees, get-rich-quick) → manual review required.
- Duplicate title check across `ebooks` table.
- Cover generated **only** after QC pass (saves cost).
- Mode `low_cost` uses gemini-flash-lite for ideation, flash for content. `premium` uses gemini-3.1-pro for everything. `hybrid` = flash for content, pro for marketing copy + QC.

## 6. PDF template
Styled neo-brutalist matching the existing Printly brand (foreground borders, mono headers, highlight accents):
- Cover page (AI-generated image + title overlay)
- Copyright + "Who this is for" page
- TOC
- Chapter pages (numbered, pull-quote callouts)
- Bonus section (checklists as boxes, workbook prompts as lines)
- Back cover with CTA + author/brand

## 7. Shopify upload
- Always `status: "draft"`, `published: false`.
- `product_type: "Digital Ebook"`, `vendor: "Printly"`, `requires_shipping: false`, `inventory_policy: "continue"`, `weight: 0`.
- Cover image uploaded via `images: [{file_path}]`.
- PDF: stored in our bucket; admin manually links to Digital Downloads app (instruction shown post-upload). v2 can auto-fulfill via Shopify Files API.
- Publish action flips status to `active`.

## 8. Cost tracking
- Every gateway call logged to `cost_log` with token counts → USD via static rate table per model.
- Daily budget cap in settings; cron stops if exceeded.

## Technical notes
- Stack: existing React+Vite+Tailwind+shadcn frontend. New `/admin` section reuses the Printly neo-brutalist design system (no new fonts/colors).
- Auth: Lovable Cloud email/password; bootstrap admin on first signup.
- AI Gateway: server-side only in edge functions; default `google/gemini-3-flash-preview`, image `google/gemini-3-pro-image`.
- Cron: Supabase pg_cron + `net.http_post` to invoke `daily-cron` edge function at 09:00 UTC.
- Shopify: drafts only; admin must approve before publish. Reuses existing `shopify--create_product` tool path (server side via edge function calling Shopify Admin API with stored token — note: we'll need a Shopify Admin API token stored as secret for server-side product creation, since edge functions can't call the Lovable agent's `shopify--*` tools).

## Open question / assumption
The `shopify--create_product` is a Lovable agent tool, not a runtime API. For **automated** daily uploads from cron, the edge function needs a Shopify **Admin API access token** stored as a secret. I'll add a step in Settings → "Connect Shopify Admin token" with instructions to create a custom app in Shopify Admin → Apps → Develop apps → install → copy Admin API token. Without it, the daily cron pipeline stops at "ready to upload" and admin clicks "Push to Shopify" in the UI, which will then use the agent tool path via a manual action.

## Build order (3 phases, can ship incrementally)
1. **Phase 1 (foundation)**: Cloud + auth + schema + admin shell + Settings/Categories pages.
2. **Phase 2 (generation)**: idea→outline→content→marketing→QC edge functions + Ideas + Pipeline + Ebook review UI + cost tracking.
3. **Phase 3 (delivery)**: cover gen + PDF builder + Shopify push + daily cron + costs page.

Phase 1 alone is ~15–20 files. Full build is 50+. I'll ship Phase 1 first, you test login + settings + categories, then I continue.