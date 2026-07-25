// Regression: coloring-book covers must rotate through curated art styles
// (recency-avoidance) instead of always emitting the same gouache look.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COVER_ART_STYLES,
  pickCoverArtStyle,
  styleIdSet,
} from "../../supabase/functions/_shared/coloring/cover-art-styles.ts";

const COVER_FILE = resolve(__dirname, "../../supabase/functions/coloring-v2-cover/index.ts");

function stubDb(recentStyleIds: string[]) {
  const rows = recentStyleIds.map((id) => ({ meta: { cover_art_style: id }, created_at: new Date().toISOString() }));
  return {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data: rows }); },
      } as any;
    },
  };
}

describe("cover art style rotation", () => {
  const src = readFileSync(COVER_FILE, "utf8");

  it("registers the Bouncy Bubble Letters style", () => {
    const ids = styleIdSet();
    expect(ids.has("bouncy_bubble_letters")).toBe(true);
    expect(COVER_ART_STYLES.length).toBeGreaterThanOrEqual(8);
  });

  it("cover generator imports and uses the style picker", () => {
    expect(src).toMatch(/pickCoverArtStyle/);
    expect(src).toMatch(/cover_art_style:\s*artStyle\.id/);
    expect(src).toMatch(/style\.prompt_fragment|artStyle/);
  });

  it("no longer hard-codes 'gouache + watercolor' as the only art direction", () => {
    // The old fixed fragment must not remain in the base prompt builder.
    expect(src).not.toMatch(/gouache \+ watercolor feel, expressive, playful/);
  });

  it("excludes the last N picks from the candidate pool", async () => {
    const recent = ["bouncy_bubble_letters", "soft_gouache_storybook", "crayon_scribble_kids", "cut_paper_collage"];
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const { style } = await pickCoverArtStyle(stubDb(recent), "Happy Farm Coloring Book");
      seen.add(style.id);
    }
    // With 10 styles and 4 recently banned, the picker must land on styles
    // outside the recent window in every one of 40 draws.
    for (const banned of recent) {
      expect(seen.has(banned)).toBe(false);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it("falls back to the full pool when every style is in the recent window", async () => {
    const recent = COVER_ART_STYLES.map((s) => s.id);
    const { style, reason } = await pickCoverArtStyle(stubDb(recent), "Any Title", { excludeRecent: recent.length });
    expect(style).toBeTruthy();
    expect(reason).toBe("fallback_all_recent");
  });
});
