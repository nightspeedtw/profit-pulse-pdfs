// OWNER LAW — 'coloring_cover_textless_forever' regression tests.
//
// These lock the coloring-lane cover pipeline invariants so they cannot
// silently regress:
//   1. Prompt builder ALWAYS emits TEXTLESS_DIRECTIVE.
//   2. Prompt builder NEVER leaks the book title to the image model.
//   3. Attempting either mistake throws structurally (no silent fallback).

import { describe, it, expect } from "vitest";
import {
  buildColoringCoverArtPrompt,
  assertColoringCoverPromptIsTextless,
  COLORING_COVER_PROMPT_VERSION,
} from "../../supabase/functions/_shared/coloring/cover-prompt.ts";
import { TEXTLESS_DIRECTIVE } from "../../supabase/functions/_shared/textless-illustration-policy.ts";

const BASE = {
  categoryName: "Sea Animals",
  ageMin: 4,
  ageMax: 6,
  heroSubjects: ["dolphin", "sea turtle", "octopus", "clownfish", "starfish"],
  bannedTitle: "Ocean Friends Coloring Adventure",
};

describe("coloring_cover_textless_forever", () => {
  it("has a stable version tag", () => {
    expect(COLORING_COVER_PROMPT_VERSION).toBe("coloring_cover_textless_v1");
  });

  it("builds a prompt that contains TEXTLESS_DIRECTIVE", () => {
    const prompt = buildColoringCoverArtPrompt({ ...BASE });
    expect(prompt).toContain(TEXTLESS_DIRECTIVE);
  });

  it("does NOT leak the book title into the prompt", () => {
    const prompt = buildColoringCoverArtPrompt({ ...BASE });
    expect(prompt.toLowerCase()).not.toContain(BASE.bannedTitle.toLowerCase());
    // The category name may appear, but never the title.
    expect(prompt).toContain(BASE.categoryName);
  });

  it("assert helper throws when TEXTLESS_DIRECTIVE is missing", () => {
    expect(() => assertColoringCoverPromptIsTextless(
      "a colorful cover scene with no textless clause",
      "Ocean Friends",
    )).toThrow(/TEXTLESS_DIRECTIVE/);
  });

  it("assert helper throws when the title is leaked", () => {
    const bad = `A cover for "Ocean Friends Coloring Adventure". ${TEXTLESS_DIRECTIVE}`;
    expect(() => assertColoringCoverPromptIsTextless(bad, "Ocean Friends Coloring Adventure"))
      .toThrow(/leaks the book title/);
  });

  it("ignores empty / trivially-short banned titles (no false positives)", () => {
    expect(() => assertColoringCoverPromptIsTextless(
      `hello world ${TEXTLESS_DIRECTIVE}`,
      "",
    )).not.toThrow();
    expect(() => assertColoringCoverPromptIsTextless(
      `hello world ${TEXTLESS_DIRECTIVE}`,
      "a",
    )).not.toThrow();
  });

  it("prompt builder throws structurally if title were injected via categoryName", () => {
    // Simulates a future refactor that mistakenly passes the title where
    // the category name goes — this MUST throw, not ship.
    expect(() => buildColoringCoverArtPrompt({
      ...BASE,
      categoryName: BASE.bannedTitle,
    })).toThrow(/leaks the book title/);
  });

  it("extra clauses may include anatomy/learned rules but never the title", () => {
    const prompt = buildColoringCoverArtPrompt({
      ...BASE,
      extraClauses: ["Draw dolphin flukes HORIZONTAL, side profile.", null, undefined, ""],
    });
    expect(prompt).toContain("HORIZONTAL");
    expect(prompt).toContain(TEXTLESS_DIRECTIVE);
    expect(prompt.toLowerCase()).not.toContain(BASE.bannedTitle.toLowerCase());
  });
});
