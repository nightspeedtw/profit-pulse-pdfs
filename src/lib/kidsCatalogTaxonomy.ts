// Kids Catalog Taxonomy v1
// Canonical vocabulary for age bands, book types, developmental themes,
// buyer-job personas, and SEO landing-page configuration.
// Mirrored to supabase/functions/_shared/kids-catalog-taxonomy.ts

// Owner-canonical AGE CHIPS shown on /kids. These are DISPLAY BUCKETS
// (data-driven, not hardcoded strings in components). Products match a
// chip via age-range overlap so a 3–5 book appears under both 2–4 (overlap
// at 4) and 4–6. `all_ages` matches only products with band=all_ages.
// The backend keeps its finer 9-band taxonomy (coloring_age_bands) intact.
export type AgeChipSlug = "all" | "2-4" | "4-6" | "6-8" | "8-12" | "13-17" | "all_ages";

export interface AgeChip {
  slug: AgeChipSlug;
  label: string;      // full label
  short: string;      // chip label
  min: number | null; // inclusive; null = ALL (no filter)
  max: number | null; // inclusive; null = ALL
  kind: "range" | "all" | "all_ages";
}

export const AGE_CHIPS: AgeChip[] = [
  { slug: "all",      label: "All",        short: "All",      min: null, max: null, kind: "all" },
  { slug: "2-4",      label: "Ages 2–4",   short: "2–4",      min: 2,  max: 4,  kind: "range" },
  { slug: "4-6",      label: "Ages 4–6",   short: "4–6",      min: 4,  max: 6,  kind: "range" },
  { slug: "6-8",      label: "Ages 6–8",   short: "6–8",      min: 6,  max: 8,  kind: "range" },
  { slug: "8-12",     label: "Ages 8–12",  short: "8–12",     min: 8,  max: 12, kind: "range" },
  { slug: "13-17",    label: "Ages 13–17", short: "13–17",    min: 13, max: 17, kind: "range" },
  { slug: "all_ages", label: "All Ages",   short: "All Ages", min: null, max: null, kind: "all_ages" },
];

// Legacy AgeBandSlug retained for SEO landing pages (CATEGORY_PAGES filter).
export type AgeBandSlug = "0-3" | "3-5" | "4-6" | "6-8";
export type BookTypeSlug = "illustrated_storybook" | "coloring_book";
export type ThemeSlug =
  | "bedtime"
  | "kindness"
  | "courage"
  | "big-feelings"
  | "friendship-family"
  | "helping-others"
  | "stem-educational"
  | "humor-fun";
export type BuyerJobSlug = "parent_calm" | "teacher" | "gift";

export interface AgeBand { slug: AgeBandSlug; label: string; short: string; minAge: number; maxAge: number; }
export interface BookType { slug: BookTypeSlug; label: string; short: string; }
export interface Theme { slug: ThemeSlug; label: string; }
export interface BuyerJob { slug: BuyerJobSlug; label: string; personaHook: string; }

export const AGE_BANDS: AgeBand[] = [
  { slug: "0-3", label: "0–3 · Board-Style",     short: "0–3", minAge: 0, maxAge: 3 },
  { slug: "3-5", label: "3–5 · Picture Books",   short: "3–5", minAge: 3, maxAge: 5 },
  { slug: "4-6", label: "4–6 · Picture Books",   short: "4–6", minAge: 4, maxAge: 6 },
  { slug: "6-8", label: "6–8 · Early Readers",   short: "6–8", minAge: 6, maxAge: 8 },
];

// KIDS ceiling — anything with age_min > this is an adult product and is
// hidden from /kids entirely (adults/seniors get their own storefront).
export const KIDS_AGE_CEILING = 17;

/** Parse a stored age_band string like "6-8" / "6_8" / "13-17" into numeric bounds. */
function parseAgeBandRange(band: string | null | undefined): { min: number; max: number } | null {
  if (!band) return null;
  const m = band.match(/(\d+)\s*[-_–]\s*(\d+)/);
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
}

