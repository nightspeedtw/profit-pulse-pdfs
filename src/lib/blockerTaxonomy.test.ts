import { describe, expect, it } from "vitest";
import {
  armsRegressionPause,
  classifyBlocker,
} from "../../supabase/functions/_shared/blocker-taxonomy.ts";

/**
 * Regression tests for the P0 pause classifier.
 *
 * Ground truth: content-quality verdicts (story_gate, manuscript_qc, …)
 * are honest gate outputs — they are NEVER a reason to arm the production
 * pause. Only code / infrastructure classes (dispatch_failed,
 * persistence_contract, …) can arm the pause when they recur.
 */
describe("blocker taxonomy", () => {
  it("story_gate never arms the pause, no matter how often it recurs", () => {
    for (let i = 0; i < 20; i++) {
      expect(armsRegressionPause("story_gate")).toBe(false);
      expect(armsRegressionPause("story_gate: scores below 85")).toBe(false);
    }
    expect(classifyBlocker("story_gate: foo").kind).toBe("content");
  });

  it("other content classes do not arm the pause", () => {
    for (const cls of [
      "manuscript_qc",
      "final_qc",
      "visual_qc",
      "cover_to_interior_match",
      "post_pdf_story_qc",
      "reader_experience_qc",
      "metadata_gate",
      "bible_check",
      "title_treatment",
      "qc_missing",
    ]) {
      expect(armsRegressionPause(cls)).toBe(false);
      expect(classifyBlocker(cls).kind).toBe("content");
    }
  });

  it("code classes arm the pause", () => {
    for (const cls of [
      "dispatch_failed",
      "invoke_failed",
      "edge_function_error",
      "pipeline_crash",
      "persistence_contract",
      "missing_column",
      "schema_mismatch",
      "asset_identity",
      "idempotency",
      "state_machine",
      "stall_retire",
      "concurrency",
      "pdf_build_error",
      "pdf_metadata_mismatch",
      "phantom_gate",
      "parse_error",
    ]) {
      expect(armsRegressionPause(cls)).toBe(true);
      expect(classifyBlocker(cls).kind).toBe("code");
    }
  });

  it("unknown class defaults to armed (surface for investigation)", () => {
    expect(armsRegressionPause("something_new")).toBe(true);
    expect(classifyBlocker("something_new").kind).toBe("uncategorized");
  });

  it("simulates the false trigger: 7 story_gate rejections do not pause", () => {
    // Mirrors the exact pattern that caused the 24h pause.
    const fails = Array.from({ length: 7 }, (_, i) => ({
      ebook_kids_id: `book-${i}`,
      blocker_reason: `story_gate: dimension X < 85`,
    }));
    const codeCounts = new Map<string, Set<string>>();
    for (const r of fails) {
      if (!armsRegressionPause(r.blocker_reason)) continue;
      const { klass } = classifyBlocker(r.blocker_reason);
      const s = codeCounts.get(klass) ?? new Set<string>();
      s.add(r.ebook_kids_id);
      codeCounts.set(klass, s);
    }
    const regression = [...codeCounts.entries()].find(([, s]) => s.size >= 2);
    expect(regression).toBeUndefined();
  });

  it("simulates a real code regression: 2 dispatch_failed on distinct books DOES pause", () => {
    const fails = [
      { ebook_kids_id: "book-a", blocker_reason: "dispatch_failed: 500" },
      { ebook_kids_id: "book-b", blocker_reason: "dispatch_failed: timeout" },
    ];
    const codeCounts = new Map<string, Set<string>>();
    for (const r of fails) {
      if (!armsRegressionPause(r.blocker_reason)) continue;
      const { klass } = classifyBlocker(r.blocker_reason);
      const s = codeCounts.get(klass) ?? new Set<string>();
      s.add(r.ebook_kids_id);
      codeCounts.set(klass, s);
    }
    const regression = [...codeCounts.entries()].find(([, s]) => s.size >= 2);
    expect(regression).toBeDefined();
    expect(regression![0]).toBe("dispatch_failed");
  });
});
