// Curated illustration styles for coloring-book covers.
//
// OWNER LAW `cover_illustrated_only_v12` still applies — every style below
// keeps the title HAND-LETTERED inside the artwork by the image model. This
// module only rotates the *art direction* + *lettering treatment* so the
// catalog reads as a variety of premium illustrated covers instead of one
// gouache-watercolor look repeated forever.
//
// Consumed by `supabase/functions/coloring-v2-cover/index.ts`.

export interface CoverArtStyle {
  id: string;
  label: string;
  /** Replaces the "warm cheerful storybook style ..." fragment. */
  prompt_fragment: string;
  /** Replaces the "hand-lettered painted typography" fragment. */
  title_lettering_fragment: string;
  /** Base pick weight before recency + affinity adjustments. */
  weight: number;
  /** Optional title/theme boost. */
  themeAffinity?: RegExp;
}

export const COVER_ART_STYLES: CoverArtStyle[] = [
  {
    id: "bouncy_bubble_letters",
    label: "Bouncy Bubble Letters (Pop Rainbow)",
    weight: 3,
    prompt_fragment:
      "Bold pop-cartoon coloring-book cover, saturated rainbow palette (cherry red, tangerine, sunshine yellow, mint, sky blue, hot pink), thick clean outlines, chunky playful shapes, flat cel-shading with soft gradient highlights, joyful bouncy energy, premium picture-book cover feel.",
    title_lettering_fragment:
      "The title MUST be painted as HUGE inflated BUBBLE LETTERS — puffy, glossy, each letter a different rainbow color, thick black outline, soft white highlight and drop-shadow painted in. Letters bounce on a slight arc, slightly tilted, integrated into the scene like a pop-art logo.",
  },
  {
    id: "soft_gouache_storybook",
    label: "Soft Gouache Storybook",
    weight: 2,
    prompt_fragment:
      "Warm cheerful storybook style — gouache + watercolor feel, textured paper, soft edges, cozy earthy palette (cream, honey, sage, terracotta), expressive characters, premium picture-book cover.",
    title_lettering_fragment:
      "Title hand-lettered in warm brushed gouache script with painted highlight and soft shadow, sitting on a torn-paper ribbon that is part of the painting.",
  },
  {
    id: "crayon_scribble_kids",
    label: "Crayon Scribble Kids Art",
    weight: 2,
    prompt_fragment:
      "Charming child-like crayon illustration, waxy crayon texture, primary + secondary crayon palette, playful uneven shapes, visible crayon strokes, joyful nursery-art feel — but professionally composed as a premium cover.",
    title_lettering_fragment:
      "Title drawn as chunky uneven CRAYON LETTERS with waxy texture, each letter a different crayon color, scribble-shadow behind, hand-drawn feel.",
  },
  {
    id: "cut_paper_collage",
    label: "Cut-Paper Collage",
    weight: 2,
    prompt_fragment:
      "Cut-paper collage illustration in the spirit of Eric Carle — layered torn and cut construction paper, visible paper texture, painterly stamps, bold graphic silhouettes, joyful primary + teal palette.",
    title_lettering_fragment:
      "Title composed of hand-cut PAPER LETTERS stacked on the collage — each letter a different textured paper color, tiny paper shadow behind, slightly crooked placement.",
  },
  {
    id: "retro_saturday_cartoon",
    label: "Retro Saturday-Morning Cartoon",
    weight: 2,
    prompt_fragment:
      "1970s Saturday-morning cartoon poster style — flat retro palette (mustard, tomato, avocado, cream), halftone dot shading, bold black inking, groovy shapes, nostalgic Hanna-Barbera energy.",
    title_lettering_fragment:
      "Title painted as retro GROOVY LOGO LETTERS — chunky rounded 70s display type, mustard + tomato fill, thick black outline, halftone shading, slight banana curve.",
  },
  {
    id: "kawaii_sticker_pastel",
    label: "Kawaii Sticker Pastel",
    weight: 2,
    prompt_fragment:
      "Japanese kawaii sticker-book style, pastel palette (baby pink, mint, lavender, butter yellow, sky), tiny happy faces on every element, soft rounded shapes, sparkle motifs, adorable and premium.",
    title_lettering_fragment:
      "Title lettered as PUFFY KAWAII STICKER TYPE — rounded pastel bubble letters with white sticker border, tiny sparkle and heart accents baked into the letters.",
    themeAffinity: /\b(unicorn|fairy|kitty|panda|bunny|princess|magic|sparkle)\b/i,
  },
  {
    id: "flat_vector_bold",
    label: "Flat Vector Bold",
    weight: 2,
    prompt_fragment:
      "Modern flat-vector children's illustration, bold geometric shapes, limited palette of 4 saturated colors (teal, coral, mustard, navy), zero gradients, crisp premium editorial feel.",
    title_lettering_fragment:
      "Title as bold flat-vector display type — chunky sans-serif with slight rounded corners, painted flat solid colors matching the palette, thin offset shadow. Still drawn INTO the artwork, not overlaid.",
  },
  {
    id: "ink_watercolor_wash",
    label: "Ink & Watercolor Wash",
    weight: 2,
    prompt_fragment:
      "Loose black ink line-work with soft watercolor washes bleeding outside the lines, muted jewel palette, textured cotton-paper feel, gentle and refined — premium hardcover picture book.",
    title_lettering_fragment:
      "Title hand-lettered in expressive brushed INK CALLIGRAPHY with a watercolor wash behind each letter, small ink splatters accenting the composition.",
    themeAffinity: /\b(forest|woodland|nature|garden|tea|bunny|owl|fox)\b/i,
  },
  {
    id: "puffy_3d_gummy",
    label: "Puffy 3D Gummy",
    weight: 2,
    prompt_fragment:
      "Glossy 3D puffy illustration, gummy-toy plasticity, soft ambient light, candy palette (bubblegum, lemon, mint, grape), rounded chubby forms, joyful tactile feel — still hand-painted illustrated, not photoreal render.",
    title_lettering_fragment:
      "Title painted as PUFFY 3D GUMMY LETTERS — glossy candy-colored, rounded chubby forms, soft specular highlight and cast shadow painted in.",
  },
  {
    id: "chalkboard_bright",
    label: "Bright Chalkboard",
    weight: 2,
    prompt_fragment:
      "Chalkboard illustration — deep slate background, bright chalk-color drawings (coral, aqua, lemon, pink), soft chalk texture and smudges, cheerful classroom-art vibe rendered at premium quality.",
    title_lettering_fragment:
      "Title hand-drawn as chunky CHALK LETTERS on the slate — bright chalk colors, soft chalk edge, tiny chalk-smudge shadow behind. Feels drawn by a friendly art teacher.",
  },
];