/** True if the book (age_min..age_max) matches the given chip via overlap. */
export function bookMatchesAgeChip(
  book: { age_min?: number | null; age_max?: number | null; age_band?: string | null },
  chip: AgeChip,
): boolean {
  if (chip.kind === "all") return true;
  const isAllAgesBand = (book.age_band ?? "").toLowerCase() === "all_ages"
    || (book.age_min === 2 && book.age_max === 99);
  if (chip.kind === "all_ages") return isAllAgesBand;
  if (isAllAgesBand) return false;
  // Fall back to parsing age_band when numeric range is missing — most
  // published books carry only the band string.
  let bookMin = book.age_min;
  let bookMax = book.age_max;
  if (bookMin == null || bookMax == null) {
    const parsed = parseAgeBandRange(book.age_band);
    if (parsed) { bookMin = parsed.min; bookMax = parsed.max; }
  }
  if (bookMin == null || bookMax == null) return false;
  if (chip.min == null || chip.max == null) return false;
  return bookMin <= chip.max && chip.min <= bookMax;
}

/** True if the book belongs on the /kids storefront (age_max <= ceiling or all_ages). */
export function bookIsForKids(book: { age_min?: number | null; age_max?: number | null; age_band?: string | null }): boolean {
  const band = (book.age_band ?? "").toLowerCase();
  if (band === "all_ages") return true;
  if (book.age_max == null) return true; // unknown → surface, don't drop
  return book.age_max <= KIDS_AGE_CEILING;
}


export const BOOK_TYPES: BookType[] = [
  { slug: "illustrated_storybook", label: "Illustrated Storybook", short: "Storybook" },
  { slug: "coloring_book",         label: "Coloring Book",         short: "Coloring"  },
];

export const THEMES: Theme[] = [
  { slug: "bedtime",           label: "Bedtime & Calm" },
  { slug: "kindness",          label: "Kindness & Sharing" },
  { slug: "courage",           label: "Courage & Trying Again" },
  { slug: "big-feelings",      label: "Big Feelings" },
  { slug: "friendship-family", label: "Friendship & Teamwork" },
  { slug: "helping-others",    label: "Helping Others" },
  { slug: "stem-educational",  label: "Curiosity & STEM" },
  { slug: "humor-fun",         label: "Humor & Fun" },
];

export const BUYER_JOBS: BuyerJob[] = [
  {
    slug: "parent_calm",
    label: "Calmer Bedtimes",
    personaHook: "For parents who want the last 10 minutes of the day to be soft, not a battle.",
  },
  {
    slug: "teacher",
    label: "For the Classroom",
    personaHook: "Discussion-ready read-alouds with clear themes teachers can build a lesson around.",
  },
  {
    slug: "gift",
    label: "Perfect Gifts",
    personaHook: "Keepsake stories with a personal touch — the kind grandparents send and kids remember.",
  },
];

export interface CategoryFilter {
  age_band?: AgeBandSlug;
  theme?: ThemeSlug;
  book_type?: BookTypeSlug;
  buyer_job?: BuyerJobSlug;
}

export interface CategoryPage {
  slug: string;
  titleTag: string;
  metaDescription: string;
  h1: string;
  intro: string;
  filter: CategoryFilter;
  keywords: string[];
}

const KEYWORDS = {
  bedtime:  ["children's bedtime story", "bedtime story PDF", "calming read aloud", "illustrated kids ebook"],
  kindness: ["kindness story for kids", "sharing story kids", "printable children's book"],
  coloring: ["printable coloring book", "kids coloring pages PDF", "coloring book download"],
  ages:     ["ages 3-6 storybook", "picture book PDF", "illustrated kids ebook"],
  gift:     ["giftable kids ebook", "keepsake picture book", "children's book gift"],
};

