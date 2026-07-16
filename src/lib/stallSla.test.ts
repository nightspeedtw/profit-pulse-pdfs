// Regression tests for the global Stall SLA (owner order 2026-07-16):
//   (a) row stuck in 'failed' with newer regime → advance_regime once
//   (b) row with stale heartbeat in a build stage → resume_checkpoint
//   (c) repeat-after-fix class raises the alarm flag

import { describe, expect, it } from "vitest";
import {
  decideReaction,
  isRepeatAfterFix,
  lastProgressAt,
  STALL_THRESHOLD_MS,
  TERMINAL_STATUSES,
} from "../../supabase/functions/_shared/stall-sla.ts";
import { CURRENT_COLORING_REPAIR_REGIME } from "../../supabase/functions/_shared/coloring/repair-regime.ts";

const NOW = Date.parse("2026-07-16T09:00:00Z");
const STALE = new Date(NOW - STALL_THRESHOLD_MS - 60_000).toISOString(); // 31 min ago
const FRESH = new Date(NOW - 60_000).toISOString(); // 1 min ago

describe("Stall SLA — 30-minute rule", () => {
  it("threshold is 30 minutes exactly", () => {
    expect(STALL_THRESHOLD_MS).toBe(30 * 60 * 1000);
  });
  it("terminal statuses are excluded", () => {
    expect(TERMINAL_STATUSES.has("published")).toBe(true);
    expect(TERMINAL_STATUSES.has("retired")).toBe(true);
    expect(TERMINAL_STATUSES.has("failed")).toBe(false);
  });
  it("lastProgressAt prefers newest metadata timestamp", () => {
    const row: any = {
      updated_at: STALE,
      metadata: { coloring_render_completed_at: FRESH },
    };
    expect(lastProgressAt(row)).toBe(Date.parse(FRESH));
  });
});

describe("Test A — failed row with newer regime auto-advances once", () => {
  it("classifies as advance_regime when dead pages exist and regime differs", () => {
    const row: any = {
      id: "a05a5086", book_type: "coloring_book",
      pipeline_status: "failed", updated_at: STALE,
      cover_url: null, pdf_url: null, listing_status: "draft",
      metadata: {
        coloring_dead_pages: [19, 31],
        coloring_repair_attempts: { "19": 4, "31": 4 },
        coloring_last_requeued_regime_version: "v2:old",
      },
    };
    const d = decideReaction(row, NOW, CURRENT_COLORING_REPAIR_REGIME);
    expect(d.is_stalled).toBe(true);
    expect(d.reaction).toBe("advance_regime");
    expect(d.blocker_class).toBe("coloring_failed_with_newer_regime");
    expect((d.evidence as any).dead_pages).toEqual([19, 31]);
  });

  it("does NOT re-advance under the same regime", () => {
    const row: any = {
      id: "a05a5086", book_type: "coloring_book",
      pipeline_status: "failed", updated_at: STALE,
      cover_url: null, pdf_url: null, listing_status: "draft",
      metadata: {
        coloring_dead_pages: [19],
        coloring_last_requeued_regime_version: CURRENT_COLORING_REPAIR_REGIME,
      },
    };
    const d = decideReaction(row, NOW, CURRENT_COLORING_REPAIR_REGIME);
    // Falls through to surface_blocker instead of advance_regime — never loops.
    expect(d.reaction).not.toBe("advance_regime");
  });
});

describe("Test B — stale build-stage heartbeat gets resume dispatched", () => {
  it("classifies pdf_building with partial output as resume_checkpoint", () => {
    const row: any = {
      id: "19ca7a86", book_type: "coloring_book",
      pipeline_status: "pdf_building", updated_at: STALE,
      cover_url: "https://cdn/cover.png", pdf_url: null, listing_status: "draft",
      metadata: {
        awaiting: "cover_pdf_publish",
        coloring_pages: new Array(30).fill({ page: 1 }),
      },
    };
    const d = decideReaction(row, NOW, CURRENT_COLORING_REPAIR_REGIME);
    expect(d.is_stalled).toBe(true);
    expect(d.reaction).toBe("resume_checkpoint");
    expect((d.evidence as any).has_cover).toBe(true);
    expect((d.evidence as any).stored_pages).toBe(30);
  });

  it("classifies stale queued row with cover ladder state as resume_checkpoint", () => {
    const row: any = {
      id: "19ca7a86", book_type: "coloring_book",
      pipeline_status: "queued", updated_at: STALE,
      cover_url: null, pdf_url: null, listing_status: "draft",
      metadata: {
        awaiting: "cover_pdf_publish",
        coloring_cover_ladder: { next_index: 1, updated_at: STALE },
      },
    };
    const d = decideReaction(row, NOW, CURRENT_COLORING_REPAIR_REGIME);
    expect(d.reaction).toBe("resume_checkpoint");
    expect((d.evidence as any).cover_ladder_index).toBe(1);
  });

  it("fresh rows are never flagged", () => {
    const row: any = {
      id: "x", book_type: "coloring_book",
      pipeline_status: "queued", updated_at: FRESH,
      cover_url: null, pdf_url: null, listing_status: "draft",
      metadata: {},
    };
    const d = decideReaction(row, NOW, CURRENT_COLORING_REPAIR_REGIME);
    expect(d.is_stalled).toBe(false);
  });
});

describe("Test C — repeat-after-fix class raises the alarm flag", () => {
  it("flags true when a pipeline_skills entry claims the class is fixed", () => {
    const skills = [{ metadata: { defect_class: "coloring_failed_with_newer_regime" } }];
    expect(isRepeatAfterFix("coloring_failed_with_newer_regime", skills)).toBe(true);
  });
  it("flags false when no skill has claimed the class", () => {
    const skills = [{ metadata: { defect_class: "some_other_class" } }];
    expect(isRepeatAfterFix("coloring_failed_with_newer_regime", skills)).toBe(false);
  });
  it("handles null metadata gracefully", () => {
    expect(isRepeatAfterFix("x", [{ metadata: null as any }])).toBe(false);
  });
});
