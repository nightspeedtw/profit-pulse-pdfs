// Phase 5a regression tests — Textless Illustration Policy.
//
// Mirrors supabase/functions/_shared/textless-illustration-policy.ts so any
// weakening of the policy strings fails CI. This file MUST NOT import from
// supabase/functions/* (Deno-only); the constants are duplicated here on
// purpose and asserted for equality via a snapshot-style substring check.

import { describe, it, expect } from "vitest";
import {
  TEXTLESS_DIRECTIVE,
  TEXTLESS_FORBIDDEN_OBJECTS,
  withTextlessDirective,
  forbiddenObjectsSatisfyTextlessPolicy,
  validateTextlessDispatch,
} from "../../supabase/functions/_shared/textless-illustration-policy.ts";

describe("textless illustration policy", () => {
  it("directive names every text-like artifact class", () => {
    for (const kw of ["no letters", "no words", "no captions", "no speech bubbles", "no signage", "no logos", "no watermarks", "no numbers", "no typography"]) {
      expect(TEXTLESS_DIRECTIVE.toLowerCase()).toContain(kw);
    }
  });

  it("forbidden objects include text / letters / words", () => {
    expect(forbiddenObjectsSatisfyTextlessPolicy(TEXTLESS_FORBIDDEN_OBJECTS)).toBe(true);
  });

  it("withTextlessDirective appends the canonical directive", () => {
    const out = withTextlessDirective("A cozy fox in a den.");
    expect(out).toContain(TEXTLESS_DIRECTIVE);
  });

  it("withTextlessDirective is idempotent", () => {
    const once = withTextlessDirective("scene");
    const twice = withTextlessDirective(once);
    expect(twice).toBe(once);
  });

  it("validateTextlessDispatch flags a missing directive", () => {
    const v = validateTextlessDispatch({ prompt: "just a scene", forbidden_objects: ["text", "letters", "words"] });
    expect(v.some((x) => x.code === "MISSING_DIRECTIVE")).toBe(true);
  });

  it("validateTextlessDispatch flags missing forbidden objects", () => {
    const v = validateTextlessDispatch({ prompt: withTextlessDirective("scene"), forbidden_objects: ["letters"] });
    expect(v.some((x) => x.code === "MISSING_FORBIDDEN_OBJECTS")).toBe(true);
  });

  it("validateTextlessDispatch passes for a compliant dispatch", () => {
    const v = validateTextlessDispatch({
      prompt: withTextlessDirective("A whimsical fox."),
      forbidden_objects: ["text", "letters", "words", "speech bubbles"],
    });
    expect(v).toEqual([]);
  });
});
