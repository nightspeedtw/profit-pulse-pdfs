import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { kidsCheckoutPath, isSafeReturnPath, rememberReturnPath, formatUsd } from "@/lib/kidsCheckout";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("kids checkout helpers", () => {
  it("builds the checkout route", () => {
    expect(kidsCheckoutPath("abc-123")).toBe("/kids/checkout/abc-123");
  });
  it("only stores same-origin return paths", () => {
    const store: Record<string, string> = {};
    const s = { setItem: (k: string, v: string) => { store[k] = v; } };
    expect(rememberReturnPath("/kids/checkout/abc", s)).toBe(true);
    expect(store["auth:next"]).toBe("/kids/checkout/abc");
    expect(rememberReturnPath("//evil.example", s)).toBe(false);
    expect(rememberReturnPath("https://evil.example", s)).toBe(false);
    expect(isSafeReturnPath(null)).toBe(false);
  });
  it("formats USD and never prints NaN", () => {
    expect(formatUsd(2499)).toBe("$24.99");
    expect(formatUsd(null)).toBe("$0.00");
    expect(formatUsd(Number.NaN)).toBe("$0.00");
  });
});

// Contract: the customer-facing buy path must charge through Paddle and must
// not hand out the PDF through the free-download bypass.
describe("paid checkout wiring", () => {
  it("KidsCheckout opens the Paddle checkout and does not call free-download", () => {
    const src = read("src/pages/KidsCheckout.tsx");
    expect(src).toContain("openBookCheckout");
    expect(src).not.toContain("free-download");
  });
  it("ColoringProduct sends buyers to checkout instead of a free download", () => {
    const src = read("src/pages/ColoringProduct.tsx");
    expect(src).toContain("kidsCheckoutPath(");
    expect(src).not.toContain('invoke("free-download"');
  });
  it("the checkout page is English and priced in USD", () => {
    const src = read("src/pages/KidsCheckout.tsx");
    expect(/[฀-๿]/.test(src)).toBe(false);
    expect(src).not.toContain("฿");
  });
});
