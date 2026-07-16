import { describe, it, expect } from "vitest";
import {
  AGE_BANDS, BOOK_TYPES, THEMES, BUYER_JOBS,
  CATEGORY_PAGES, resolveCategory, bookMatchesFilter,
  buildKidsUrl, parseKidsUrl,
} from "./kidsCatalogTaxonomy";

describe("kids catalog taxonomy", () => {
  it("ships 4 age bands, 2 book types, 8 themes, 3 buyer jobs", () => {
    expect(AGE_BANDS.map((a) => a.slug)).toEqual(["0-3","3-5","4-6","6-8"]);
    expect(BOOK_TYPES.map((b) => b.slug)).toEqual(["illustrated_storybook","coloring_book"]);
    expect(THEMES).toHaveLength(8);
    expect(BUYER_JOBS.map((b) => b.slug)).toEqual(["parent_calm","teacher","gift"]);
  });

  it("every category page has SEO copy and a filter", () => {
    for (const c of CATEGORY_PAGES) {
      expect(c.titleTag.length).toBeGreaterThan(20);
      expect(c.titleTag.length).toBeLessThanOrEqual(70);
      expect(c.metaDescription.length).toBeGreaterThan(50);
      expect(c.metaDescription.length).toBeLessThanOrEqual(180);
      expect(c.h1.length).toBeGreaterThan(3);
      expect(c.intro.length).toBeGreaterThan(30);
      expect(Object.keys(c.filter).length).toBeGreaterThan(0);
    }
  });

  it("ships the required v1 landing slugs", () => {
    const slugs = CATEGORY_PAGES.map((c) => c.slug);
    for (const required of [
      "bedtime-stories","kindness-stories","coloring-books",
      "ages-3-5","ages-4-6","ages-6-8",
      "calmer-bedtimes","for-the-classroom","perfect-gifts",
    ]) {
      expect(slugs).toContain(required);
    }
  });

  it("resolveCategory finds the config or returns null", () => {
    expect(resolveCategory("bedtime-stories")?.filter.theme).toBe("bedtime");
    expect(resolveCategory("coloring-books")?.filter.book_type).toBe("coloring_book");
    expect(resolveCategory("ages-4-6")?.filter.age_band).toBe("4-6");
    expect(resolveCategory("nope")).toBeNull();
    expect(resolveCategory(undefined)).toBeNull();
  });

  it("bookMatchesFilter honours every dimension", () => {
    const b = { age_band: "4-6", book_type: "illustrated_storybook", theme_slugs: ["bedtime","kindness"], buyer_job_tags: ["parent_calm"] };
    expect(bookMatchesFilter(b, { theme: "bedtime" })).toBe(true);
    expect(bookMatchesFilter(b, { theme: "courage" })).toBe(false);
    expect(bookMatchesFilter(b, { age_band: "4-6", theme: "kindness" })).toBe(true);
    expect(bookMatchesFilter(b, { age_band: "0-3" })).toBe(false);
    expect(bookMatchesFilter(b, { book_type: "coloring_book" })).toBe(false);
    expect(bookMatchesFilter(b, { buyer_job: "parent_calm" })).toBe(true);
    expect(bookMatchesFilter(b, { buyer_job: "teacher" })).toBe(false);
    expect(bookMatchesFilter(b, {})).toBe(true);
  });

  it("buildKidsUrl / parseKidsUrl round-trip", () => {
    const url = buildKidsUrl({ age: "4-6", theme: "bedtime" });
    expect(url).toBe("/kids?age=4-6&theme=bedtime");
    const parsed = parseKidsUrl(new URLSearchParams("age=4-6&theme=bedtime&type=coloring_book"));
    expect(parsed).toEqual({ age: "4-6", theme: "bedtime", type: "coloring_book" });
    expect(buildKidsUrl({})).toBe("/kids");
  });
});
