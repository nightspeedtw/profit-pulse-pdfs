## Goal
Ship the three deferred conversion features fully automatically — no admin UI, no per-book manual data entry. Every live coloring book gets a working "Preview 5 Pages", "Free Sample PDF", and email drip out of the box.

## How auto-defaults replace admin work

| Field previously requiring admin | Auto-derived from |
|---|---|
| `preview_pages` (which 5 pages to show) | First 5 interior pages from `coloring_v2_pages` where `stage='interior_render'` ordered by `page_number`. Deterministic, same for every book. |
| `sample_pdf_url` | Generated on first sample request per book, cached in `ebooks_kids.metadata.sample_pdf_url`. Rebuilt if interior pages change. |
| `sample_email_enabled` | Always `true` for `listing_status='live'` coloring books. |
| `full_product_cta_url` | `/kids/coloring/{slug}` — already known. |
| `bundle_offer_url` | Computed by existing `useSuggestedBundle` logic (same category or age band). |

No new columns on `ebooks_kids`, no admin panel.

## Build steps

### 1. Sample PDF edge function — `generate-sample-pdf`
- Input: `{ book_id }`.
- Reads first 5 interior page image URLs from `coloring_v2_pages`.
- Composes 5-page PDF (US Letter) with a cover page ("Free Sample — {title}", brand footer, "Buy full 82-page book" CTA URL) + 5 interior pages, each stamped with a subtle "Sample — SecretPDF Kids" footer so the sample can't substitute for the paid product.
- Uploads to `ebook-pdfs` bucket at `samples/{book_id}.pdf`, signed URL cached in `metadata.sample_pdf_url` + `metadata.sample_pdf_built_at`.
- Idempotent: returns cached URL if interior page set hash unchanged.

### 2. `sample_leads` table + RLS
```
sample_leads(
  id uuid pk, created_at timestamptz,
  email text not null, first_name text,
  book_id uuid references ebooks_kids(id),
  product_slug text, product_category text,
  lead_source text default 'free_sample',
  drip_stage int default 0,          -- 0=welcome sent, 1=bundle sent, 2=last-chance sent
  drip_next_at timestamptz,
  unsubscribed_at timestamptz
)
```
GRANTs + RLS: `anon` insert only (via edge function using service role, not direct); `authenticated` no access; `service_role` all. No client-side reads.

### 3. Public edge function — `submit-sample-lead`
- Accepts `{ email, first_name, book_id }`.
- Validates with Zod, rate-limits by IP+email (existing pattern).
- Ensures sample PDF exists (calls `generate-sample-pdf` if needed).
- Inserts into `sample_leads`, schedules `drip_next_at = now()`.
- Returns `{ sample_pdf_url, bundle_offer_url }` so the modal success state renders immediately.

### 4. Resend drip worker — `sample-drip-tick` (pg_cron every 15 min)
Three transactional templates in `_shared/transactional-email-templates/`:
- `sample-welcome` (stage 0 → 1, delay 0m): download link + book CTA.
- `sample-bundle` (stage 1 → 2, delay 24h): bundle/category upsell.
- `sample-last-chance` (stage 2 → done, delay 72h): urgency + discount code.

Worker picks rows where `drip_next_at <= now()` and `unsubscribed_at is null`, sends via `send-transactional-email`, advances `drip_stage` + `drip_next_at`. Unsubscribe handled by existing `handle-email-unsubscribe`.

### 5. Frontend wiring (minimal)
- `ColoringPreviewLightbox` already caps at 5 pages — no change needed; it just reads the first 5 interior URLs the product page already loads.
- `FreeSamplePreviewModal` submit → `submit-sample-lead` (replace current stub). Success state renders returned `sample_pdf_url` as the download button + `bundle_offer_url` as the upsell CTA.
- No new fields shown in any admin screen.

### 6. Backfill / rollout
- No migration data changes required for existing books — sample PDFs generate lazily on first request.
- Bundle URL uses existing suggestion hook — nothing to seed.

## Technical notes (for engineers)
- Email domain + `setup_email_infra` prerequisites must already be satisfied; if `email_domain--check_email_domain_status` isn't `active`, the drip worker still enqueues (queue tolerates pending domain).
- `generate-sample-pdf` reuses the existing `pdf-preflight`/composition helpers where possible; no new PDF library.
- All three new edge functions are `verify_jwt = false` (public) except `sample-drip-tick` (cron/service-role).
- Rate-limit `submit-sample-lead` at 5/min/IP to prevent list-bombing.

## Out of scope
- Admin UI, per-book overrides, custom preview page selection, custom sample copy — everything auto.
- Changing which pages appear in the on-page 5-page lightbox (already the first 5 interior pages).

## Definition of done
1. Fresh live book with no admin action shows a working "Preview 5 Pages" (already true) and returns a real 5-page sample PDF after email submit.
2. Lead row appears in `sample_leads`; welcome email arrives; bundle email at +24h; last-chance at +72h.
3. Unsubscribe link works and stops the drip.
4. Zero admin fields, zero manual per-book setup.
