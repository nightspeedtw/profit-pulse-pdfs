import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { kidsFreeDownloadDecision } from "../../supabase/functions/free-download/policy";

// Regression: the endpoint returned a signed PDF URL for ANY kids book to any
// caller ("payment bypass"), so paid books could be downloaded without paying.
describe("free-download policy for kids books", () => {
  it("refuses a priced book", () => {
    expect(kidsFreeDownloadDecision({ price_cents: 2499, pdf_url: "https://x/y.pdf" })).toEqual({ allowed: false, reason: "payment_required" });
  });
  it("refuses when the price is missing or invalid (missing data is not 'free')", () => {
    expect(kidsFreeDownloadDecision({ price_cents: null, pdf_url: "https://x/y.pdf" }).allowed).toBe(false);
    expect(kidsFreeDownloadDecision({ pdf_url: "https://x/y.pdf" }).allowed).toBe(false);
    expect(kidsFreeDownloadDecision({ price_cents: Number.NaN, pdf_url: "https://x/y.pdf" }).allowed).toBe(false);
  });
  it("allows a genuinely free book that has a PDF", () => {
    expect(kidsFreeDownloadDecision({ price_cents: 0, pdf_url: "https://x/y.pdf" })).toEqual({ allowed: true });
    expect(kidsFreeDownloadDecision({ price_cents: 0, pdf_url: null })).toEqual({ allowed: false, reason: "pdf_not_available" });
  });
  it("the edge function applies the policy to kids books", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/free-download/index.ts"), "utf8");
    expect(src).toContain("kidsFreeDownloadDecision(");
    expect(src).not.toContain("regardless");
  });
});