export const CATEGORY_PAGES: CategoryPage[] = [
  // Theme landings
  {
    slug: "bedtime-stories",
    titleTag: "Bedtime Story PDFs for Ages 3–6 — Illustrated & Read-Aloud Ready | SecretPDF",
    metaDescription: "Soft, illustrated bedtime stories in instant-download PDF. Calming reads matched to ages 3–6, ready to print or read on any tablet.",
    h1: "Bedtime Stories for Little Ones",
    intro: "A hand-picked shelf of calming, illustrated bedtime books built for the wind-down window. Every story is a full 32-page PDF, print-ready, and matched to a child's reading age.",
    filter: { theme: "bedtime" },
    keywords: KEYWORDS.bedtime,
  },
  {
    slug: "kindness-stories",
    titleTag: "Kindness Stories for Kids — Illustrated Read-Alouds | SecretPDF",
    metaDescription: "Kindness and sharing stories for young readers. Instant-download illustrated PDFs, discussion-ready, printable at home.",
    h1: "Kindness & Sharing Stories",
    intro: "Warm-hearted illustrated stories that turn kindness, sharing, and small acts of courage into moments kids ask to re-read.",
    filter: { theme: "kindness" },
    keywords: KEYWORDS.kindness,
  },
  {
    slug: "courage-stories",
    titleTag: "Courage & Try-Again Stories for Kids | SecretPDF",
    metaDescription: "Illustrated stories about brave first tries, second chances, and growing into big feelings — instant PDFs for ages 3–8.",
    h1: "Courage & Trying Again",
    intro: "Books that help small readers name a big feeling — nervous, shy, unsure — and take the first brave step anyway.",
    filter: { theme: "courage" },
    keywords: ["courage stories for kids", "growth mindset picture book", "trying again story"],
  },
  {
    slug: "friendship-stories",
    titleTag: "Friendship & Teamwork Stories for Kids | SecretPDF",
    metaDescription: "Illustrated friendship and teamwork stories in instant PDF. Warm read-alouds for ages 3–8.",
    h1: "Friendship & Teamwork",
    intro: "Stories about the friends kids find, the ones they make, and the small teamwork wins that feel enormous.",
    filter: { theme: "friendship-family" },
    keywords: ["friendship story for kids", "kids teamwork book", "illustrated kids ebook"],
  },

  // Age landings
  {
    slug: "ages-0-3",
    titleTag: "Board-Style Story PDFs for Ages 0–3 | SecretPDF",
    metaDescription: "Simple, bright illustrated stories built for babies and toddlers — instant PDFs, print-ready, ages 0–3.",
    h1: "Books for Ages 0–3",
    intro: "Short sentences, bright art, gentle rhythm — books calibrated for the very youngest listeners.",
    filter: { age_band: "0-3" },
    keywords: ["toddler picture book", "0-3 board book PDF", "baby storybook"],
  },
  {
    slug: "ages-3-5",
    titleTag: "Picture Book PDFs for Ages 3–5 — Illustrated & Read-Aloud | SecretPDF",
    metaDescription: "Illustrated picture books for ages 3–5. Instant PDF download, printable, matched by developmental theme.",
    h1: "Picture Books for Ages 3–5",
    intro: "A full library of illustrated picture books written for the preschool ear — playful language, one clear idea per page, a story worth re-reading.",
    filter: { age_band: "3-5" },
    keywords: KEYWORDS.ages,
  },
  {
    slug: "ages-4-6",
    titleTag: "Picture Book PDFs for Ages 4–6 — Instant Download | SecretPDF",
    metaDescription: "Illustrated picture books for ages 4–6 — bedtime, kindness, courage, STEM. Instant PDF, printable at home.",
    h1: "Picture Books for Ages 4–6",
    intro: "Stories that fit the way 4-to-6-year-olds listen — a hook by page 2, a satisfying twist, a re-readable last page.",
    filter: { age_band: "4-6" },
    keywords: KEYWORDS.ages,
  },
  {
    slug: "ages-6-8",
    titleTag: "Early Reader PDFs for Ages 6–8 | SecretPDF",
    metaDescription: "Illustrated early-reader stories for ages 6–8. Instant download PDF, printable, ready for independent readers.",
    h1: "Early Readers for Ages 6–8",
    intro: "Longer story arcs, richer vocabulary, and characters kids grow with — for the years when reading becomes their own.",
    filter: { age_band: "6-8" },
    keywords: ["early reader PDF", "ages 6-8 chapter book", "illustrated early reader"],
  },

  // Book-type landing
  {
    slug: "coloring-books",
    titleTag: "Printable Kids Coloring Books — Instant PDF Download | SecretPDF",
    metaDescription: "Original illustrated coloring books for kids. Print-ready PDFs, unique themes, thick clean line-art perfect for crayons and markers.",
    h1: "Kids Coloring Books",
    intro: "Original, print-ready coloring books drawn in a clean, kid-friendly line style. Available in 16, 24, 32, and 48-page PDFs — download once, print as many times as you want.",
    filter: { book_type: "coloring_book" },
    keywords: KEYWORDS.coloring,
  },

  // Buyer-job collections
  {
    slug: "calmer-bedtimes",
    titleTag: "Calmer Bedtimes — Read-Aloud Story PDFs | SecretPDF",
    metaDescription: "A parent-picked shelf of calming bedtime read-alouds. Illustrated, print-ready, matched to age and mood.",
    h1: "For Calmer Bedtimes",
    intro: BUYER_JOBS[0].personaHook + " These are the reads chosen by parents who want the last 10 minutes of the day to be soft.",
    filter: { buyer_job: "parent_calm" },
    keywords: KEYWORDS.bedtime,
  },
  {
    slug: "for-the-classroom",
    titleTag: "Classroom Read-Aloud Stories for Teachers | SecretPDF",
    metaDescription: "Discussion-ready illustrated stories with clear developmental themes. Instant PDF, printable, teacher-picked.",
    h1: "For the Classroom",
    intro: BUYER_JOBS[1].personaHook + " Each book has a clear theme, a strong story arc, and language calibrated to its age band.",
    filter: { buyer_job: "teacher" },
    keywords: ["classroom read aloud", "teacher picture book", "SEL story kids"],
  },
  {
    slug: "perfect-gifts",
    titleTag: "Keepsake Kids Books That Make Perfect Gifts | SecretPDF",
    metaDescription: "Giftable illustrated children's books — download, print, wrap. Keepsake stories with a personal feel.",
    h1: "Perfect Gifts",
    intro: BUYER_JOBS[2].personaHook + " Every book is a full 32-page illustrated story you can print and gift as a keepsake.",
    filter: { buyer_job: "gift" },
    keywords: KEYWORDS.gift,
  },
];

