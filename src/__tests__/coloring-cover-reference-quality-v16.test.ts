// cover_reference_quality_v16
// Regression: the illustrated-cover generator must always emit the v16
// composition system — title container, letter color mode, character
// ensemble, theme motif kit, and the split title/subtitle spelling lock.
// If any of these clauses regress out of the prompt builder, covers
// slide back to the "lonely centered hero on plain gradient" look that
// prompted v16 in the first place.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const SRC = readFileSync(
  path.resolve(__dirname, "../../supabase/functions/coloring-v2-illustrated-cover-once/index.ts"),
  "utf8",
);

describe("cover_reference_quality_v16 — illustrated cover prompt contract", () => {
  it("declares the v16 law in the uploaded asset metadata", () => {
    expect(SRC).toMatch(/law:\s*"cover_reference_quality_v16"/);
  });

  it("splits the full title into a core title and a separate subtitle ribbon", () => {
    expect(SRC).toMatch(/splitTitleForCover/);
    expect(SRC).toMatch(/SUBTITLE RIBBON — REQUIRED SEPARATE ELEMENT/);
    expect(SRC).toMatch(/subtitle_spelling_lock/);
  });

  it("defines the 5 title-container plaque options and picks one deterministically", () => {
    for (const id of ["black_bubble_plaque", "torn_scroll_ribbon", "painted_banner", "sticker_stack", "clean_stroke_only"]) {
      expect(SRC).toContain(id);
    }
    expect(SRC).toMatch(/pickTitleContainer/);
    expect(SRC).toMatch(/TITLE CONTAINER — /);
  });

  it("defines the 4 title color modes (multi-word, per-letter, duotone, unified glow)", () => {
    for (const id of ["multi_word_gradient", "per_letter_theme", "duotone_pop", "unified_glow"]) {
      expect(SRC).toContain(id);
    }
    expect(SRC).toMatch(/pickTitleColorMode/);
    expect(SRC).toMatch(/TITLE COLOR MODE — /);
  });

  it("forces a dense character ensemble instead of a lonely hero", () => {
    expect(SRC).toMatch(/CHARACTER ENSEMBLE — DENSE COVER/);
    expect(SRC).toMatch(/2-3 supporting characters/);
  });

  it("emits a theme-specific motif kit that must cross every edge", () => {
    expect(SRC).toMatch(/pickMotifKit/);
    expect(SRC).toMatch(/THEME MOTIF KIT — /);
    // A representative slice of the kit ids
    for (const id of ["space", "robots", "ocean", "adventure"]) {
      expect(SRC).toContain(`id: "${id}"`);
    }
  });

  it("upgrades the age badge to a two-ring painted sticker with engraved AGES text", () => {
    expect(SRC).toMatch(/two-ring sticker/);
    expect(SRC).toMatch(/engraved\/letterpress/);
  });

  it("keeps the FULL-BLEED clause + verifier plumbing from v15 intact", () => {
    expect(SRC).toMatch(/FULL-BLEED edge-to-edge \(NON-NEGOTIABLE\)/);
    expect(SRC).toMatch(/verifyFullBleed/);
    expect(SRC).toMatch(/autoCropBorders/);
  });
});
