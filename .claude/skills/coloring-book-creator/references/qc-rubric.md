# Coloring Book QC Rubric — Book-Level Weighted Acceptance

Runtime source of truth: `supabase/functions/_shared/coloring/gates.ts`
(`COLORING_BOOK_WEIGHTS`, `coloringBookWeightedGate`).

## Dimensions and weights (sum = 100)

| Dimension | Weight | Definition |
|---|---:|---|
| Theme fit | 15 | Every page recognizably belongs to the declared category / theme. |
| Age fit | 15 | Line weight, subject scale, detail density match the target age band. |
| Anatomy correctness | 15 | Correct count and placement of limbs, fingers/paws, eyes, ears, wings, tails, horns; no fusion, no extras, no missing parts, coherent faces. |
| Line-art cleanliness | 15 | Continuous smooth black contours; no sketch noise, double lines, or broken strokes. |
| Colorability | 10 | Every enclosed region is closed and white; no filled black shapes. |
| Composition & margins | 10 | Well-centered subject, safe margins on all four sides, no cropping. |
| Visual appeal | 10 | Warm, expressive, kid-friendly; the page is one you'd want to color. |
| Originality & diversity | 5 | Pages don't repeat concepts; scene taxonomy well-distributed. |
| Style consistency | 5 | Line thickness, eye style, proportions, background complexity match the frozen style contract across all pages. |

## Book passes only if ALL are true

- weighted average ≥ **92**
- every page composite ≥ **88** (no weak-link page)
- zero page-level hard-fails (`anatomy_defect`, `large_solid_black_area`,
  `copyrighted_ip`, `watermark`, `random_text`, `signature`,
  `grayscale_area`, `cropped_subject`, `out_of_category_object`,
  `duplicate_page`, `duplicate_image_hash`, `invalid_svg`)
- duplicate-scene rate < **5 %**
- typography spelling **100 %** on cover + any typographic pages

Never lower these thresholds without an owner-approved policy change.
