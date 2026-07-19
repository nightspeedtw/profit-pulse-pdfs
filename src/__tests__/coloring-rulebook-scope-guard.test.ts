import { describe, it, expect } from "vitest";
import {
  assertColoringOnly,
  isColoringLane,
} from "../../supabase/functions/_shared/coloring/lane-invariants.ts";
import { classifyFailure, decideRepair } from "../../supabase/functions/_shared/coloring/repair-ladder.ts";
import { COLORING_HARD_FAIL_ZERO_KEYS } from "../../supabase/functions/_shared/coloring/gates.ts";
import { readFileSync } from "node:fs";

// coloring_rulebook_v1_scope_guard + no_solid_black_gate (2026-07-19).

describe("coloring_rulebook_v1 scope guard", () => {
  it("assertColoringOnly throws on picture_book and passes on coloring_book", () => {
    expect(() => assertColoringOnly("picture_book", "de-fill")).toThrow(/scope_guard/);
    expect(() => assertColoringOnly("novel", "de-fill")).toThrow(/scope_guard/);
    expect(() => assertColoringOnly(null, "de-fill")).toThrow(/scope_guard/);
    expect(() => assertColoringOnly("coloring_book", "de-fill")).not.toThrow();
    expect(isColoringLane("coloring_book")).toBe(true);
    expect(isColoringLane("picture_book")).toBe(false);
  });

  it("simulated picture_book row through shared coloring code hits ZERO coloring rulebook logic", () => {
    // Simulate shared-code entry: a caller checks isColoringLane before
    // running any coloring rulebook behaviour. A picture_book row must
    // short-circuit past every coloring rule.
    const bookType = "picture_book";
    let invokedRules = 0;
    const applyColoringRule = () => { invokedRules++; };

    if (isColoringLane(bookType)) applyColoringRule(); // solid-black — never for non-coloring
    if (isColoringLane(bookType)) applyColoringRule(); // de-fill enhancement
    if (isColoringLane(bookType)) applyColoringRule(); // anatomy deformity-only rubric
    if (isColoringLane(bookType)) applyColoringRule(); // interiors-as-cover-ref
    if (isColoringLane(bookType)) applyColoringRule(); // waiver / learning mode
    if (isColoringLane(bookType)) applyColoringRule(); // coloring pricing
    if (isColoringLane(bookType)) applyColoringRule(); // age-band chips
    if (isColoringLane(bookType)) applyColoringRule(); // title-spelling law

    expect(invokedRules).toBe(0);
  });
});

describe("coloring_rulebook_v1_no_solid_black_gate amendment", () => {
  it("HARD_FAIL keys no longer contain large_solid_black_area", () => {
    expect(COLORING_HARD_FAIL_ZERO_KEYS as readonly string[])
      .not.toContain("large_solid_black_area");
  });

  it("repair ladder no longer classifies as solid_black_fill", () => {
    // Historical reason strings that used to route to solid_black_fill.
    const legacy = [
      "solid_black_gate: black_pixel_ratio=0.22 > 0.18",
      "largest_black_cluster_ratio=0.08 > 0.04 (solid-fill region)",
    ];
    const cls = classifyFailure(legacy);
    // Must not equal the removed class; falls through to "unknown".
    expect(cls).not.toBe("solid_black_fill" as any);
    expect(["unknown", "minor_line_noise", "sharpness_below_floor"]).toContain(cls);
  });

  it("render loop no longer rejects on solid_black_gate; only on garbage_image_broken", () => {
    const src = readFileSync("supabase/functions/coloring-book-render/index.ts", "utf-8");
    // The old rejection error string is gone.
    expect(src).not.toMatch(/error:\s*`solid_black_gate:/);
    // The new sanity-floor error is present.
    expect(src).toMatch(/garbage_image_broken/);
  });

  it("assembly sweep no longer references solid_black_gate as a rejection", () => {
    const src = readFileSync("supabase/functions/coloring-book-assemble/index.ts", "utf-8");
    // Assembly must not throw/reject on solid-black.
    expect(src).not.toMatch(/throw[^;]*solid[_-]?black/i);
    expect(src).not.toMatch(/reject[^;]*solid[_-]?black/i);
  });
});
