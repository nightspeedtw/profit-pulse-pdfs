// Unit tests for the US retail calendar resolver.
import { describe, it, expect } from "vitest";
import { resolveSeasonAnchor } from "../../supabase/functions/_shared/marketing/us-calendar";

describe("us-calendar", () => {
  it("resolves Halloween as fixed date Oct 31", () => {
    const d = resolveSeasonAnchor({ kind: "fixed_date", month: 10, day: 31 }, 2026)!;
    expect(d.getUTCMonth()).toBe(9);
    expect(d.getUTCDate()).toBe(31);
  });

  it("resolves Thanksgiving 2026 as Nov 26 (4th Thursday)", () => {
    const d = resolveSeasonAnchor({ kind: "us_holiday", tag: "thanksgiving_us" }, 2026)!;
    expect(d.getUTCMonth()).toBe(10);
    expect(d.getUTCDate()).toBe(26);
  });

  it("resolves Black Friday 2026 as Nov 27", () => {
    const d = resolveSeasonAnchor({ kind: "us_holiday", tag: "black_friday_us" }, 2026)!;
    expect(d.getUTCMonth()).toBe(10);
    expect(d.getUTCDate()).toBe(27);
  });

  it("resolves Cyber Monday 2026 as Nov 30", () => {
    const d = resolveSeasonAnchor({ kind: "us_holiday", tag: "cyber_monday_us" }, 2026)!;
    expect(d.getUTCMonth()).toBe(10);
    expect(d.getUTCDate()).toBe(30);
  });

  it("resolves Mother's Day 2026 as May 10 (2nd Sunday)", () => {
    const d = resolveSeasonAnchor({ kind: "us_holiday", tag: "mothers_day_us" }, 2026)!;
    expect(d.getUTCMonth()).toBe(4);
    expect(d.getUTCDate()).toBe(10);
  });

  it("resolves Easter 2026 as April 5", () => {
    const d = resolveSeasonAnchor({ kind: "us_holiday", tag: "easter_us" }, 2026)!;
    expect(d.getUTCMonth()).toBe(3);
    expect(d.getUTCDate()).toBe(5);
  });
});
