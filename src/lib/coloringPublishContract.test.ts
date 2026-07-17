import { describe, expect, it } from "vitest";
import {
  assertColoringPublishContract,
  COLORING_PUBLISH_CONTRACT_VERSION,
} from "../../supabase/functions/_shared/coloring/publish-contract";

function baseInput(over: Record<string, unknown> = {}) {
  const meta: any = {
    coloring_cover: {
      art_canvas: { width: 1600, height: 2071 },
      title_treatment: {
        typography_source: "ideogram_verified_integrated",
        overlay_applied: false,
      },
      evidence: {
        hero: { matches: true, degraded: false, detected_subjects: ["unicorn"] },
      },
    },
    coloring_cover_gate: {
      pass: true,
      scorecard: { cover_category_match: 99 },
    },
    thumbnail_render_meta: {
      canvas: { width: 600, height: 776 },
      non_crop_pass: true,
    },
    ...(over.metadata as Record<string, unknown> ?? {}),
  };
  return {
    book_type: "coloring_book",
    cover_url: "https://cdn/cover.png",
    thumbnail_url: "https://cdn/thumb.jpg",
    metadata: meta,
    ...over,
  };
}

describe("assertColoringPublishContract", () => {
  it("passes when baked, trimmed, and distinct thumbnail exist", () => {
    const r = assertColoringPublishContract(baseInput() as any);
    expect(r.pass).toBe(true);
    expect(r.contract_version).toBe(COLORING_PUBLISH_CONTRACT_VERSION);
  });

  it("rejects textless_art_plus_svg_overlay covers (double text)", () => {
    const i = baseInput() as any;
    i.metadata.coloring_cover.title_treatment.typography_source = "textless_art_plus_svg_overlay";
    const r = assertColoringPublishContract(i);
    expect(r.pass).toBe(false);
    expect(r.reasons.join(",")).toMatch(/cover_style_violation/);
  });

  it("rejects when overlay_applied=true even if source claims integrated", () => {
    const i = baseInput() as any;
    i.metadata.coloring_cover.title_treatment.overlay_applied = true;
    const r = assertColoringPublishContract(i);
    expect(r.pass).toBe(false);
    expect(r.checks.cover_baked_title_only).toBe(false);
  });

  it("rejects when thumbnail_url == cover_url", () => {
    const i = baseInput() as any;
    i.thumbnail_url = i.cover_url;
    const r = assertColoringPublishContract(i);
    expect(r.pass).toBe(false);
    expect(r.checks.thumbnail_distinct_and_fitted).toBe(false);
  });

  it("rejects when thumbnail non_crop_pass is false", () => {
    const i = baseInput() as any;
    i.metadata.thumbnail_render_meta.non_crop_pass = false;
    const r = assertColoringPublishContract(i);
    expect(r.pass).toBe(false);
  });

  it("rejects square cover raster (trim mismatch)", () => {
    const i = baseInput() as any;
    i.metadata.coloring_cover.art_canvas = { width: 1600, height: 1600 };
    const r = assertColoringPublishContract(i);
    expect(r.pass).toBe(false);
    expect(r.checks.trim_verified).toBe(false);
  });

  it("fails when coloring_cover_gate is missing (silent-pass bypass class)", () => {
    const i = baseInput() as any;
    delete i.metadata.coloring_cover_gate;
    delete i.metadata.coloring_cover.evidence;
    const r = assertColoringPublishContract(i);
    expect(r.pass).toBe(false);
    expect(r.checks.cover_category_verified).toBe(false);
    expect(r.reasons.join(",")).toMatch(/cover_category_unverified/);
  });

  it("fails when hero verification is degraded (NULL vision result)", () => {
    const i = baseInput() as any;
    i.metadata.coloring_cover.evidence.hero = { matches: true, degraded: true };
    const r = assertColoringPublishContract(i);
    expect(r.pass).toBe(false);
    expect(r.checks.cover_category_verified).toBe(false);
  });

  it("fails when cover_category_match < 98 (wrong-scene detected)", () => {
    const i = baseInput() as any;
    i.metadata.coloring_cover_gate.scorecard.cover_category_match = 40;
    const r = assertColoringPublishContract(i);
    expect(r.pass).toBe(false);
    expect(r.checks.cover_category_verified).toBe(false);
  });
});