export function resolveCategory(slug: string | undefined | null): CategoryPage | null {
  if (!slug) return null;
  return CATEGORY_PAGES.find((c) => c.slug === slug) ?? null;
}

export interface FilterableBook {
  age_band?: string | null;
  book_type?: string | null;
  theme_slugs?: string[] | null;
  buyer_job_tags?: string[] | null;
}

export function bookMatchesFilter(book: FilterableBook, filter: CategoryFilter): boolean {
  if (filter.age_band && book.age_band !== filter.age_band) return false;
  if (filter.book_type && book.book_type !== filter.book_type) return false;
  if (filter.theme && !(book.theme_slugs ?? []).includes(filter.theme)) return false;
  if (filter.buyer_job && !(book.buyer_job_tags ?? []).includes(filter.buyer_job)) return false;
  return true;
}

export interface KidsUrlParams {
  age?: AgeChipSlug | AgeBandSlug | null;
  theme?: ThemeSlug | null;
  type?: BookTypeSlug | null;
}

export function buildKidsUrl(params: KidsUrlParams, base = "/kids"): string {
  const q = new URLSearchParams();
  if (params.age)   q.set("age",   params.age);
  if (params.theme) q.set("theme", params.theme);
  if (params.type)  q.set("type",  params.type);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export function parseKidsUrl(search: URLSearchParams): KidsUrlParams {
  return {
    age:   (search.get("age")   as AgeChipSlug | AgeBandSlug | null)  ?? null,
    theme: (search.get("theme") as ThemeSlug   | null)  ?? null,
    type:  (search.get("type")  as BookTypeSlug | null) ?? null,
  };
}

export function resolveAgeChip(slug: string | null | undefined): AgeChip | null {
  if (!slug) return null;
  return AGE_CHIPS.find((c) => c.slug === slug) ?? null;
}

export const CATEGORY_SLUGS = CATEGORY_PAGES.map((c) => c.slug);