export function styleIdSet(): Set<string> {
  return new Set(COVER_ART_STYLES.map((s) => s.id));
}

/**
 * Pick a cover art style using weight × recency-avoidance × theme-affinity.
 *
 *  - Reads the last `windowSize` `cover_final` assets to learn which styles
 *    were used recently.
 *  - Excludes styles that appeared in the last `excludeRecent` picks (unless
 *    that leaves nothing — then it falls back to full pool).
 *  - Boosts styles whose `themeAffinity` matches the title.
 */
export async function pickCoverArtStyle(
  db: any,
  title: string,
  opts: { windowSize?: number; excludeRecent?: number } = {},
): Promise<{ style: CoverArtStyle; reason: string; recent: string[] }> {
  const windowSize = opts.windowSize ?? 15;
  const excludeRecent = opts.excludeRecent ?? 4;

  let recent: string[] = [];
  try {
    const { data } = await db.from("coloring_v2_assets")
      .select("meta, created_at")
      .eq("kind", "cover_final")
      .order("created_at", { ascending: false })
      .limit(windowSize);
    recent = (data ?? [])
      .map((r: any) => r?.meta?.cover_art_style)
      .filter((x: any): x is string => typeof x === "string");
  } catch {
    recent = [];
  }

  const banned = new Set(recent.slice(0, excludeRecent));
  const pool = COVER_ART_STYLES.filter((s) => !banned.has(s.id));
  const candidates = pool.length ? pool : COVER_ART_STYLES.slice();

  const t = (title ?? "").toLowerCase();
  const scored = candidates.map((s) => {
    let w = Math.max(1, s.weight);
    if (s.themeAffinity && s.themeAffinity.test(t)) w *= 2.5;
    // Additional soft penalty if the style appears further back in the window.
    const idx = recent.indexOf(s.id);
    if (idx >= 0) w *= 0.5;
    return { s, w };
  });

  const total = scored.reduce((a, b) => a + b.w, 0);
  let r = Math.random() * total;
  let picked = scored[scored.length - 1].s;
  for (const { s, w } of scored) {
    r -= w;
    if (r <= 0) { picked = s; break; }
  }

  const reason = banned.has(picked.id)
    ? "fallback_all_recent"
    : `weighted_recency_window_${windowSize}_exclude_${excludeRecent}`;
  return { style: picked, reason, recent };
}
