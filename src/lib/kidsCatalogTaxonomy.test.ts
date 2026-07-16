import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  AGE_BANDS, AGE_CHIPS, BOOK_TYPES, THEMES, BUYER_JOBS,
  CATEGORY_PAGES, resolveCategory, bookMatchesFilter,
  bookMatchesAgeChip, bookIsForKids, resolveAgeChip,
  buildKidsUrl, parseKidsUrl,
} from "./kidsCatalogTaxonomy";

describe("kids catalog taxonomy", () => {
  it("ships legacy 4 age bands + owner's 7 age chips (All, 2-4, 4-6, 6-8, 8-12, 13-17, All Ages)", () => {
    expect(AGE_BANDS.map((a) => a.slug)).toEqual(["0-3","3-5","4-6","6-8"]);
    expect(AGE_CHIPS.map((a) => a.slug)).toEqual(["all","2-4","4-6","6-8","8-12","13-17","all_ages"]);
    expect(BOOK_TYPES.map((b) => b.slug)).toEqual(["illustrated_storybook","coloring_book"]);
    expect(THEMES).toHaveLength(8);
    expect(BUYER_JOBS.map((b) => b.slug)).toEqual(["parent_calm","teacher","gift"]);
  });

  it("every category page has SEO copy and a filter", () => {
    for (const c of CATEGORY_PAGES) {
      expect(c.titleTag.length).toBeGreaterThan(20);
      expect(c.titleTag.length).toBeLessThanOrEqual(85);
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

describe("kids age chip — range overlap matching", () => {
  const chip = (slug: string) => resolveAgeChip(slug)!;

  it("3–5 product (age_min=3, age_max=5) surfaces under BOTH 2–4 and 4–6 (overlap at 4)", () => {
    const b = { age_band: "3_5", age_min: 3, age_max: 5 };
    expect(bookMatchesAgeChip(b, chip("2-4"))).toBe(true);
    expect(bookMatchesAgeChip(b, chip("4-6"))).toBe(true);
    expect(bookMatchesAgeChip(b, chip("6-8"))).toBe(false);
    expect(bookMatchesAgeChip(b, chip("8-12"))).toBe(false);
    expect(bookMatchesAgeChip(b, chip("13-17"))).toBe(false);
    expect(bookMatchesAgeChip(b, chip("all_ages"))).toBe(false);
    expect(bookMatchesAgeChip(b, chip("all"))).toBe(true);
  });

  it("2_3 toddler product surfaces under 2–4 only", () => {
    const b = { age_band: "2_3", age_min: 2, age_max: 3 };
    expect(bookMatchesAgeChip(b, chip("2-4"))).toBe(true);
    expect(bookMatchesAgeChip(b, chip("4-6"))).toBe(false);
  });

  it("all_ages product matches only the All Ages and All chips", () => {
    const b = { age_band: "all_ages", age_min: 2, age_max: 99 };
    expect(bookMatchesAgeChip(b, chip("all_ages"))).toBe(true);
    expect(bookMatchesAgeChip(b, chip("all"))).toBe(true);
    expect(bookMatchesAgeChip(b, chip("2-4"))).toBe(false);
    expect(bookMatchesAgeChip(b, chip("13-17"))).toBe(false);
  });

  it("6_8 kids product matches 6–8 chip", () => {
    const b = { age_band: "6_8", age_min: 6, age_max: 8 };
    expect(bookMatchesAgeChip(b, chip("4-6"))).toBe(true); // overlap at 6
    expect(bookMatchesAgeChip(b, chip("6-8"))).toBe(true);
    expect(bookMatchesAgeChip(b, chip("8-12"))).toBe(true); // overlap at 8
  });

  it("chip filter is empty when book has no age range", () => {
    const b = { age_band: null, age_min: null, age_max: null };
    expect(bookMatchesAgeChip(b, chip("4-6"))).toBe(false);
    expect(bookMatchesAgeChip(b, chip("all"))).toBe(true); // ALL = no filter
  });
});

describe("kids storefront eligibility — adults/seniors excluded", () => {
  it("18+ adult product NEVER appears on /kids", () => {
    const adult = { age_band: "18_plus", age_min: 18, age_max: 99 };
    expect(bookIsForKids(adult)).toBe(false);
  });

  it("60+ senior product NEVER appears on /kids", () => {
    const senior = { age_band: "60_plus", age_min: 60, age_max: 99 };
    expect(bookIsForKids(senior)).toBe(false);
  });

  it("13–17 teen product IS eligible for /kids", () => {
    expect(bookIsForKids({ age_band: "13_17", age_min: 13, age_max: 17 })).toBe(true);
  });

  it("all_ages product IS eligible for /kids even though age_max=99", () => {
    expect(bookIsForKids({ age_band: "all_ages", age_min: 2, age_max: 99 })).toBe(true);
  });

  it("unknown-age product is kept (surface, don't drop)", () => {
    expect(bookIsForKids({ age_band: null, age_min: null, age_max: null })).toBe(true);
  });
});

describe("kids filter chips — no hardcoded age strings in the component", () => {
  it("KidsFilterChips.tsx contains no literal age-band strings (must derive from AGE_CHIPS config)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const componentPath = resolve(here, "..", "components", "kids", "KidsFilterChips.tsx");
    const src = readFileSync(componentPath, "utf-8");
    // strip comments so the "do NOT re-add hardcoded age strings" reminder
    // doesn't count as a hardcoded value.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const forbidden = [
      /["']0-3["']/, /["']3-5["']/, /["']2-4["']/, /["']4-6["']/,
      /["']6-8["']/, /["']8-12["']/, /["']13-17["']/,
      /["']0[–-]3["']/, /["']2[–-]4["']/, /["']4[–-]6["']/,
      /["']6[–-]8["']/, /["']8[–-]12["']/, /["']13[–-]17["']/,
    ];
    for (const pat of forbidden) {
      expect(codeOnly, `KidsFilterChips.tsx must not hardcode ${pat}`).not.toMatch(pat);
    }
  });
});
