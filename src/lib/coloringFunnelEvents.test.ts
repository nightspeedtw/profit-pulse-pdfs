import { describe, it, expect, beforeEach, vi } from "vitest";

const insertMock = vi.fn(async () => ({ error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: insertMock }) },
}));

import {
  emitColoringEvent,
  __resetColoringEventDedupeForTests,
} from "@/lib/coloringFunnelEvents";

describe("coloring funnel events — popularity signal wiring", () => {
  beforeEach(() => {
    insertMock.mockClear();
    __resetColoringEventDedupeForTests();
  });

  it("emits with the exact event names the repricer consumes", async () => {
    await emitColoringEvent("view_product", "book-1");
    await emitColoringEvent("open_preview", "book-1");
    await emitColoringEvent("click_buy", "book-1", { force: true });
    const names = insertMock.mock.calls.map((c) => (c[0] as any).event_type);
    expect(names).toEqual(["view_product", "open_preview", "click_buy"]);
  });

  it("dedupes a per-session view_product / open_preview to a single insert", async () => {
    await emitColoringEvent("view_product", "book-1");
    await emitColoringEvent("view_product", "book-1");
    await emitColoringEvent("open_preview", "book-1");
    await emitColoringEvent("open_preview", "book-1");
    expect(insertMock).toHaveBeenCalledTimes(2);
  });

  it("counts preview_page_turn per unique page_index", async () => {
    await emitColoringEvent("preview_page_turn", "b", { extra: { page_index: 0 } });
    await emitColoringEvent("preview_page_turn", "b", { extra: { page_index: 0 } }); // dedupe
    await emitColoringEvent("preview_page_turn", "b", { extra: { page_index: 1 } });
    await emitColoringEvent("preview_page_turn", "b", { extra: { page_index: 2 } });
    expect(insertMock).toHaveBeenCalledTimes(3);
  });

  it("click_buy fires every time when force=true (repricer needs repeat intent)", async () => {
    await emitColoringEvent("click_buy", "b", { force: true });
    await emitColoringEvent("click_buy", "b", { force: true });
    expect(insertMock).toHaveBeenCalledTimes(2);
  });

  it("returns error for missing ebook_id and never inserts", async () => {
    const r = await emitColoringEvent("view_product", "");
    expect(r.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
