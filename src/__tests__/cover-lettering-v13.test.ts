import { describe, it, expect } from "vitest";
import {
  LETTERING_STYLE_IDS,
  pickLetteringStyleId,
  ageBadgeLabel,
} from "@/lib/coverLetteringV13";

describe("cover_illustrated_lettering_v13", () => {
  it("returns a valid style id", () => {
    const id = pickLetteringStyleId("6133ac75-0000-0000-0000-000000000000");
    expect(LETTERING_STYLE_IDS).toContain(id);
  });

  it("is deterministic per book_id (same input → same style)", () => {
    const a = pickLetteringStyleId("book-abc-123");
    const b = pickLetteringStyleId("book-abc-123");
    expect(a).toBe(b);
  });

  it("produces variety across the shelf (≥3 distinct styles over 30 ids)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(pickLetteringStyleId(`book-${i}-${i * 7}`));
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it("age badge formats every supported band", () => {
    expect(ageBadgeLabel("2-4")).toBe("AGES 2-4");
    expect(ageBadgeLabel("4-6")).toBe("AGES 4-6");
    expect(ageBadgeLabel("6-8")).toBe("AGES 6-8");
    expect(ageBadgeLabel("8-12")).toBe("AGES 8-12");
    expect(ageBadgeLabel("13-17")).toBe("AGES 13-17");
  });

  it("age badge tolerates prefix/whitespace and en-dash", () => {
    expect(ageBadgeLabel("ages 4-6")).toBe("AGES 4-6");
    expect(ageBadgeLabel(" 8 – 12 ")).toBe("AGES 8-12");
  });

  it("age badge returns null on missing/invalid input", () => {
    expect(ageBadgeLabel(null)).toBeNull();
    expect(ageBadgeLabel("")).toBeNull();
    expect(ageBadgeLabel("all-ages")).toBeNull();
  });
});
