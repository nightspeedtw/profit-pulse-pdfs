## Round 1 Consolidation Plan

Owner order: fix 3 live defect classes discovered by external audit, bake every Round-1 lesson into a single permanent skill pack, and close Round 1 with a report. Books stay live throughout via atomic asset swap.

---

### CLASS A — Baked-title clipped covers (all 4 live books)

Root cause: Tier-1 Ideogram covers are generated square, then fit-COVER cropped to 8.5x11 portrait → baked title loses edge letters ("cean Friends", "ute Sea"), edge animals cut. Thumbnail letterboxes for the same aspect reason.

Permanent fixes (all four are required — one alone is insufficient):

1. **Portrait art at generation time** — patch `_shared/coloring/ideogram-integrated-cover.ts` to request the nearest supported portrait aspect (`10:16`) and add the prompt clause: *"all lettering must sit inside the central 80% of the frame — no letter, glyph, or stroke may touch the outer 10% band on any side."*
2. **Edge-glyph reject gate** — new `_shared/coloring/cover-edge-glyph-check.ts`: rasterize the outer 6% band, run text-ink detection (dark connected components with letter-like aspect ratio). Any ink in the band ⇒ reject art + retry (max 3 attempts before falling back to Tier-2 art-only + overlay).
3. **Assembler never crops baked-text covers** — update the coloring cover compositor / assembler: when source is Tier-1 (integrated typography), use `fit-CONTAIN` with palette-matched fill bars (sample from cover corners) instead of `fit-COVER`. Only art-only covers may be fit-COVER cropped.
4. **Product-page thumbnail = portrait `object-fit:cover`** — update `ProductCard.tsx` / `KidsBookCard.tsx` thumbnail box to a portrait aspect (`aspect-[3/4]`) with `object-cover` so true-portrait covers show edge-to-edge.

Then: rebuild all 4 live covers via one-shot batch script (calls `coloring-cover` edge fn in `regenerate_art=true` mode), reassemble PDFs, atomic-swap `cover_url` + `pdf_url` in a single transaction — books never leave `listing_status='live'`.

### CLASS B — Waived blurry pages shipped

Known blur casualties (external measurement):
- Sea Animals: p23, p35
- Ocean Friends: p23, p35
- Preschool: p20, p26, p29
- Farm & Woodland: clean → fixture reference

Actions:
1. New one-shot `coloring-book-page-blur-sweep` edge fn: for each live book, run boundary-edge-strength scorer (existing `SHARPNESS_GATE_VERSION v5`) over every page. Any page < floor 140 ⇒ mark page for repair.
2. Regenerate flagged pages under crisp regime (`steps=8` + crisp-line clauses, existing `CURRENT_COLORING_REPAIR_REGIME v4`).
3. Rebuild PDFs, atomic-swap `pdf_url`. Books stay live.
4. Record each repair in `defect_ledger` (fixed writer, see Class C).

### CLASS C — Ledger writer bug + backfill

Root cause: `waiveOrBlock()` records verdict but the caller-side ledger write is conditional on a code path that isn't hit under learning-mode waivers. Audit `_shared/coloring/qc-mode.ts` + every call site in `coloring-book-assemble` and render; ensure `appendDefectLedger` runs on every waive (idempotent by stage+gate+page key already handles re-runs).

Backfill: SQL update to synthesize `defect_ledger` rows for the 4 live books from `coloring_last_errors` + externally-observed Class-A/B defects (attempts=2, waived_at=now(), round=1).

### CONSOLIDATION — `round_1_skill_pack`

Single `pipeline_skills` row (`skill_key='round_1_defect_pack'`, `source='consolidated'`) enumerating every Round-1 defect class with, for each: **class name · symptom · root cause · prevention rule file · fixture test file · status**.

Classes to include (13):
1. cover compositor overwrite (opaque title canvas replacing art)
2. cover baked-title clipped (this round, Class A)
3. cover blank fallback
4. blur metric confound (sparse portraits false-failed → v5 boundary-edge)
5. dark-coat solid black interiors
6. ground shadow contamination
7. anatomy deformity vs imagination
8. interior text contamination
9. verifier model deprecation
10. provider billing burn (CF daily latch)
11. conveyor idle
12. sweep loop
13. live-without-assets (DB invariant guard)

For any class currently lacking a regression test, add a minimal deterministic test under `src/lib/` (naming pattern `coloring<Class>.test.ts`) that fails without the fix and passes with it.

### Round 1 Report

Generated as `.lovable/round_1_report.md`:
- defect class × frequency table (from `defect_ledger` post-backfill)
- FPY per book before repair vs after repair
- CF-vs-FAL provider distribution (once CF pool resets at 00:00 UTC — note in report if pool still latched)
- confirmation that all 4 live books survived repair without leaving `listing_status='live'` (assets_guard invariant proof)

### Order of operations

1. Ship Class-A code fixes (ideogram portrait + edge-glyph gate + assembler contain + thumbnail).
2. Ship Class-C ledger-writer fix.
3. Deploy `coloring-book-page-blur-sweep` and cover-rebuild batch runners.
4. Run backfill SQL + trigger repairs for all 4 books, atomic-swap.
5. Write consolidated skill pack + any missing regression tests.
6. Generate Round 1 report.

### Technical notes

- Atomic swap = single `UPDATE ebooks_kids SET pdf_url=$new, cover_url=$new, updated_at=now() WHERE id=$id` after new assets uploaded to storage under versioned paths. `ebooks_kids_live_assets_guard` trigger already blocks the invariant violation of null-asset while live.
- Fit-contain fill-bar sampling: median RGB of the 8 corner-adjacent 32×32 tiles of the source art.
- Edge-glyph detector: threshold to binary at Otsu, connected-components with 8 ≤ height ≤ 80 px and 0.2 ≤ aspect ≤ 3.0 inside the outer 6% band ⇒ text-like.

### Out of scope for this round
- No Shopify, no payment activation, no royalty/exchange changes.
- CF-vs-FAL A/B stays observational (report only) — no policy change since CF pool still latched until 00:00 UTC.
