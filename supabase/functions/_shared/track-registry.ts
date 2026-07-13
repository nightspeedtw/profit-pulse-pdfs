// Single source of truth for the "track" a given ebook/idea belongs to.
//
// Every backend pipeline (autopilot orchestrator, per-step edge functions,
// cover/thumbnail template pickers) MUST resolve the track through this file
// so the kids picture-book pipeline and the adult premium-PDF pipeline never
// bleed into each other.
//
// Adding a new track later (e.g. "workbook", "finance-strict") = add an entry
// below + create the matching prompts/qc/covers files + register a
// sub-orchestrator in autopilot-orchestrator.

export type Track = "kids" | "adult";

interface TrackDef {
  slugs: string[];        // category_slug matches
  productTypes: string[]; // product_type matches
  markerFields?: string[]; // ebook.* fields whose presence forces this track
}

export const TRACKS: Record<Track, TrackDef> = {
  kids: {
    slugs: ["parenting-kids", "kids-books", "kids", "childrens-books"],
    productTypes: ["kids-book", "picture-book", "children-book", "storybook"],
    markerFields: ["kids_visual_bible", "kids_scene_briefs_json"],
  },
  adult: {
    // adult is the default; slugs listed for documentation only
    slugs: [
      "art-creative", "business-templates", "career-side-hustle", "cooking-recipes",
      "fitness-meal-plans", "health-wellness", "lifestyle-planners", "personal-finance",
      "productivity", "secret-ai", "secret-business", "secret-career", "secret-finance",
      "secret-marketing", "secret-money", "secret-productivity", "secret-relationships",
      "study-exam", "wellness-mind",
    ],
    productTypes: ["ebook", "guide", "playbook", "workbook", "template", "planner"],
  },
};

type ResolvableInput =
  | (Record<string, unknown> & {
      category_slug?: string | null;
      product_type?: string | null;
    })
  | null
  | undefined;

/**
 * Resolve the track for an ebook/idea record.
 * Priority: marker field → product_type → category_slug → adult (default).
 */
export function resolveTrack(input: ResolvableInput, extraSlug?: string | null): Track {
  if (!input) return "adult";
  const rec = input as Record<string, any>;

  // 1. explicit marker fields (kids-specific columns already populated)
  for (const f of TRACKS.kids.markerFields ?? []) {
    const v = rec[f];
    if (v && (typeof v !== "object" || Object.keys(v).length > 0)) return "kids";
  }

  // 2. product_type
  const pt = String(rec.product_type ?? "").toLowerCase().trim();
  if (pt) {
    if (TRACKS.kids.productTypes.includes(pt)) return "kids";
    if (TRACKS.adult.productTypes.includes(pt)) return "adult";
  }

  // 3. category_slug (from record or explicit fallback from parent join)
  const slug = String(rec.category_slug ?? extraSlug ?? "").toLowerCase().trim();
  if (slug) {
    if (TRACKS.kids.slugs.includes(slug)) return "kids";
    if (TRACKS.adult.slugs.includes(slug)) return "adult";
  }

  // 4. default
  return "adult";
}

export function isTrack(input: ResolvableInput, track: Track, extraSlug?: string | null): boolean {
  return resolveTrack(input, extraSlug) === track;
}

/**
 * Standard "wrong track" skip response — returned by any step function that
 * receives an ebook belonging to the other track. Prevents kids pipelines
 * from mutating adult ebooks AND adult pipelines from mutating kids ebooks.
 */
export function wrongTrackResponse(
  ebookId: string,
  expected: Track,
  got: Track,
  corsHeaders: Record<string, string>,
  stepName?: string,
) {
  return new Response(
    JSON.stringify({
      skipped: true,
      reason: "wrong-track",
      expected,
      got,
      step: stepName,
      ebook_id: ebookId,
      message: `This ebook belongs to the "${got}" track. Step "${stepName ?? "?"}" only runs for the "${expected}" track. Use the ${got}-track pipeline instead.`,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
