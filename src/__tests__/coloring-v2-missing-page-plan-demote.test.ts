import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Regression (2026-07-26): "Glitch Grid Riot" sat in interior_render with ZERO
// coloring_v2_page_plans rows and burned 431 attempts on
// `[PGRST116] Cannot coerce the result to a single JSON object`.
// Missing dependency != quality failure: the renderer must demote the book back
// to page_plan instead of throwing forever.
const SRC = readFileSync("supabase/functions/coloring-v2-render-page/index.ts", "utf8");

describe("coloring-v2 render-page missing page-plan demotion", () => {
  it("does not use .single() for the page-plan lookup", () => {
    expect(SRC).not.toMatch(/coloring_v2_page_plans[\s\S]{0,200}\.single\(\)/);
  });

  it("demotes the book back to page_plan when the plan row is absent", () => {
    expect(SRC).toContain("page_plan_row_absent");
    expect(SRC).toContain('stage: "page_plan"');
  });

  it("classifies the failure as a missing dependency, not a QC score", () => {
    expect(SRC).toContain("missing_dependency:page_plan_row_absent");
  });

  it("releases the production lock so the next book can proceed", () => {
    const idx = SRC.indexOf("page_plan_row_absent");
    expect(SRC.slice(idx - 600, idx + 400)).toContain("releaseColoringV2ProductionLock");
  });
});
