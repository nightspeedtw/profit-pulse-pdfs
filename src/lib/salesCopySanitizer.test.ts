// Phase 8 regression tests — sales-copy sanitizer.

import { describe, it, expect } from "vitest";
import {
  findInternalLeaks,
  buildCustomerProductDescriptionHtml,
  sanitizeSalesCopy,
  assertSafeHtml,
  SalesCopyLeakError,
} from "../../supabase/functions/_shared/sales-copy-sanitizer.ts";

describe("sales-copy-sanitizer (Phase 8)", () => {
  it("findInternalLeaks catches story_bible / moral_lesson / TODO tokens", () => {
    expect(findInternalLeaks("Refers to story_bible chapter 2")).toContain("story_bible");
    expect(findInternalLeaks("moral_lesson: kindness")).toContain("moral_lesson");
    expect(findInternalLeaks("TODO: rewrite hook")).toContain("TODO");
    expect(findInternalLeaks("A cozy tale about a fox.")).toEqual([]);
  });

  it("builds whitelisted HTML from a clean brief", () => {
    const html = buildCustomerProductDescriptionHtml({
      hook: "A brave fox learns to share.",
      child_benefit: "Helps kids talk about sharing.",
      what_kids_will_love: ["Warm illustrations", "A cozy refrain"],
      parent_reassurance: "Gentle, no scary scenes.",
      age_band: "4-6",
    });
    expect(html).toContain("<strong>A brave fox learns to share.</strong>");
    expect(html).toContain("<li>Warm illustrations</li>");
    expect(html).toContain("Recommended age: 4-6");
    expect(html).not.toContain("<script");
  });

  it("throws SalesCopyLeakError if brief contains internal tokens", () => {
    expect(() => buildCustomerProductDescriptionHtml({
      hook: "See story_bible for hook",
      child_benefit: "ok",
      what_kids_will_love: [],
    })).toThrow(SalesCopyLeakError);
  });

  it("escapes HTML special chars", () => {
    const html = buildCustomerProductDescriptionHtml({
      hook: "Fox & friends <3",
      child_benefit: "A > B",
      what_kids_will_love: [],
    });
    expect(html).toContain("Fox &amp; friends &lt;3");
    expect(html).toContain("A &gt; B");
  });

  it("assertSafeHtml rejects scripts, event handlers, inline styles", () => {
    expect(() => assertSafeHtml('<p onclick="x()">hi</p>')).toThrow(SalesCopyLeakError);
    expect(() => assertSafeHtml('<script>x</script>')).toThrow(SalesCopyLeakError);
    expect(() => assertSafeHtml('<p style="color:red">hi</p>')).toThrow(SalesCopyLeakError);
    expect(() => assertSafeHtml('<a href="javascript:x">x</a>')).toThrow(SalesCopyLeakError);
    expect(() => assertSafeHtml('<div>bad tag</div>')).toThrow(SalesCopyLeakError);
    expect(() => assertSafeHtml('<p>ok</p><ul><li>x</li></ul>')).not.toThrow();
  });

  it("sanitizeSalesCopy returns null html when brief is incomplete", () => {
    const r = sanitizeSalesCopy({ hook: "only hook" });
    expect(r.html).toBeNull();
    expect(r.sanitized_at).toMatch(/T/);
  });

  it("sanitizeSalesCopy produces html for complete brief", () => {
    const r = sanitizeSalesCopy({
      hook: "Brave fox.",
      child_benefit: "Talks about sharing.",
      what_kids_will_love: ["Cozy art"],
    });
    expect(r.html).toContain("<strong>Brave fox.</strong>");
  });

  it("refuses leakage even from what_kids_will_love bullets", () => {
    expect(() => buildCustomerProductDescriptionHtml({
      hook: "Fine hook.",
      child_benefit: "Fine benefit.",
      what_kids_will_love: ["Follows the character sheet closely"],
    })).toThrow(SalesCopyLeakError);
  });
});
