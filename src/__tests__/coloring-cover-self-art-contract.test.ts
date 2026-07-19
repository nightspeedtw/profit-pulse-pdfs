import { describe, expect, it } from "vitest";
import { assertColoringPublishContract } from "../../supabase/functions/_shared/coloring/publish-contract.ts";

describe("coloring cover self-art deterministic fallback", () => {
  it("accepts deterministic exact-title cover evidence without OCR roulette", () => {
    const result = assertColoringPublishContract({
      book_type: "coloring_book",
      cover_url: "cover.png",
      thumbnail_url: "thumb.png",
      created_at: "2026-07-19T00:00:00Z",
      metadata: {
        trim_profile: "square_8_5",
        thumbnail_render_meta: { non_crop_pass: true, canvas: { width: 600, height: 600 } },
        coloring_cover_gate: {
          pass: true,
          scorecard: { cover_category_match: 100 },
        },
        coloring_cover: {
          art_canvas: { width: 1600, height: 1600 },
          cover_used_interior_refs: true,
          cover_reference_page_urls: ["p1.png", "p2.png", "p3.png"],
          title_treatment: {
            typography_source: "deterministic_exact_title_render",
            overlay_applied: false,
            title: "Roaring Dinosaurs",
          },
          evidence: {
            transcription: {
              pass: true,
              degraded: false,
              required_tokens: ["Roaring", "Dinosaurs"],
              missing_required: [],
              misspelled: [],
              extra: [],
            },
          },
        },
      },
    });

    expect(result.critical_reasons).toEqual([]);
    expect(result.checks.cover_spelling_verified).toBe(true);
    expect(result.checks.cover_baked_title_only).toBe(true);
  });
});