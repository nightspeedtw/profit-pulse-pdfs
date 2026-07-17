// Owner-mandated RENDERED-PROOF regression test for the coloring cover.
//
// Owner audit verdict (2026-07-16, 3rd occurrence of this class):
// Two candidate covers shipped as the BLANK synthetic fallback — gray
// gradient with typography, bottom 60% empty, ZERO artwork — while the
// "Ages 4-6" pill clipped at the right edge and the SecretPDF logo
// clipped at the left edge. cover_gate reported PASS anyway because
// (a) blank_background was hardcoded to false, and
// (b) the reported overlay bbox sat exactly on the safe-margin boundary
//     so the frame gate could not detect the SVG stroke overflow.
//
// This test locks BOTH failures into a hard build gate:
//   Group A (art layer is present & non-blank): fabricate a mostly-blank
//   raw art buffer AND a colorful one and assert the pure blank-region
//   detector correctly flags them. A regression that reverts to the
//   "hardcoded false" pattern fails this test.
//
//   Group B (every overlay element inside safe margins): compute the
//   overlay frame layout deterministically for a range of canvas sizes
//   and assert every element bbox is STRICTLY inside the safe margin.
//   A regression that removes the effective-margin stroke padding fails
//   this test (fixture: 1600x1600, 1600x1200, 1200x1600, 900x1200).

import { describe, expect, it } from "vitest";
import { detectBlankRegions } from "../../supabase/functions/_shared/covers/blank-detect.ts";
import {
  assertOverlayInsideSafeMargin,
  computeOverlayLayout,
} from "../../supabase/functions/_shared/covers/overlay-frame.ts";
import { measuredCoverScorecard } from "../../supabase/functions/_shared/covers/cover-measured-gate.ts";
import { coloringCoverGate } from "../../supabase/functions/_shared/coloring/gates.ts";
import {
  COLORING_COVER_COMPOSITOR_VERSION,
  COLORING_COVER_HEIGHT,
  COLORING_COVER_WIDTH,
  renderedColoringCoverProof,
  verifyApprovedTranscription,
} from "../../supabase/functions/_shared/coloring/coloring-cover-proof.ts";

function makeRgba(w: number, h: number, fn: (x: number, y: number) => [number, number, number]): Uint8Array {
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
    }
  }
  return buf;
}

describe("cover rendered-proof: art layer non-blank (owner law)", () => {
  it("gray gradient with bottom 60% empty (shipped fallback signature) is flagged blank_background", () => {
    // Top third: soft light gradient. Middle+bottom: uniform mid gray.
    const rgba = makeRgba(240, 240, (_x, y) => {
      if (y < 80) return [230, 220, 200]; // faint colored gradient
      return [200, 200, 200]; // dead flat gray
    });
    const ev = detectBlankRegions(rgba, 240, 240);
    expect(ev.blank_background).toBe(true);
    expect(ev.region_stats.find((r) => r.band === "middle")?.blank).toBe(true);
    expect(ev.region_stats.find((r) => r.band === "bottom")?.blank).toBe(true);
    expect(ev.blank_ratio).toBeGreaterThanOrEqual(0.66);
  });

  it("colorful full-scene art (variance + chroma everywhere) is NOT flagged blank", () => {
    const rgba = makeRgba(240, 240, (x, y) => [
      (x * 3) % 255,
      (y * 5) % 255,
      ((x + y) * 2) % 255,
    ]);
    const ev = detectBlankRegions(rgba, 240, 240);
    expect(ev.blank_background).toBe(false);
    expect(ev.blank_ratio).toBe(0);
  });

  it("blank_background=true propagates into the measured cover scorecard as a hard fail", () => {
    const SAFE_FRAME = {
      width: 1600,
      height: 1600,
      safe_margin: 82,
      elements: [
        { name: "title_cluster", x: 260, y: 120, w: 1080, h: 420 },
        { name: "age_badge", x: 1200, y: 100, w: 300, h: 100 },
        { name: "secretpdf_kids_logo", x: 100, y: 1400, w: 220, h: 90 },
      ],
    };
    const scorecard = measuredCoverScorecard({
      title: "Cute Sea Animals",
      subtitle: "32 Coloring Pages · Ages 4-6",
      ageBadge: "Ages 4-6",
      text: { has_glyphs: true, detected_text: "Cute Sea Animals | 32 Coloring Pages Ages 4-6 | SecretPDF Kids", degraded: false },
      rawArtText: { has_glyphs: false, detected_text: "", degraded: false },
      hero: { matches: true, detected_subjects: ["dolphin"], forbidden_hit: null, degraded: false },
      frame: SAFE_FRAME,
      logo: { present: true, rect: SAFE_FRAME.elements[2] },
      artwork: { used_svg_fallback: false, synthesized_background: false, blank_background: true, blank_ratio: 0.66 },
      pageCountMatchesFinalPdf: true,
    });
    const gate = coloringCoverGate(scorecard);
    expect(gate.pass).toBe(false);
    expect(gate.reasons.join("|")).toMatch(/blank_background/);
  });
});

