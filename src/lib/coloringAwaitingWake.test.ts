import { describe, it, expect } from "vitest";

// Simulate the coloring-worker-tick wake filter without pulling Deno.serve.
// The rule under test: a parked coloring row is only WOKEN when at least
// one image provider is currently healthy AND next_retry_at has passed.
type ParkedRow = { id: string; pipeline_status: "awaiting_quota_reset" | "awaiting_billing"; next_retry_at: string };
type Health = { cf_healthy: boolean; fal_healthy: boolean };

function pickWakes(rows: ParkedRow[], now: Date, health: Health) {
  const woken: string[] = [];
  const stillWaiting: string[] = [];
  for (const r of rows) {
    if (new Date(r.next_retry_at) > now) { stillWaiting.push(r.id); continue; }
    if (!health.cf_healthy && !health.fal_healthy) { stillWaiting.push(r.id); continue; }
    woken.push(r.id);
  }
  return { woken, stillWaiting };
}

describe("coloring worker-tick wake sweep", () => {
  const now = new Date(Date.UTC(2026, 6, 17, 0, 5, 0));

  it("wakes an awaiting_quota_reset row after next UTC midnight when CF is healthy", () => {
    const rows: ParkedRow[] = [{
      id: "a",
      pipeline_status: "awaiting_quota_reset",
      next_retry_at: new Date(Date.UTC(2026, 6, 17, 0, 1, 30)).toISOString(),
    }];
    const out = pickWakes(rows, now, { cf_healthy: true, fal_healthy: false });
    expect(out.woken).toEqual(["a"]);
    expect(out.stillWaiting).toEqual([]);
  });

  it("does NOT wake if both providers are still dry (avoids burning a dispatch)", () => {
    const rows: ParkedRow[] = [{
      id: "a",
      pipeline_status: "awaiting_billing",
      next_retry_at: new Date(Date.UTC(2026, 6, 17, 0, 0, 0)).toISOString(),
    }];
    const out = pickWakes(rows, now, { cf_healthy: false, fal_healthy: false });
    expect(out.woken).toEqual([]);
    expect(out.stillWaiting).toEqual(["a"]);
  });

  it("does NOT wake when next_retry_at is in the future", () => {
    const rows: ParkedRow[] = [{
      id: "a",
      pipeline_status: "awaiting_quota_reset",
      next_retry_at: new Date(Date.UTC(2026, 6, 18, 0, 0, 0)).toISOString(),
    }];
    const out = pickWakes(rows, now, { cf_healthy: true, fal_healthy: true });
    expect(out.woken).toEqual([]);
    expect(out.stillWaiting).toEqual(["a"]);
  });

  it("wakes an awaiting_billing row only if FAL is healthy (top-up happened)", () => {
    const rows: ParkedRow[] = [{
      id: "a",
      pipeline_status: "awaiting_billing",
      next_retry_at: new Date(Date.UTC(2026, 6, 17, 0, 0, 0)).toISOString(),
    }];
    const outNo = pickWakes(rows, now, { cf_healthy: false, fal_healthy: false });
    expect(outNo.woken).toEqual([]);
    const outYes = pickWakes(rows, now, { cf_healthy: false, fal_healthy: true });
    expect(outYes.woken).toEqual(["a"]);
  });
});
