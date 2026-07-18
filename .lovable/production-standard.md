# Production Standard — Coloring Books

**Version:** `golden_path_coloring_v1`
**Adopted:** 2026-07-18
**Owner-approved.**

## One template. Category-only variation.

- Age band: **4–6**
- Page count: **32**
- Style contract: `DEFAULT_KIDS_4_6_STYLE` (locked; do NOT swap per book)
- Interior model: Runware `runware:100@1` (flux schnell) via failover chain
  (Cloudflare → Runware → fal)
- Cover model: GPT Image Tier-1 → Ideogram fallback
  - 5-invocation ceiling per book (`MAX_COVER_INVOCATIONS_PER_BOOK = 5`)
  - Inpaint-only text retries before full regenerate
- Anatomy vision QC: batched **8 pages per call** (single structured JSON)
- QC thresholds are unchanged. Only call *volume* was consolidated.

## Category whitelist (proven live)

`dinosaurs`, `sea_animals`, `farm_and_woodland`, `pets_cats_dogs`,
`floral_botanical`, `unicorn_fantasy`, `princess_fairy_magic`,
`preschool_toddler`, `seasonal_holidays`, `mermaid_ocean_fantasy`.

Non-whitelisted categories require explicit
`generation_settings.coloring_autopilot.category_whitelist_extra = [key, …]`.

## Two-strikes → rotate

Any single gate failing twice on the same book:
`pipeline_status='parked_rotated'`, `blocker_reason='two_strikes_<gate>'`.
`parkAndRotate()` fires a replacement queue insert.  Nothing blocks the line.

## No mid-book calibration pause for whitelisted categories

Whitelisted books auto-approve calibration and run start-to-finish.
Anatomy + style + aspect gates already enforce what the 25% pause checked.

## Source of truth

`supabase/functions/_shared/coloring/golden-path.ts`
`supabase/functions/coloring-autopilot-tick/index.ts`
`pipeline_skills.skill='golden_path_coloring_v1'`
