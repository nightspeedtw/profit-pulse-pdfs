import { describe, expect, it } from "vitest";
import {
  pickClosestColoringV2Book,
  shouldSpendForRenderPage,
} from "../../supabase/functions/_shared/coloring-v2/one-book";

describe("Coloring V2 one-book owner law", () => {
  it("picks the closest-to-done book before older queued or earlier-stage books", () => {
    const picked = pickClosestColoringV2Book([
      { id: "old-queued", stage: "queued", updated_at: "2026-07-20T00:00:00Z" },
      { id: "almost-cover", stage: "interior_render", interiors_done: 31, page_count: 32, updated_at: "2026-07-21T00:00:00Z" },
      { id: "just-started", stage: "interior_render", interiors_done: 1, page_count: 32, updated_at: "2026-07-25T00:00:00Z" },
      { id: "qc-now", stage: "qc", interiors_done: 32, page_count: 32, updated_at: "2026-07-19T00:00:00Z" },
    ]);

    expect(picked?.id).toBe("qc-now");
  });

  it("uses interior progress as the tie-breaker inside render stage", () => {
    const picked = pickClosestColoringV2Book([
      { id: "newer-less-done", stage: "interior_render", interiors_done: 4, updated_at: "2026-07-25T00:00:00Z" },
      { id: "older-more-done", stage: "interior_render", interiors_done: 30, updated_at: "2026-07-20T00:00:00Z" },
    ]);

    expect(picked?.id).toBe("older-more-done");
  });

  it("blocks render spending without the production lock", () => {
    expect(shouldSpendForRenderPage({
      stage: "interior_render",
      lockAcquired: false,
      requestedPage: 7,
      pageCount: 32,
      pageAlreadyRendered: false,
    })).toEqual({ allowed: false, reason: "waiting_for_lock" });
  });

  it("blocks duplicate and out-of-range page renders", () => {
    expect(shouldSpendForRenderPage({
      stage: "interior_render",
      lockAcquired: true,
      requestedPage: 33,
      pageCount: 32,
      pageAlreadyRendered: false,
    })).toEqual({ allowed: false, reason: "render_page_out_of_range" });

    expect(shouldSpendForRenderPage({
      stage: "interior_render",
      lockAcquired: true,
      requestedPage: 9,
      pageCount: 32,
      pageAlreadyRendered: true,
    })).toEqual({ allowed: false, reason: "page_already_rendered" });
  });
});