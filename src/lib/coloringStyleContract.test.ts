import { describe, expect, it } from "vitest";
import {
  DEFAULT_KIDS_4_6_STYLE,
  assertPromptCompliant,
  buildInteriorPrompt,
} from "../../supabase/functions/_shared/coloring/style-contract.ts";
import { TEXTLESS_DIRECTIVE } from "../../supabase/functions/_shared/textless-illustration-policy.ts";

describe("coloring interior prompt", () => {
  it("always contains the canonical textless directive", () => {
    const prompt = buildInteriorPrompt(
      {
        canonical_page_number: 1,
        primary_subject: "dolphin",
        secondary_subjects: ["bubbles"],
        scene: "dolphin swimming through open water",
        complexity: "simple",
        required_elements: ["dolphin"],
        forbidden_elements: [],
        composition_type: "single_subject_centered",
      },
      DEFAULT_KIDS_4_6_STYLE,
      { category_name: "Sea Animals", target_age_min: 4, target_age_max: 6 },
    );
    expect(prompt).toContain(TEXTLESS_DIRECTIVE);
    expect(prompt).toMatch(/pure white background/i);
    expect(() => assertPromptCompliant(prompt)).not.toThrow();
  });

  it("assertPromptCompliant throws when directive is missing", () => {
    expect(() => assertPromptCompliant("dolphin coloring page")).toThrow();
  });
});
