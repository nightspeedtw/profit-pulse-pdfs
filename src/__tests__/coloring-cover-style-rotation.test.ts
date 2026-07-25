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
import {
  buildMasterColoringCoverPrompt,
  buildMasterColoringCoverPromptWithRotation,
  COLORING_MASTER_COVER_PROMPT_VERSION,
} from "../../supabase/functions/_shared/coloring/master-cover-prompt.ts";

const V2_COVER_FILE = resolve(__dirname, "../../supabase/functions/coloring-v2-cover/index.ts");
const V1_COVER_FILE = resolve(__dirname, "../../supabase/functions/coloring-book-cover/index.ts");

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

const baseInput = {
  title: "Happy Farm Coloring Book",
  subtitle: "",
  ageBadge: "Ages 4-6",
  theme: "cheerful farm animals",
  mainCharacters: ["a smiling cow", "a curious duckling"],
  backgroundElements: ["barn", "sunflowers", "rolling hills"],
  aspectDescriptor: "8.5 x 8.5 inches, square 1:1",
  categoryName: "Farm Animals",
  hasInteriorReferences: false,
};

describe("cover art style rotation", () => {
  const v2Src = readFileSync(V2_COVER_FILE, "utf8");
  const v1Src = readFileSync(V1_COVER_FILE, "utf8");

  it("registers the Bouncy Bubble Letters style", () => {
    const ids = styleIdSet();
    expect(ids.has("bouncy_bubble_letters")).toBe(true);
    expect(COVER_ART_STYLES.length).toBeGreaterThanOrEqual(8);
  });

  it("V2 cover generator imports and uses the style picker", () => {
    expect(v2Src).toMatch(/pickCoverArtStyle/);
    expect(v2Src).toMatch(/cover_art_style:\s*artStyle\.id/);
  });

  it("V1 cover generator wires the master-prompt rotation helper", () => {
    expect(v1Src).toMatch(/buildMasterColoringCoverPromptWithRotation/);
    expect(v1Src).toMatch(/cover_art_style:\s*pickedArtStyle/);
  });

  it("no longer hard-codes 'gouache + watercolor' as the V2 default", () => {
    expect(v2Src).not.toMatch(/gouache \+ watercolor feel, expressive, playful/);
  });

  it("excludes the last N picks from the candidate pool", async () => {
    const recent = ["bouncy_bubble_letters", "soft_gouache_storybook", "crayon_scribble_kids", "cut_paper_collage"];
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const { style } = await pickCoverArtStyle(stubDb(recent), "Happy Farm Coloring Book");
      seen.add(style.id);
    }
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

describe("master prompt style-rotation baked in (v7)", () => {
  it("declares the v7 rotation law in the version constant", () => {
    expect(COLORING_MASTER_COVER_PROMPT_VERSION).toMatch(/v7_style_rotation/);
  });

  it("injects Bouncy Bubble Letters fragments when that style is passed", () => {
    const style = COVER_ART_STYLES.find((s) => s.id === "bouncy_bubble_letters")!;
    const prompt = buildMasterColoringCoverPrompt({ ...baseInput, artStyle: style });
    expect(prompt).toContain("BUBBLE LETTERS");
    expect(prompt).toContain("Bold pop-cartoon coloring-book cover");
    // Must drop the old hard-coded default palette clause.
    expect(prompt).not.toContain("Vibrant confident colors (deep sky-blue, sunlit yellow, warm coral, emerald, magenta, gold)");
  });

  it("injects Cut-Paper Collage fragments when that style is passed", () => {
    const style = COVER_ART_STYLES.find((s) => s.id === "cut_paper_collage")!;
    const prompt = buildMasterColoringCoverPrompt({ ...baseInput, artStyle: style });
    expect(prompt).toContain("Cut-paper collage illustration");
    expect(prompt).toContain("PAPER LETTERS");
  });

  it("keeps the verbatim title and ageBadge contract intact", () => {
    const style = COVER_ART_STYLES[0];
    const prompt = buildMasterColoringCoverPrompt({ ...baseInput, artStyle: style });
    expect(prompt).toContain(baseInput.title);
    expect(prompt).toContain(baseInput.ageBadge);
    expect(prompt.length).toBeLessThanOrEqual(3200);
  });

  it("YA cinematic mode overrides art-style rotation", () => {
    const style = COVER_ART_STYLES.find((s) => s.id === "bouncy_bubble_letters")!;
    const prompt = buildMasterColoringCoverPrompt({
      ...baseInput,
      styleMode: "ya_scifi_cinematic",
      artStyle: style,
    });
    expect(prompt).toContain("PREMIUM PROFESSIONAL GRAPHIC-NOVEL KEY-ART");
    expect(prompt).not.toContain("Bold pop-cartoon coloring-book cover");
  });

  it("rotation helper returns a style + pick reason", async () => {
    const { prompt, style, pickReason } = await buildMasterColoringCoverPromptWithRotation(
      stubDb([]),
      baseInput,
    );
    expect(style).toBeTruthy();
    expect(pickReason).toMatch(/weighted_recency_window|fallback_all_recent/);
    expect(prompt).toContain(baseInput.title);
    expect(prompt).toContain(style.title_lettering_fragment.slice(0, 40));
  });
});

