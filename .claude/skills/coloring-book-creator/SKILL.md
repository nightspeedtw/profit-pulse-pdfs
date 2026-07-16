---
name: coloring-book-creator
description: Reference standard for creating high-quality printable coloring books — anatomy correctness, no solid-black areas, scene-diversity taxonomy, repair ladder, weighted book-level acceptance, age-band defaults, IP/style guardrails. Consulted whenever generating or grading a coloring page or book.
---

# Coloring Book Creator — Reference Standard

Canonical coloring policy for SecretPDF. Merged into the runtime
pipeline at `supabase/functions/_shared/coloring/*`. This file remains
authoritative for **content-level standards**; runtime enforcement is
compiled in.

## Non-negotiable content rules

1. **Anatomy is a hard-fail class.** Extra / missing / fused / malformed
   limbs, fingers, paws, horns, wings, tails, or facial features — reject
   the page. Coloring pages center a huge subject; anatomy errors are the
   most customer-visible defect class.
2. **No large solid-black areas.** Outlines only. Every enclosed region
   must be white so a child can color it. Enforced deterministically via
   `analyzeSolidBlack` (black-pixel-ratio + largest-cluster-ratio).
3. **Scene diversity taxonomy.** Each book distributes across 8 buckets:
   `portrait, full_body, environment, action, relationship, celebration,
   learning, quiet`. Page-plan gate requires ≥5 of 8 buckets and no bucket
   > 35% of pages.
4. **Repair ladder** (never blind retry, never silent retire):
   - attempt 1 → repair (regenerate + corrective clauses)
   - attempt 2 → revise (structural clauses on anatomy/composition)
   - attempt 3 → simplify (drop secondary subjects, single centered
     subject, minimal background)
   - attempt 4+ → escalate to owner
5. **Book-level weighted acceptance** (see `qc-rubric.md`): passes only if
   avg ≥92 AND no page <88 AND zero hard-fails AND duplicate-scene rate
   <5% AND spelling 100%.
6. **Age-band defaults library** (`age-bands.ts`): 2-4, 4-6, 6-8, 8-12,
   teen_adult. New categories inherit the age-band default line weight,
   subject scale, detail density, and style snippet — no ad-hoc styles.
7. **No IP.** No living-artist style imitation. No recognizable
   copyrighted or trademarked characters, mascots, or brand IP. Enforced
   in prompt negatives + concept-generator guardrails + hard-fail
   `copyrighted_ip`.

## Runtime map

| Concern | Module |
|---|---|
| Locked style contract + prompt | `_shared/coloring/style-contract.ts` |
| Age-band defaults | `_shared/coloring/age-bands.ts` |
| Page-plan generation + taxonomy validation | `_shared/coloring/page-plan.ts` |
| Deterministic solid-black gate | `_shared/coloring/solid-black.ts` |
| Repair ladder | `_shared/coloring/repair-ladder.ts` |
| Page / cover / book / release gates | `_shared/coloring/gates.ts` |
| Renderer with calibration + repair | `coloring-book-render/index.ts` |

Read `references/qc-rubric.md` for the weighted rubric and
`references/production-standard.md` for the end-to-end production checklist.
