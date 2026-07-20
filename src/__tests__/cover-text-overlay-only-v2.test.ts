// Regression: OWNER LAW `cover_text_overlay_only_v2` — every V2 coloring
// cover must be structurally incapable of shipping a spelling error. Two
// halves:
//   (1) The image model bakes AT MOST the exact title (all other cover text
//       is drawn by the deterministic overlay layer).
//   (2) The whole-cover OCR gate rejects ANY extra glyph beyond the title.
//   (3) Every coloring-book title must contain "Coloring Book".
//
// These tests exercise the pure helpers (prompt builder, OCR diff, naming
// helper) — no network. They fail loudly if any of the three architectural
// invariants regresses.

import { describe, it, expect } from "vitest";
import {
  buildMasterColoringCoverPrompt,
} from "../../supabase/functions/_shared/coloring/master-cover-prompt.ts";
import {
  tokenize,
  diffTokens,
  countAgeBadges,
} from "../../supabase/functions/_shared/coloring/cover-text-transcription.ts";
import { ensureColoringLabel } from "@/lib/coloring-title";

describe("cover_text_overlay_only_v2 — prompt-builder invariants", () => {
  const base = {
    title: "Busy Block ABCs Coloring Book",
    subtitle: "Chunky letters and cheerful friends.",
    ageBadge: "Ages 2-4",
    theme: "First ABCs",
    mainCharacters: ["a cheerful block bear", "a plush bunny"],
    backgroundElements: ["rainbow blocks", "confetti"],
  };

  it("title-only mode bakes ONLY the exact title (never the subtitle)", () => {
    const p = buildMasterColoringCoverPrompt({ ...base, textMode: "title_only" });
    expect(p).toContain(base.title);
    // Subtitle string must NOT be sent to the image model as a bake target.
    expect(p).not.toContain(base.subtitle);
    // Prompt must explicitly forbid every non-title glyph the overlay owns.
    expect(p.toLowerCase()).toMatch(/no subtitle|absolutely no subtitle/);
    expect(p.toLowerCase()).toMatch(/no.*age label|no.*ages.*text/i);
    expect(p.toLowerCase()).toMatch(/no.*coloring book.*text|no coloring book text/i);
  });

  it("textless mode strips the title too — pure textless art", () => {
    const p = buildMasterColoringCoverPrompt({ ...base, textMode: "textless" });
    expect(p).not.toContain(`"${base.title}"`);
    expect(p.toLowerCase()).toMatch(/zero.*text|no.*text/);
  });

  it("blurb / description paragraph is NEVER passed to the image model", () => {
    // Even if a caller foolishly stuffed a blurb into subtitle, it doesn't
    // reach the prompt because the builder ignores subtitle entirely.
    const p = buildMasterColoringCoverPrompt({
      ...base,
      subtitle: "Fun characters, simple pages, and lots of room to color.",
    });
    expect(p).not.toContain("Fun characters, simple pages, and lots of room to color.");
  });
});

describe("cover_text_overlay_only_v2 — OCR diff invariants", () => {
  it("cover with ONLY the exact title tokens = clean diff", () => {
    const approved = tokenize("Busy Block ABCs Coloring Book");
    const detected = tokenize("Busy Block ABCs Coloring Book");
    const { missing, extra, misspelled } = diffTokens(approved, detected);
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
    expect(misspelled).toEqual([]);
  });

  it("cover with a baked description paragraph = extras detected (would FAIL the gate)", () => {
    const approved = tokenize("Busy Block ABCs Coloring Book");
    const detected = tokenize(
      "Busy Block ABCs Coloring Book | Fun characters simple pages and mcatctarlcl poake",
    );
    const { extra } = diffTokens(approved, detected);
    // The gate rejects on any extras — several show up here.
    expect(extra.length).toBeGreaterThan(3);
    expect(extra).toEqual(
      expect.arrayContaining(["fun", "characters", "simple", "pages"]),
    );
  });

  it("baked age-badge is detected by countAgeBadges (would FAIL the gate)", () => {
    expect(countAgeBadges("AGES 2-4")).toBe(1);
    expect(countAgeBadges("AGES 2-4 | Ages 2 to 4")).toBe(2); // duplicate defect
    expect(countAgeBadges("nothing here")).toBe(0);
  });
});

describe("cover_text_overlay_only_v2 — naming gate", () => {
  it("titles WITHOUT 'Coloring Book' are auto-repaired", () => {
    expect(ensureColoringLabel("Busy Block ABCs")).toBe("Busy Block ABCs Coloring Book");
    expect(ensureColoringLabel("Cyber City Countdown")).toBe(
      "Cyber City Countdown Coloring Book",
    );
  });
  it("titles that already contain 'Coloring' are untouched", () => {
    expect(ensureColoringLabel("Fuzzy Forest Folk Coloring Book")).toBe(
      "Fuzzy Forest Folk Coloring Book",
    );
  });
  it("blank titles get the label", () => {
    expect(ensureColoringLabel("")).toBe("Coloring Book");
  });
});
