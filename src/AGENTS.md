# AGENTS.md — src/

Client-side code MUST NOT bypass server contracts. Do not:
- read internal QC / brief JSON to render customer copy;
- fall back to `ebooks_kids` internal fields on the storefront when a
  `customer_product_description_html` is missing (render an empty-state
  placeholder instead);
- toggle `sellable` / `listing_status` from the client;
- render the raw manuscript preview without the sanitizer.

Load relevant skills before non-trivial changes:
- Kids storefront + sales-page rendering → `secretpdf-release-guardian` +
  (once authored) `sales-page-conversion-guardian`.
- Admin autopilot dashboards + P0 incident UI →
  `secretpdf-observability-p0-responder`.
- Client-side PDF preview → `secretpdf-pdf-integrity-engineer` (never
  bypass its verdicts to display a "broken but visible" book).

See root `AGENTS.md` for non-negotiable rules.
