import { describe, it, expect } from "vitest";
import {
  buildApprovedTokenSet,
  extractSvgTextNodes,
  verifyTypographySource,
} from "../../supabase/functions/_shared/coloring/typography-source-verifier.ts";
import { pickStyleFamily, STYLE_FAMILIES } from "../../supabase/functions/_shared/coloring/style-families.ts";

describe("cover_v2_deterministic_typography — canonical source guard", () => {
  const canonical = {
    title: "Starlight Unicorns Coloring Book",
    ageBadge: "Ages 4-6",
    brandName: "SecretPDF Kids",
  };

  it("approves an SVG whose text nodes only contain canonical tokens", () => {
    const svg = `<svg>
      <text>STARLIGHT</text>
      <text>UNICORNS</text>
      <text>COLORING BOOK</text>
      <text>Ages 4-6</text>
      <text>SecretPDF Kids</text>
    </svg>`;
    const v = verifyTypographySource(svg, canonical);
    expect(v.pass).toBe(true);
    expect(v.unapproved_nodes).toHaveLength(0);
    expect(v.missing_required).toHaveLength(0);
  });

  it("rejects an SVG that renders any glyph outside the approved set (e.g. baked AI author)", () => {
    const svg = `<svg>
      <text>Starlight Unicorns</text>
      <text>Coloring Book</text>
      <text>By Anonymous</text>
    </svg>`;
    const v = verifyTypographySource(svg, canonical);
    expect(v.pass).toBe(false);
    expect(v.reason).toMatch(/unapproved_glyphs/);
  });

  it("rejects an SVG missing a required canonical token", () => {
    const svg = `<svg>
      <text>Starlight Coloring Book</text>
    </svg>`;
    const v = verifyTypographySource(svg, canonical);
    expect(v.pass).toBe(false);
    expect(v.missing_required).toContain("unicorns");
  });

  it("extracts every visible text node, ignoring tspan wrapping", () => {
    const svg = `<svg><text><tspan>Hi</tspan> <tspan>There</tspan></text></svg>`;
    expect(extractSvgTextNodes(svg)).toEqual(["Hi There"]);
  });

  it("builds an approved-token set from title + subtitle + ageBadge + brand + connectors", () => {
    const set = buildApprovedTokenSet(canonical);
    ["starlight", "unicorns", "coloring", "book", "ages", "4-6", "secretpdf", "kids", "the"]
      .forEach((t) => expect(set.has(t)).toBe(true));
  });
});

describe("cover_v2 style-family selector — diversity via recency avoidance", () => {
  it("picks a space family for a space-themed title", () => {
    const fam = pickStyleFamily({
      title: "Cosmic Astronauts Coloring Book",
      theme: "outer space adventure",
      ageBand: "5-7",
      recentFamilies: [],
    });
    expect(fam.id).toBe("space_sci");
  });

  it("avoids families listed in the recency window", () => {
    const first = pickStyleFamily({
      title: "Sparkle Unicorn Magic Coloring Book",
      theme: "magic unicorns",
      ageBand: "4-6",
      recentFamilies: [],
    });
    const second = pickStyleFamily({
      title: "Sparkle Unicorn Magic Coloring Book",
      theme: "magic unicorns",
      ageBand: "4-6",
      recentFamilies: [first.id],
    });
    expect(second.id).not.toBe(first.id);
  });

  it("every family declares a non-empty preferredLayouts list", () => {
    for (const id of Object.keys(STYLE_FAMILIES)) {
      const f = STYLE_FAMILIES[id as keyof typeof STYLE_FAMILIES];
      expect(f.preferredLayouts.length).toBeGreaterThan(0);
    }
  });
});
