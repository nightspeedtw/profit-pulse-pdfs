// Regression: matter_pages_design_v2 — age band resolves to the expected
// style tier and per-band font size / palette shape stays deterministic.
// Owner order 2026-07-20.
import { describe, it, expect } from "vitest";
import {
  resolveMatterStyle,
  defaultCopyrightText,
  MATTER_PAGES_DESIGN_VERSION,
} from "../../supabase/functions/_shared/coloring/matter-pages.ts";

describe("matter_pages_design_v2", () => {
  it("resolves toddler band for ages 2-4 with the largest title size", () => {
    const s = resolveMatterStyle(2, 4);
    expect(s.band).toBe("toddler");
    expect(s.titlePt).toBeGreaterThanOrEqual(40);
    expect(s.palette.swatch.length).toBeGreaterThanOrEqual(4);
  });

  it("resolves preschool band for ages 4-6 with warm palette", () => {
    const s = resolveMatterStyle(4, 6);
    expect(s.band).toBe("preschool");
    expect(s.titlePt).toBeGreaterThanOrEqual(36);
    expect(s.palette.paper[0]).toBeGreaterThan(0.9); // warm/light paper
  });

  it("resolves teen band for ages 13-17 with a cooler slate palette", () => {
    const s = resolveMatterStyle(13, 17);
    expect(s.band).toBe("teen");
    // Cool = paper's blue channel >= red channel (slate/neutral, not warm cream)
    expect(s.palette.paper[2]).toBeGreaterThanOrEqual(s.palette.paper[0]);
    // Teen title MUST be smaller than toddler title (owner: "cooler style for 13-17")
    expect(s.titlePt).toBeLessThan(resolveMatterStyle(2, 4).titlePt);
  });

  it("scales font sizes monotonically down across age bands (young → older)", () => {
    const t = resolveMatterStyle(2, 4).titlePt;
    const p = resolveMatterStyle(4, 6).titlePt;
    const e = resolveMatterStyle(7, 9).titlePt;
    const m = resolveMatterStyle(10, 12).titlePt;
    const y = resolveMatterStyle(13, 17).titlePt;
    expect(t).toBeGreaterThan(p);
    expect(p).toBeGreaterThan(e);
    expect(e).toBeGreaterThan(m);
    expect(m).toBeGreaterThan(y);
  });

  it("exposes deterministic copyright legal text with year + license terms", () => {
    const txt = defaultCopyrightText();
    expect(txt).toContain(String(new Date().getFullYear()));
    expect(txt).toContain("personal, non-commercial use");
    expect(txt).toContain("Not for resale");
  });

  it("carries the version marker for pipeline_skills lookup", () => {
    expect(MATTER_PAGES_DESIGN_VERSION).toBe("matter_pages_design_v2");
  });
});
