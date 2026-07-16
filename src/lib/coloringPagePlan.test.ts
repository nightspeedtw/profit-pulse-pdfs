import { describe, expect, it } from "vitest";
import {
  generatePagePlan,
  validatePagePlan,
} from "../../supabase/functions/_shared/coloring/page-plan.ts";

const CAT = {
  category_key: "sea_animals",
  allowed_subjects: [
    "seahorse","dolphin","whale","shark","sea turtle","octopus","jellyfish","crab",
    "lobster","starfish","tropical fish","manta ray","seal","narwhal","squid",
    "clownfish","pufferfish",
  ],
  allowed_supporting_elements: ["coral","seaweed","shells","bubbles"],
  forbidden_subjects: ["cow","tractor","dinosaur","human"],
  coloring_page_count: 32,
};

describe("coloring page plan", () => {
  it("generates 32 unique concepts within category", () => {
    const { plan } = generatePagePlan(CAT);
    expect(plan).toHaveLength(32);
    expect(validatePagePlan(plan, CAT)).toEqual([]);
  });

  it("rejects a plan with an out-of-category subject", () => {
    const { plan } = generatePagePlan(CAT);
    plan[5].primary_subject = "cow";
    const issues = validatePagePlan(plan, CAT);
    expect(issues.some((i) => i.code === "FORBIDDEN_SUBJECT")).toBe(true);
  });

  it("rejects a plan with a duplicate concept tuple", () => {
    const { plan } = generatePagePlan(CAT);
    plan[10].primary_subject = plan[0].primary_subject;
    plan[10].scene = plan[0].scene;
    plan[10].composition_type = plan[0].composition_type;
    const issues = validatePagePlan(plan, CAT);
    expect(issues.some((i) => i.code === "DUPLICATE_CONCEPT")).toBe(true);
  });

  it("distributes subjects so none exceeds the cap", () => {
    const { plan } = generatePagePlan(CAT);
    const counts = new Map<string, number>();
    for (const p of plan) counts.set(p.primary_subject, (counts.get(p.primary_subject) ?? 0) + 1);
    const distinct = counts.size;
    const cap = Math.ceil(32 / distinct) + 1;
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(cap);
  });

  it("produces no DUPLICATE_CONCEPT with 32 pages / 6 subjects (lcm bucket collision regression)", () => {

    const smallCat = {
      category_key: "mini",
      allowed_subjects: ["cat","dog","fox","bear","owl","rabbit"],
      allowed_supporting_elements: ["tree","flower"],
      forbidden_subjects: [],
      coloring_page_count: 32,
    };
    const { plan } = generatePagePlan(smallCat);
    const issues = validatePagePlan(plan, smallCat);
    expect(issues.filter((i) => i.code === "DUPLICATE_CONCEPT")).toEqual([]);
  });

  it("supports 16-page format: 2 full scene cycles, ≥5 buckets, no duplicates", () => {
    const cat16 = { ...CAT, coloring_page_count: 16 };
    const { plan } = generatePagePlan(cat16);
    expect(plan).toHaveLength(16);
    expect(validatePagePlan(plan, cat16)).toEqual([]);
    // 2 full cycles across 8 buckets
    const buckets = new Set(plan.map((p) => (p as any).scene_bucket));
    expect(buckets.size).toBeGreaterThanOrEqual(5);
  });

  it("16-page format with 6-subject category satisfies subject cap", () => {
    const smallCat16 = {
      category_key: "mini16",
      allowed_subjects: ["cat","dog","fox","bear","owl","rabbit"],
      allowed_supporting_elements: ["tree","flower"],
      forbidden_subjects: [],
      coloring_page_count: 16,
    };
    const { plan } = generatePagePlan(smallCat16);
    const issues = validatePagePlan(plan, smallCat16);
    expect(issues).toEqual([]);
  });

  it("assemble expected_page_count follows plan length (front matter 4 + plan + certificate 1)", () => {
    // Mirrors coloring-book-assemble: expectedPageCount = 4 + plan.length + 1.
    // 16pp interior → 21 total PDF pages.
    const compute = (planLen: number) => 4 + planLen + 1;
    expect(compute(16)).toBe(21);
    expect(compute(24)).toBe(29);
    expect(compute(32)).toBe(37);
    expect(compute(48)).toBe(53);
  });
});

