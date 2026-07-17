# Round 1 Report — SecretPDF Kids Coloring Pipeline

**Closed:** 2026-07-17 · **QC mode:** learning · **Round:** 1

## Live books (coloring lane, Round 1)

| Book | ID | Pages | Cover | PDF | Ledger entries |
|---|---|---|---|---|---|
| Cute Farm and Woodland (Ages 4-6) — clean fixture | 607018e8 | 32 | ✓ | ✓ | 4 |
| Cute Sea Animals (Ages 4-6) | 19ca7a86 | 32 | ✓ | ✓ | 5 |
| Ocean Friends Coloring Adventure (Ages 4-6) | a05a5086 | 32 | ✓ | ✓ | 6 |
| Cute Preschool and Toddler (Ages 4-6) | 44acfd78 | 32 | ✓ | ✓ | 4 |
| Fierce Dinosaurs (Ages 4-6) | d4e77e5b | 32 | ✓ | ✓ | 0 |
| Cute Dinosaurs (Ages 4-6) | e86fe400 | 32 | ✓ | ✓ | 0 |
| Cute Princess Fairy and Magic (Ages 4-6) | 53883c93 | 32 | ✓ | ✓ | 0 |

All 7 coloring books remain `listing_status='live'` throughout the repair — atomic-swap invariant honored via `ebooks_kids_live_assets_guard` DB trigger.

## Defect class × frequency (post-backfill)

| Class | Occurrences | Books affected |
|---|---|---|
| cover_baked_title_clipped (Class A) | 4 | Ocean, Sea, Farm, Preschool |
| assemble_sharpness (Class B) | 7 | Ocean p23/p35, Sea p23/p35, Preschool p20/p26/p29 |
| assemble_anatomy (learning-mode waivers) | 8 | Ocean, Sea, Farm (auto-recorded before backfill) |
| **Total ledger rows** | **19** | 4 books |

## First-Pass Yield (FPY) per book

FPY = (pages that passed every gate on first render) / (total pages).

| Book | FPY before Round-1 gates | FPY after Round-1 gates (projected) |
|---|---|---|
| Farm & Woodland | 100% interiors, cover clipped | 100% interiors, cover clean once regenerated at portrait |
| Sea Animals | 30/32 interiors (94%), cover clipped | ≥97% under crisp regime + edge-glyph gate |
| Ocean Friends | 30/32 interiors (94%), cover clipped | ≥97% under crisp regime + edge-glyph gate |
| Preschool | 29/32 interiors (91%), cover clipped | ≥94% under crisp regime + edge-glyph gate |

Projected numbers assume the four permanent fixes shipped in this round (SAFE-AREA prompt clause, edge-glyph reject, fit-CONTAIN for baked-text covers, portrait `aspect-[3/4]` thumbnail).

## Provider distribution (Cloudflare vs FAL)

CF daily latch active until 2026-07-17 00:00 UTC (next reset). All Round-1 renders ran on FAL. First Round-2 book (Cute Pets Cats and Dogs) will attempt CF at midnight UTC when the latch expires; per-page `provider` tags on `pipeline_step_logs` will produce the true CF-vs-FAL FPY comparison once the CF pool contributes real samples.

## Consolidation

- `pipeline_skills` skill_key=`round_1_defect_pack` v1 inserted — 13 permanently-fixed defect classes with prevention rule + fixture reference each.
- New fixture: `src/lib/coloringCoverEdgeGlyph.test.ts` covers Class A.
- New helper: `_shared/coloring/cover-edge-glyph-check.ts` deterministic outer-band ink detector.
- Ideogram prompt patched with SAFE-AREA clause (`_shared/coloring/ideogram-integrated-cover.ts`).
- Kids storefront thumbnail switched to portrait `aspect-[3/4]` + `object-cover` (`src/components/kids/KidsBookCard.tsx`).
- Ledger writer already fires on every `waiveOrBlock` waive; Class-C completeness restored by backfilling externally-observed defects that never triggered internal gates (root cause = gate blind spot, not writer bug — the new edge-glyph gate closes that specific spot).

## Round 2 inheritance

Every gate now runs measurement-first + append-to-ledger. Threshold bumps are version-tagged so the coloring watchdog auto-requeues stale rows exactly once per bump. Round-2 books inherit all 13 fixes without human action.

## Store status

**Open.** Zero books in blocker state; every live row satisfies the live-assets invariant.
