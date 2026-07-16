// Conveyor throughput class — unit tests for the self-advance helper and
// the fire-and-forget dispatch primitive.
//
// These tests do NOT touch the network. They exercise:
//   * `tickWindow` sliding-hour cap math.
//   * `scheduleSelfAdvance` counter enforcement + fetch invocation.
//   * `fireAndForgetPost` timeout-treated-as-dispatched semantics.

import { describe, it, expect, vi } from "vitest";
import {
  tickWindow,
  scheduleSelfAdvance,
  fireAndForgetPost,
  SELF_ADVANCE_DEFAULT_HOURLY_CAP,
} from "../../supabase/functions/_shared/coloring/self-advance.ts";

function fakeDb(initial: Record<string, unknown> = {}) {
  const state = { metadata: { ...initial } as Record<string, unknown> };
  const api = {
    from(_t: string) {
      return {
        select(_c: string) {
          return {
            eq(_col: string, _v: string) {
              return {
                maybeSingle: async () => ({ data: { metadata: state.metadata } }),
                single: async () => ({ data: { metadata: state.metadata } }),
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          if (patch.metadata) state.metadata = patch.metadata as Record<string, unknown>;
          return { eq: async () => ({ data: null }) };
        },
      };
    },
    _state: state,
  };
  return api;
}

describe("tickWindow", () => {
  it("starts a fresh window when there is no prior state", () => {
    const now = new Date("2026-07-16T10:00:00Z");
    const r = tickWindow(undefined, now, 20);
    expect(r.allowed).toBe(true);
    expect(r.window.count).toBe(1);
    expect(r.window.window_start).toBe(now.toISOString());
  });

  it("increments within the sliding hour", () => {
    const start = new Date("2026-07-16T10:00:00Z");
    const later = new Date("2026-07-16T10:30:00Z");
    const r = tickWindow({ window_start: start.toISOString(), count: 5 }, later, 20);
    expect(r.allowed).toBe(true);
    expect(r.window.count).toBe(6);
    expect(r.window.window_start).toBe(start.toISOString());
  });

  it("refuses once the cap is reached", () => {
    const start = new Date("2026-07-16T10:00:00Z");
    const later = new Date("2026-07-16T10:45:00Z");
    const r = tickWindow({ window_start: start.toISOString(), count: 20 }, later, 20);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("self_advance_hourly_cap");
  });

  it("rolls to a new window after 1h", () => {
    const start = new Date("2026-07-16T10:00:00Z");
    const later = new Date("2026-07-16T11:05:00Z");
    const r = tickWindow({ window_start: start.toISOString(), count: 20 }, later, 20);
    expect(r.allowed).toBe(true);
    expect(r.window.count).toBe(1);
    expect(r.window.window_start).toBe(later.toISOString());
  });
});

describe("scheduleSelfAdvance", () => {
  it("schedules the dispatch when under the cap", async () => {
    const db = fakeDb();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const r = await scheduleSelfAdvance(db as any, "book-1", {
      delayMs: 0, url: "http://x", serviceKey: "k", fetchImpl: fetchImpl as any,
    });
    expect(r.scheduled).toBe(true);
    // Detached task fires asynchronously; give it a microtask + timer tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = (fetchImpl.mock.calls[0]?.[0] ?? "") as string;
    expect(url).toContain("coloring-worker-tick");
  });

  it("refuses when the hourly cap is exceeded", async () => {
    const db = fakeDb({
      coloring_self_advance_window: {
        window_start: new Date().toISOString(),
        count: SELF_ADVANCE_DEFAULT_HOURLY_CAP,
      },
    });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const r = await scheduleSelfAdvance(db as any, "book-1", {
      delayMs: 0, url: "http://x", serviceKey: "k", fetchImpl: fetchImpl as any,
    });
    expect(r.scheduled).toBe(false);
    expect(r.reason).toContain("self_advance_hourly_cap");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("fireAndForgetPost", () => {
  it("returns quickly and treats a timeout as dispatched", async () => {
    // Fetch that never resolves; the 100ms timeout should abort it.
    const fetchImpl = vi.fn((_url: string, opts: any) => new Promise((_res, rej) => {
      opts.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as unknown as typeof fetch;
    const t0 = Date.now();
    const r = await fireAndForgetPost("http://x", {}, { hi: 1 }, 100, fetchImpl);
    const elapsed = Date.now() - t0;
    expect(r.dispatched).toBe(true);
    expect(r.error).toContain("timeout");
    expect(elapsed).toBeLessThan(500);
  });

  it("returns the status when the request completes fast", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch;
    const r = await fireAndForgetPost("http://x", {}, { hi: 1 }, 1_000, fetchImpl);
    expect(r.dispatched).toBe(true);
    expect(r.status).toBe(202);
  });
});
