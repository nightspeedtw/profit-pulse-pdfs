// Client-side mirror of the Track 2 thumbnail style profile catalog.
// Kept minimal for admin UI use — full prompt rules live in
// supabase/functions/_shared/thumbnail-style-system.ts.
export type StyleProfileLite = {
  slug: string;
  display_name: string;
  badge_label: string;
  tone: string;
  price_band: { min: number; max: number };
  illustration_density: "low" | "medium" | "high";
  requires_disclaimer: boolean;
};

export const STYLE_PROFILES_LITE: StyleProfileLite[] = [
  { slug: "finance", display_name: "Finance & Investing", badge_label: "EBOOK", tone: "serious", price_band: { min: 19, max: 39 }, illustration_density: "low", requires_disclaimer: true },
  { slug: "business_career", display_name: "Business & Career", badge_label: "EBOOK", tone: "premium", price_band: { min: 19, max: 39 }, illustration_density: "low", requires_disclaimer: false },
  { slug: "wellness", display_name: "Wellness & Self-Help", badge_label: "GUIDE", tone: "calm", price_band: { min: 19, max: 39 }, illustration_density: "medium", requires_disclaimer: true },
  { slug: "workbook", display_name: "Workbook / Planner", badge_label: "PLANNER", tone: "technical", price_band: { min: 9, max: 17 }, illustration_density: "medium", requires_disclaimer: false },
  { slug: "parenting", display_name: "Parenting & Family", badge_label: "GUIDE", tone: "calm", price_band: { min: 19, max: 39 }, illustration_density: "medium", requires_disclaimer: true },
  { slug: "children_illustrated", display_name: "Children (Illustrated)", badge_label: "KIDS STORY", tone: "cheerful", price_band: { min: 7, max: 19 }, illustration_density: "high", requires_disclaimer: false },
  { slug: "creative", display_name: "Creative & Hobby", badge_label: "EBOOK", tone: "playful", price_band: { min: 9, max: 29 }, illustration_density: "medium", requires_disclaimer: false },
  { slug: "beginner", display_name: "Beginner Guide", badge_label: "GUIDE", tone: "premium", price_band: { min: 9, max: 17 }, illustration_density: "low", requires_disclaimer: false },
  { slug: "fiction", display_name: "Fiction / Short", badge_label: "EBOOK", tone: "dramatic", price_band: { min: 7, max: 19 }, illustration_density: "low", requires_disclaimer: false },
  { slug: "general", display_name: "General", badge_label: "EBOOK", tone: "premium", price_band: { min: 9, max: 29 }, illustration_density: "low", requires_disclaimer: false },
];

export function findProfile(slug: string | null | undefined): StyleProfileLite | undefined {
  if (!slug) return undefined;
  return STYLE_PROFILES_LITE.find((p) => p.slug === slug);
}
