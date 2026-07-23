// Regression test for OWNER LAW `cover_illustrated_only_v12`.
// Locks the coloring-cover lane to illustrated-hand-lettered output only.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const COVER_FILE = resolve(__dirname, "../../supabase/functions/coloring-v2-cover/index.ts");

describe("cover_illustrated_only_v12", () => {
  const src = readFileSync(COVER_FILE, "utf8");

  it("does not import any SVG/font-overlay typography modules", () => {
    expect(src).not.toMatch(/coloring-cover-compositor/);
    expect(src).not.toMatch(/premium-cover-overlay/);
    expect(src).not.toMatch(/typography-source-verifier/);
    expect(src).not.toMatch(/kids-title-treatment/);
  });

  it("declares both sticky illustrated laws in the short-circuit set", () => {
    expect(src).toMatch(/cover_illustrated_hand_lettered_once_v1/);
    expect(src).toMatch(/cover_illustrated_only_v12/);
  });

  it("marks uploaded cover_final assets with the illustrated text_mode", () => {
    expect(src).toMatch(/text_mode:\s*"illustrated_hand_lettered_baked"/);
    expect(src).not.toMatch(/deterministic_exact_title_render/);
    expect(src).not.toMatch(/textless_art_plus_deterministic_typography/);
  });

  it("uses smart-AI providers only (Gemini + OpenAI direct)", () => {
    expect(src).toMatch(/geminiDirectImageWithMeta/);
    expect(src).toMatch(/openaiDirectImage/);
  });
});