describe("cover rendered-proof: every overlay element inside safe margins", () => {
  const canvases = [
    { W: 1600, H: 1600 },
    { W: 1600, H: 1200 },
    { W: 1200, H: 1600 },
    { W: 900,  H: 1200 },
  ];
  for (const { W, H } of canvases) {
    it(`layout for ${W}x${H} keeps age badge + logo strictly inside the safe zone`, () => {
      const frame = computeOverlayLayout({
        width: W,
        height: H,
        hasAgeBadge: true,
        hasLogo: true,
        hasSubtitle: true,
        titleCluster: { name: "title_cluster", x: Math.round(W * 0.16), y: Math.round(H * 0.10), w: Math.round(W * 0.68), h: Math.round(H * 0.30) },
        subtitleBox: { name: "subtitle", x: Math.round(W * 0.16), y: Math.round(H * 0.44), w: Math.round(W * 0.68), h: 72 },
      });
      const check = assertOverlayInsideSafeMargin(frame);
      expect(check.pass, `clipped=${check.clipped.join(",")} frame=${JSON.stringify(frame)}`).toBe(true);
      // The badge/logo bboxes must not merely touch the boundary — they must
      // sit strictly inside (accounting for pill stroke).
      const badge = frame.elements.find((e) => e.name === "age_badge")!;
      const logo = frame.elements.find((e) => e.name === "secretpdf_kids_logo")!;
      expect(badge.x + badge.w).toBeLessThan(W - frame.safe_margin);
      expect(badge.y + badge.h).toBeLessThan(H - frame.safe_margin);
      expect(logo.x).toBeGreaterThan(frame.safe_margin);
      expect(logo.y + logo.h).toBeLessThan(H - frame.safe_margin);
    });
  }
});

describe("cover rendered-proof: FINAL raster contract", () => {
  const approved = [
    "Cute Sea Animals Coloring Book (Ages 4-6)",
    "32 Coloring Pages · Ages 4-6",
    "Ages 4-6",
    "SecretPDF Kids",
  ];
  const frame = {
    width: COLORING_COVER_WIDTH,
    height: COLORING_COVER_HEIGHT,
    safe_margin: 80,
    elements: [
      { name: "title_cluster", x: 260, y: 120, w: 1080, h: 420 },
      { name: "subtitle", x: 256, y: 640, w: 1088, h: 72 },
      { name: "age_badge", x: 1200, y: 1840, w: 320, h: 110 },
      { name: "secretpdf_kids_logo", x: 100, y: 1880, w: 220, h: 80 },
    ],
  };

  it("rejects the exact historical final bug: square typography-on-gradient with empty art region", () => {
    const rgba = makeRgba(1600, 1600, (_x, y) => {
      if (y < 520) return [230 - Math.floor(y / 20), 218 - Math.floor(y / 30), 200];
      return [202, 202, 202];
    });
    const proof = renderedColoringCoverProof({
      rgba,
      width: 1600,
      height: 1600,
      frame: { ...frame, height: 1600 },
      approvedStrings: approved,
      detectedText: approved.join(" | "),
    });
    expect(proof.pass).toBe(false);
    expect(proof.reasons.join("|")).toMatch(/not_letter_portrait/);
    expect(proof.reasons.join("|")).toMatch(/final_art_region_low_variance/);
  });

  it("passes a portrait final cover with strong middle/bottom art variance and approved typography only", () => {
    const rgba = makeRgba(COLORING_COVER_WIDTH, COLORING_COVER_HEIGHT, (x, y) => {
      if (y < COLORING_COVER_HEIGHT * 0.34) return [70 + (x % 80), 130 + (y % 70), 190 - (x % 60)];
      return [(x * 5 + y) % 255, (y * 3 + 40) % 255, ((x + y) * 2) % 255];
    });
    const proof = renderedColoringCoverProof({
      rgba,
      width: COLORING_COVER_WIDTH,
      height: COLORING_COVER_HEIGHT,
      frame,
      approvedStrings: approved,
      detectedText: approved.join(" | "),
    });
    expect(proof.pass, proof.reasons.join("; ")).toBe(true);
    expect(proof.portrait_aspect_pass).toBe(true);
    expect(proof.art_region.pass).toBe(true);
    expect(proof.overlays_in_frame.pass).toBe(true);
    expect(proof.transcription.pass).toBe(true);
  });

  it("rejects extra/unapproved transcribed text", () => {
    const tx = verifyApprovedTranscription(approved, [], `${approved.join(" | ")} | SALE 50% OFF | random AI letters`);
    expect(tx.pass).toBe(false);
    expect(tx.extra_unapproved.length).toBeGreaterThan(0);
  });

  it("locks the new compositor version so old treatment-as-final outputs cannot masquerade as current", () => {
    expect(COLORING_COVER_COMPOSITOR_VERSION).toBe("coloring_cover_compositor_v2_art_plus_transparent_overlay_portrait");
    expect(COLORING_COVER_WIDTH / COLORING_COVER_HEIGHT).toBeCloseTo(8.5 / 11, 2);
  });
});
