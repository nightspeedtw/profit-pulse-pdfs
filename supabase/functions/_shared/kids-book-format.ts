// Single source of truth for the DEFAULT kids picture-book format.
// Any function producing manuscript pages, interior illustrations, PDF pages,
// QC gates, or storefront previews must import from here — never hard-code.

export const KIDS_BOOK_FORMAT = {
  // Trim: 8.5 × 8.5 in square. PDF page geometry exactly 612 × 612 pt.
  page_width_pt: 612,
  page_height_pt: 612,
  trim_inches: 8.5,
  aspect: "1:1 square",

  // Length envelope (front matter included).
  min_total_pages: 32,
  max_total_pages: 40,

  // Story body pages (interior illustrations, one scene per page).
  story_min_pages: 28,
  story_max_pages: 36,
  story_target_pages: 28,

  // Front + back matter that ships in every book.
  front_matter_pages: 3,  // cover + title + copyright
  back_matter_pages: 1,   // warm closing / "The End"

  // Age band this format is tuned for.
  default_age_band: "4-6",
  words_per_page_min: 8,
  words_per_page_max: 40,
  words_total_max: 800,

  // Interior illustration aspect (matches page).
  interior_image_size: "square_hd" as const, // fal image_size token
  interior_aspect_hint: "square 1:1 composition, edges bleed to the page border",

  // Cover matches interior trim.
  cover_aspect: "1:1 square",

  // PDF-build staging: split N story pages into ≤5-page batches so each Edge
  // invocation stays under the worker memory/CPU wall-clock limit while the
  // in-progress PDF grows.
  pdf_pages_per_stage: 5,
} as const;

export type KidsBookFormat = typeof KIDS_BOOK_FORMAT;

// Pipeline-skill row payload for this spec — seeded via migration and readable
// via the standard pipeline_skills loader.
export const KIDS_BOOK_FORMAT_SKILL_MD = `BOOK FORMAT — Kids picture book (default, non-negotiable):
- Trim: 8.5 × 8.5 inches SQUARE. PDF page geometry 612 × 612 pt. Every page.
- Total length: 32–40 pages including title + copyright + closing.
- Story body: 28–36 illustrated pages, ONE scene per page.
- Full-color illustration on EVERY page — no text-only pages.
- 1–3 short sentences per page, placed where they never fight the art.
- Consistent character/style across every page (style bible + vision QC enforced).
- Cover: square 1:1, matches interior character + style.
`;

// Split a set of story pages into stages of ≤pdf_pages_per_stage.
export function planPdfStages(numStoryPages: number): Array<{ stage: string; start: number; end: number }> {
  const per = KIDS_BOOK_FORMAT.pdf_pages_per_stage;
  const stages: Array<{ stage: string; start: number; end: number }> = [];
  for (let s = 0, i = 1; s < numStoryPages; s += per, i++) {
    stages.push({ stage: `pdf_pages_${i}`, start: s, end: Math.min(s + per, numStoryPages) });
  }
  return stages;
}
