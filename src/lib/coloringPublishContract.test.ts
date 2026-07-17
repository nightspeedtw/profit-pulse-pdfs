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
});
