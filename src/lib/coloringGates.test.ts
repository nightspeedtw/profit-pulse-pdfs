import { describe, expect, it } from "vitest";
import {
  coloringCoverGate,
  coloringPageGate,
  coloringReleaseGate,
} from "../../supabase/functions/_shared/coloring/gates.ts";

// Coloring Rulebook v2 — "essentials only" (2026-07-19).
// Gates only reject on: garbage floors, cover typography spelling,
// catastrophic cover/interior mismatch, and PDF integrity. Anything
// else logs to the defect ledger and ships.

const CLEAN_PAGE = {
  line_art_cleanliness: 92,
  printability: 92,
  hard_fail: {},
};

describe("coloring page gate (v2 garbage floor only)", () => {
  it("passes an ordinary page well above the garbage floor", () => {
    expect(coloringPageGate(CLEAN_PAGE).pass).toBe(true);
  });
  it("still passes a page that used to fail v1's 95/98 thresholds", () => {
    // Under v1 this would have failed anatomy=90, style=90, uniqueness=88.
    // Under v2 only line_art < 70 or printability < 70 blocks.
    const r = coloringPageGate({
      line_art_cleanliness: 85,
      printability: 85,
      anatomy_correctness: 60,
      style_consistency: 80,
      visual_uniqueness: 70,
      hard_fail: {},
    });
    expect(r.pass).toBe(true);
  });
  it("blocks a truly broken (garbage) page", () => {
    const r = coloringPageGate({ line_art_cleanliness: 20, printability: 20 });
    expect(r.pass).toBe(false);
  });
  it("hard-fails on watermark / copyrighted_ip", () => {
    expect(coloringPageGate({ ...CLEAN_PAGE, hard_fail: { watermark: 1 } }).pass).toBe(false);
    expect(coloringPageGate({ ...CLEAN_PAGE, hard_fail: { copyrighted_ip: 1 } }).pass).toBe(false);
  });
  it("no longer treats duplicates / anatomy / out-of-category as hard fails", () => {
    const r = coloringPageGate({
      ...CLEAN_PAGE,
      hard_fail: { duplicate_page: 1, anatomy_defect: 1, out_of_category_object: 1 } as any,
    });
    expect(r.pass).toBe(true);
  });
});

describe("coloring cover gate (v2 essentials)", () => {
  it("spelling defect is NON-WAIVABLE", () => {
    const r = coloringCoverGate({
      spelling_ok: false,
      title_readability: 99,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.join("|")).toMatch(/spelling_ok=false/);
  });
  it("passes without age_label / logo / page_count constraints (all dropped in v2)", () => {
    const r = coloringCoverGate({
      title_readability: 90,
      spelling_ok: true,
    });
    expect(r.pass).toBe(true);
  });
  it("blocks only on catastrophic cover/interior mismatch (<50)", () => {
    expect(coloringCoverGate({ title_readability: 95, spelling_ok: true, cover_interior_match: 60 }).pass).toBe(true);
    expect(coloringCoverGate({ title_readability: 95, spelling_ok: true, cover_interior_match: 20 }).pass).toBe(false);
  });
});

describe("coloring release gate (v2 essentials)", () => {
  it("passes with only pdf+cover+prohibited-artifact-clean", () => {
    const r = coloringReleaseGate({
      pdf_opens: true,
      cover_gate_pass: true,
      zero_prohibited_artifacts: true,
    });
    expect(r.pass).toBe(true);
  });
  it("blocks when pdf is missing", () => {
    const r = coloringReleaseGate({
      pdf_opens: false,
      cover_gate_pass: true,
      zero_prohibited_artifacts: true,
    });
    expect(r.pass).toBe(false);
  });
  it("no longer requires final_sellable >= 92 (score is advisory)", () => {
    const r = coloringReleaseGate({
      pdf_opens: true,
      cover_gate_pass: true,
      zero_prohibited_artifacts: true,
      final_sellable: 70,
    });
    expect(r.pass).toBe(true);
  });
});
