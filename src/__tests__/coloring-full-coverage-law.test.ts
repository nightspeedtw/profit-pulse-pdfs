import { describe, expect, it } from "vitest";
import {
  detectCoverageKind,
  requiredCoveragePages,
  violatesFullCoverage,
  coverageSlotLabel,
} from "../../supabase/functions/_shared/coloring/full-coverage-law.ts";

describe("coloring_full_coverage_v1", () => {
  it("detects A-Z / ABC / alphabet themes", () => {
    expect(detectCoverageKind("Alphabet Adventures")).toBe("alphabet");
    expect(detectCoverageKind("Learn Your ABCs Coloring Book")).toBe("alphabet");
    expect(detectCoverageKind("A-Z animal parade")).toBe("alphabet");
    expect(detectCoverageKind("Ocean friends")).toBe(null);
  });

  it("detects counting / number themes", () => {
    expect(detectCoverageKind("Counting Book")).toBe("numbers_1_10");
    expect(detectCoverageKind("Numbers 0-9 fun")).toBe("numbers_0_9");
  });

  it("requires 26 pages for alphabet and 10 for numbers", () => {
    expect(requiredCoveragePages("alphabet")).toBe(26);
    expect(requiredCoveragePages("numbers_0_9")).toBe(10);
    expect(requiredCoveragePages("numbers_1_10")).toBe(10);
    expect(requiredCoveragePages(null)).toBe(0);
  });

  it("rejects a 16-page alphabet concept", () => {
    const v = violatesFullCoverage({ title: "Alphabet Antics", theme: "ABCs" }, 16);
    expect(v.violation).toBe(true);
    if (v.violation) {
      expect(v.kind).toBe("alphabet");
      expect(v.required).toBe(26);
      expect(v.got).toBe(16);
    }
  });

  it("accepts a 32-page alphabet concept", () => {
    const v = violatesFullCoverage({ title: "Alphabet Antics", theme: "ABCs" }, 32);
    expect(v.violation).toBe(false);
  });

  it("accepts non-coverage concept at any page count", () => {
    const v = violatesFullCoverage({ title: "Ocean Friends", theme: "sea" }, 16);
    expect(v.violation).toBe(false);
  });

  it("emits deterministic slot labels A..Z and 0..9", () => {
    expect(coverageSlotLabel("alphabet", 0)).toBe("Letter A");
    expect(coverageSlotLabel("alphabet", 25)).toBe("Letter Z");
    expect(coverageSlotLabel("numbers_0_9", 0)).toBe("Number 0");
    expect(coverageSlotLabel("numbers_1_10", 9)).toBe("Number 10");
  });
});
