import { describe, expect, it } from "vitest";
import {
  coloringCoverGate,
  coloringPageGate,
  coloringReleaseGate,
} from "../../supabase/functions/_shared/coloring/gates.ts";

const PASS_PAGE = {
  category_match: 99,
  age_complexity_match: 96,
  line_art_cleanliness: 99,
  style_consistency: 96,
  printability: 99,
  safe_margin: 100,
  white_background: 100,
  visual_uniqueness: 92,
  hard_fail: {},
};

describe("coloring page gate", () => {
  it("passes a clean scorecard", () => {
    expect(coloringPageGate(PASS_PAGE).pass).toBe(true);
  });
  it("fails when a threshold is missed", () => {
    const r = coloringPageGate({ ...PASS_PAGE, style_consistency: 90 });
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/style_consistency/);
  });
  it("hard-fails on any prohibited artifact", () => {
    const r = coloringPageGate({ ...PASS_PAGE, hard_fail: { watermark: 1 } });
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/hard_fail:watermark/);
  });
});

describe("coloring cover gate", () => {
  it("requires age_label + page_count match", () => {
    const r = coloringCoverGate({
      cover_category_match: 99,
      title_readability: 98,
      cover_quality: 95,
      age_label_present: false,
      page_count_matches_final_pdf: true,
      hard_fail: {},
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/age_label_present/);
  });
});

describe("coloring release gate", () => {
  it("blocks release when final_sellable < 92", () => {
    const r = coloringReleaseGate({
      all_pages_in_category: true,
      age_complexity_ok: true,
      style_locked_throughout: true,
      all_pages_unique: true,
      pdf_opens: true,
      pdf_page_count_matches: true,
      cover_gate_pass: true,
      zero_prohibited_artifacts: true,
      commercial_rights_pass: true,
      final_sellable: 90,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/final_sellable/);
  });
});
