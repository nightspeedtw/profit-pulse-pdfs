import { describe, expect, it } from "vitest";
import { coloringCoverGate } from "../../supabase/functions/_shared/coloring/gates.ts";
import {
  findUnapprovedCoverText,
  frameElementsInsideSafeMargin,
  measuredCoverScorecard,
} from "../../supabase/functions/_shared/covers/cover-measured-gate.ts";
import { decideAssemblySharpnessPreflight } from "../../supabase/functions/_shared/coloring/assembly-sharpness.ts";

const SAFE_FRAME = {
  width: 1600,
  height: 1600,
  safe_margin: 64,
  elements: [
    { name: "title_cluster", x: 260, y: 120, w: 1080, h: 420 },
    { name: "age_badge", x: 1230, y: 64, w: 280, h: 90 },
    { name: "secretpdf_kids_logo", x: 72, y: 1468, w: 220, h: 61 },
  ],
};

describe("measured coloring cover gate", () => {
  it("double-title fixture hard-fails instead of shipping overlapping typography", () => {
    const unapproved = findUnapprovedCoverText({
      title: "Ocean Friends",
      subtitle: "32 Coloring Pages · Ages 4-6",
      ageBadge: "Ages 4-6",
      text: { has_glyphs: true, detected_text: "Ocean Friends Ocean Friends Ages 4-6 SecretPDF Kids", degraded: false },
    });
    expect(unapproved.join("|")).toMatch(/duplicate:ocean friends|ocean friends ocean friends/);
  });

  it("degraded vision transcription hard-fails instead of fabricating deterministic pass", () => {
    const scorecard = measuredCoverScorecard({
      title: "Ocean Friends",
      subtitle: "32 Coloring Pages · Ages 4-6",
      ageBadge: "Ages 4-6",
      text: { has_glyphs: false, detected_text: null, degraded: true },
      rawArtText: { has_glyphs: false, detected_text: "", degraded: false },
      hero: { matches: true, detected_subjects: ["dolphin"], forbidden_hit: null, degraded: false },
      frame: SAFE_FRAME,
      logo: { present: true, rect: SAFE_FRAME.elements[2] },
      pageCountMatchesFinalPdf: true,
    });
    const gate = coloringCoverGate(scorecard);
    expect(gate.pass).toBe(false);
    expect(gate.reasons.join("|")).toMatch(/random_text|title_readability/);
  });

  it("gibberish text fixture hard-fails random_text", () => {
    const scorecard = measuredCoverScorecard({
      title: "Ocean Friends",
      subtitle: "32 Coloring Pages · Ages 4-6",
      ageBadge: "Ages 4-6",
      text: { has_glyphs: true, detected_text: "Hofarning Prggiletai Kork", degraded: false },
      rawArtText: { has_glyphs: false, detected_text: "", degraded: false },
      hero: { matches: true, detected_subjects: ["dolphin"], forbidden_hit: null, degraded: false },
      frame: SAFE_FRAME,
      logo: { present: true, rect: SAFE_FRAME.elements[2] },
      pageCountMatchesFinalPdf: true,
    });
    const gate = coloringCoverGate(scorecard);
    expect(gate.pass).toBe(false);
    expect(gate.reasons.join("|")).toMatch(/hard_fail:random_text/);
  });

  it("sea-animal category cover with human hero hard-fails out_of_category", () => {
    const scorecard = measuredCoverScorecard({
      title: "Cute Sea Animals",
      subtitle: "32 Coloring Pages · Ages 4-6",
      ageBadge: "Ages 4-6",
      text: { has_glyphs: true, detected_text: "Cute Sea Animals | 32 Coloring Pages Ages 4-6 | SecretPDF Kids", degraded: false },
      rawArtText: { has_glyphs: false, detected_text: "", degraded: false },
      hero: { matches: false, detected_subjects: ["human child", "dolphin"], forbidden_hit: "human child", degraded: false },
      frame: SAFE_FRAME,
      logo: { present: true, rect: SAFE_FRAME.elements[2] },
      pageCountMatchesFinalPdf: true,
    });
    const gate = coloringCoverGate(scorecard);
    expect(gate.pass).toBe(false);
    expect(gate.reasons.join("|")).toMatch(/out_of_category_object/);
  });

  it("clipped badge fixture hard-fails frame gate", () => {
    const frame = { ...SAFE_FRAME, elements: [{ name: "age_badge", x: 1510, y: 64, w: 160, h: 80 }] };
    expect(frameElementsInsideSafeMargin(frame).clipped).toEqual(["age_badge"]);
  });

  it("blank svg fallback cover hard-fails for new books", () => {
    const scorecard = measuredCoverScorecard({
      title: "Cute Sea Animals",
      subtitle: "32 Coloring Pages · Ages 4-6",
      ageBadge: "Ages 4-6",
      text: { has_glyphs: true, detected_text: "Cute Sea Animals | 32 Coloring Pages Ages 4-6 | SecretPDF Kids", degraded: false },
      rawArtText: { has_glyphs: false, detected_text: "", degraded: false },
      hero: { matches: true, detected_subjects: ["sea turtle"], forbidden_hit: null, degraded: false },
      frame: SAFE_FRAME,
      logo: { present: true, rect: SAFE_FRAME.elements[2] },
      artwork: { used_svg_fallback: true, synthesized_background: true, blank_background: true, blank_ratio: 1 },
      pageCountMatchesFinalPdf: true,
    });
    const gate = coloringCoverGate(scorecard);
    expect(gate.pass).toBe(false);
    expect(gate.reasons.join("|")).toMatch(/blank_background/);
  });

  it("cover without the canonical logo fails gate", () => {
    const scorecard = measuredCoverScorecard({
      title: "Ocean Friends",
      subtitle: "32 Coloring Pages · Ages 4-6",
      ageBadge: "Ages 4-6",
      text: { has_glyphs: true, detected_text: "Ocean Friends | 32 Coloring Pages Ages 4-6", degraded: false },
      rawArtText: { has_glyphs: false, detected_text: "", degraded: false },
      hero: { matches: true, detected_subjects: ["narwhal"], forbidden_hit: null, degraded: false },
      frame: SAFE_FRAME,
      logo: { present: false, rect: null },
      pageCountMatchesFinalPdf: true,
    });
    const gate = coloringCoverGate(scorecard);
    expect(gate.pass).toBe(false);
    expect(gate.reasons.join("|")).toMatch(/logo_present=false/);
  });
});

describe("assembly sharpness preflight", () => {
  it("blurry legacy page triggers regen before assembly", () => {
    const rows = [
      { page: 1, score: 18.4, min_required: 13, pass: true, reason: "ok" },
      { page: 7, score: 3.6, min_required: 13, pass: false, reason: "sharpness_below_floor:score=3.60_min=13" },
      { page: 23, score: 16.3, min_required: 13, pass: true, reason: "ok" },
    ];
    expect(decideAssemblySharpnessPreflight(rows)).toEqual({
      pass: false,
      failures: [7],
      action: "regenerate_blurry_pages",
    });
  });

  it("unmeasured page also blocks assembly", () => {
    const rows = [{ page: 2, score: 0, min_required: 13, pass: false, reason: "unmeasured:sharpness_decode_error" }];
    expect(decideAssemblySharpnessPreflight(rows).failures).toEqual([2]);
  });
});
