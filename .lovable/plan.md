# Kids Isolation + Weighted Autopilot + English-Only

## 1. Separate Kids backend (tables + functions)

New tables (mirror of adult schema, kids-only fields):
- `ebooks_kids` — id, title, subtitle, description, status, listing_status, age_group_id → `kids_age_groups`, theme_ids uuid[] → `kids_themes`, cover_url, pdf_url, storefront_meta jsonb, price_cents, all pipeline flags (locked, pipeline_status enum), timestamps
- `autopilot_kids_runs` — mirror of `autopilot_pipeline_runs` scoped to `ebook_kids_id`
- `autopilot_kids_steps` — mirror of `autopilot_pipeline_steps`
- `kids_production_queue` — mirror of production_queue
- `kids_download_grants` — mirror of download_grants (references ebooks_kids)
- Full GRANTs + RLS + admin-only policies via `has_role('admin')`

New/renamed edge functions (Kids namespace, isolated from adult):
- `autopilot-kids-orchestrator` — kids-only tick, reads `generation_settings` kids block
- `autopilot-kids-pipeline` — step runner writing to `autopilot_kids_runs/_steps`
- `autopilot-kids-cover`, `autopilot-kids-pdf`, `autopilot-kids-qc`, `autopilot-kids-publish` — split concerns
- `autopilot-kids-idea` — picks category per weighted-demand policy (see §2)
- Keep existing `rewrite-kids-manuscript` but rewire to `ebooks_kids`
- Adult functions no longer touch kids rows (guard clauses)

Frontend split:
- New route `/admin/kids` with its own Dashboard, Production, Autopilot, Store tabs
- Adult admin never lists kids books
- Public storefront: separate `/kids` catalog reading `ebooks_kids`

## 2. Autopilot categories — weighted by demand

- New table `kids_category_weights (id, age_group_id, theme_id, weight int, sales_last_30d int, updated_at)` unique per (age, theme)
- Admin UI grid: rows = age groups, columns = themes; edit weight 0-100 per cell; button "Recompute from sales" pulls order_items → increments `sales_last_30d`, sets weight = base + f(sales)
- Kids orchestrator idea picker: weighted-random sample from weights > 0 to choose age_group + theme, then generate

Admin UI at `/admin/kids/autopilot`:
- Toggle: kids autopilot on/off
- Weight matrix editor
- "Rotate all evenly" fallback toggle when no sales data

## 3. English-only across the site

Sweep Thai text out of:
- All `src/pages/**`, `src/components/**`, storefront pages, admin panels
- Category names in DB (`kids_age_groups.label_th`, `kids_themes.label_th`) → replace usage with `label_en`; add `label_en` columns if missing
- Toast messages, button labels, empty states, error messages
- Meta/SEO tags in `index.html`
- `<html lang="th">` → `lang="en"`

Automated pass: grep for Thai unicode block `[\u0E00-\u0E7F]` across src/ and rewrite each occurrence to English. Preserve semantics (e.g. "ทุกช่วงวัย" → "All ages").

## Order of execution

1. Migration A: create kids tables, weights table, add `label_en` columns
2. Migration B: seed English labels for existing age groups + themes
3. Deploy new kids edge functions; keep old kids functions as thin adapters temporarily
4. Build `/admin/kids` shell + route
5. Weight matrix UI + recompute action
6. English sweep (last so no rework)
7. Verify build with `tsgo`; smoke via curl on `autopilot-kids-orchestrator`

## Technical notes

- Kids uses **its own** `generation_settings` row (id=2) so guardrails are independent
- pipeline_status enum extended with kids-specific values if needed
- All new tables: `GRANT SELECT,INSERT,UPDATE,DELETE ... TO authenticated; GRANT ALL ... TO service_role;` policies use `has_role(auth.uid(),'admin')`
- Public read policy on `ebooks_kids WHERE listing_status='live'` for storefront (anon SELECT)

Confirm and I'll execute in the above order.