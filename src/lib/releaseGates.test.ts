// Phase 9 regression tests — TS release-gates contract must stay in sync
// with .agents/skills/secretpdf-production-suite/scripts/validate_release_manifest.py.

import { describe, it, expect } from "vitest";
import {
  MIN_SCORES,
  ZERO_DEFECTS,
  REQUIRED_ASSET_BOOLEANS,
  REQUIRED_PROOF_BOOLEANS,
  validateReleaseManifest,
  assertReleaseReady,
  ReleaseBlocked,
  type ReleaseManifest,
} from "../../supabase/functions/_shared/release-gates.ts";

function passingManifest(): ReleaseManifest {
  const scores: Record<string, number> = {};
  for (const [k, min] of Object.entries(MIN_SCORES)) scores[k] = min;
  const defect_counts: Record<string, number> = {};
  for (const k of ZERO_DEFECTS) defect_counts[k] = 0;
  const assets: Record<string, boolean> = { ...REQUIRED_ASSET_BOOLEANS };
  const proof: ReleaseManifest["proof"] = {
    consecutive_fresh_books_passed: 3,
    manual_db_edits: 0,
    threshold_reductions: 0,
    gate_bypasses: 0,
  };
  for (const k of REQUIRED_PROOF_BOOLEANS) (proof as Record<string, unknown>)[k] = true;
  return { final_status: "final_pdf_ready", assets, defect_counts, scores, proof };
}

describe("release-gates (Phase 9)", () => {
  it("passing manifest has zero errors", () => {
    expect(validateReleaseManifest(passingManifest())).toEqual([]);
  });

  it("blocks when final_status != final_pdf_ready", () => {
    const m = passingManifest(); m.final_status = "qc_pending";
    expect(validateReleaseManifest(m)[0]).toMatch(/final_status/);
  });

  it("blocks when a required asset boolean is wrong", () => {
    const m = passingManifest(); m.assets.cover_blank = true;
    expect(validateReleaseManifest(m).some((e) => e.includes("cover_blank"))).toBe(true);
  });

  it("blocks when any defect count is non-zero", () => {
    const m = passingManifest(); m.defect_counts.duplicate_pages = 1;
    expect(validateReleaseManifest(m).some((e) => e.includes("duplicate_pages"))).toBe(true);
  });

  it("blocks when any score falls below threshold", () => {
    const m = passingManifest(); m.scores.character_consistency = 94;
    expect(validateReleaseManifest(m).some((e) => e.includes("character_consistency"))).toBe(true);
  });

  it("blocks when proof.consecutive_fresh_books_passed < 3", () => {
    const m = passingManifest(); m.proof.consecutive_fresh_books_passed = 2;
    expect(validateReleaseManifest(m).some((e) => e.includes("consecutive_fresh_books_passed"))).toBe(true);
  });

  it("blocks when manual_db_edits / threshold_reductions / gate_bypasses > 0", () => {
    for (const k of ["manual_db_edits", "threshold_reductions", "gate_bypasses"] as const) {
      const m = passingManifest(); m.proof[k] = 1;
      expect(validateReleaseManifest(m).some((e) => e.includes(k))).toBe(true);
    }
  });

  it("blocks when a required proof boolean is missing", () => {
    const m = passingManifest(); m.proof.build = false;
    expect(validateReleaseManifest(m).some((e) => e.includes("proof.build"))).toBe(true);
  });

  it("assertReleaseReady throws ReleaseBlocked with all errors", () => {
    const m = passingManifest();
    m.scores.character_consistency = 94;
    m.defect_counts.raw_markdown = 2;
    try {
      assertReleaseReady(m);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ReleaseBlocked);
      expect((e as ReleaseBlocked).errors.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("assertReleaseReady succeeds on passing manifest", () => {
    expect(() => assertReleaseReady(passingManifest())).not.toThrow();
  });

  it("MIN_SCORES contract snapshot (must match Python validator)", () => {
    // Snapshot lock: any change here MUST also change the Python validator.
    expect(MIN_SCORES).toMatchObject({
      character_consistency: 95,
      cover_to_interior_match: 95,
      style_consistency: 95,
      page_continuity: 95,
      text_image_match: 95,
      story_chronology: 98,
      age_appropriateness: 95,
      typography_layout: 95,
      cover_quality: 90,
      thumbnail_quality: 90,
      sales_page_sanitization: 100,
      product_metadata_match: 100,
      final_sellable: 92,
    });
  });
});
