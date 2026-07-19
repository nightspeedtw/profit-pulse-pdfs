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

describe("measured coloring cover gate (v2 essentials-only)", () => {
  it("double-title fixture is still flagged by findUnapprovedCoverText", () => {
    const unapproved = findUnapprovedCoverText({
      title: "Ocean Friends",
      subtitle: "32 Coloring Pages · Ages 4-6",
      ageBadge: "Ages 4-6",
      text: { has_glyphs: true, detected_text: "Ocean Friends Ocean Friends Ages 4-6 SecretPDF Kids", degraded: false },
    });
    expect(unapproved.join("|")).toMatch(/duplicate:ocean friends|ocean friends ocean friends/);
  });

  it("degraded vision transcription still fails (random_text or title_readability)", () => {
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
    const gate = coloringCoverGate({ ...scorecard, spelling_ok: true });
    expect(gate.pass).toBe(false);
    expect(gate.reasons.join("|")).toMatch(/random_text|title_readability/);
  });

  it("gibberish text fixture hard-fails random_text (still a hard fail in v2)", () => {
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
    const gate = coloringCoverGate({ ...scorecard, spelling_ok: true });
    expect(gate.pass).toBe(false);
    expect(gate.reasons.join("|")).toMatch(/hard_fail:random_text/);
  });

  it("v2: human hero on sea-animal cover is ADVISORY (children are appeal companions)", () => {
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
    const gate = coloringCoverGate({ ...scorecard, spelling_ok: true });
    expect(gate.pass).toBe(true);
  });

  it("clipped-badge fixture still surfaced by frame helper", () => {
    const frame = { ...SAFE_FRAME, elements: [{ name: "age_badge", x: 1510, y: 64, w: 160, h: 80 }] };
    expect(frameElementsInsideSafeMargin(frame).clipped).toEqual(["age_badge"]);
  });

  it("v2: blank_background is ADVISORY on the gate (garbage floor handled at render time)", () => {
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
    const gate = coloringCoverGate({ ...scorecard, spelling_ok: true });
    expect(gate.pass).toBe(true);
  });

  it("v2: logo_present=false is ADVISORY (dropped from cover gate)", () => {
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
    const gate = coloringCoverGate({ ...scorecard, spelling_ok: true });
    expect(gate.pass).toBe(true);
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
