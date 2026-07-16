// Regression tests for the two wired-reaction classes:
//   1. Watchdog auto-requeues coloring rows in pipeline_status='failed'
//      exactly once per repair-regime version bump.
//   2. Cover-ladder rung crashes leave evidence (attempts_by_rung) and
//      cascade speed / advance rung instead of silent-looping.

import { describe, expect, it } from "vitest";
import { CURRENT_COLORING_REPAIR_REGIME } from "../../supabase/functions/_shared/coloring/repair-regime.ts";

// --- Watchdog simulation (pure JS mirror of the tick's decision logic) ---

interface FakeRow {
  id: string;
  pipeline_status: "failed" | "queued" | "generating";
  metadata: Record<string, unknown>;
}

function watchdogRequeue(rows: FakeRow[], currentRegime: string): FakeRow[] {
  const requeued: FakeRow[] = [];
  for (const row of rows) {
    if (row.pipeline_status !== "failed") continue;
    const lastVer = row.metadata.coloring_last_requeued_regime_version as string | undefined;
    if (lastVer === currentRegime) continue;
    const dead = (row.metadata.coloring_dead_pages as number[] | undefined) ?? [];
    const attempts = { ...((row.metadata.coloring_repair_attempts as Record<string, number> | undefined) ?? {}) };
    for (const p of dead) attempts[String(p)] = 0;
    row.metadata = {
      ...row.metadata,
      coloring_repair_attempts: attempts,
      coloring_last_requeued_regime_version: currentRegime,
    };
    row.pipeline_status = "queued";
    requeued.push(row);
  }
  return requeued;
}

describe("class 1 — failed-row watchdog auto-requeue", () => {
  it("requeues a failed row with dead pages under a newer regime", () => {
    const row: FakeRow = {
      id: "a05a5086",
      pipeline_status: "failed",
      metadata: {
        coloring_dead_pages: [19, 31],
        coloring_repair_attempts: { "19": 4, "31": 4 },
      },
    };
    const out = watchdogRequeue([row], CURRENT_COLORING_REPAIR_REGIME);
    expect(out).toHaveLength(1);
    expect(row.pipeline_status).toBe("queued");
    expect((row.metadata.coloring_repair_attempts as Record<string, number>)["19"]).toBe(0);
    expect((row.metadata.coloring_repair_attempts as Record<string, number>)["31"]).toBe(0);
    expect(row.metadata.coloring_last_requeued_regime_version).toBe(CURRENT_COLORING_REPAIR_REGIME);
  });

  it("does NOT requeue twice under the same regime version", () => {
    const row: FakeRow = {
      id: "a05a5086",
      pipeline_status: "failed",
      metadata: {
        coloring_dead_pages: [19],
        coloring_repair_attempts: { "19": 4 },
        coloring_last_requeued_regime_version: CURRENT_COLORING_REPAIR_REGIME,
      },
    };
    const out = watchdogRequeue([row], CURRENT_COLORING_REPAIR_REGIME);
    expect(out).toHaveLength(0);
    expect(row.pipeline_status).toBe("failed");
  });

  it("requeues again after a regime version bump", () => {
    const row: FakeRow = {
      id: "a05a5086",
      pipeline_status: "failed",
      metadata: {
        coloring_dead_pages: [19],
        coloring_repair_attempts: { "19": 4 },
        coloring_last_requeued_regime_version: "v2:old",
      },
    };
    const out = watchdogRequeue([row], CURRENT_COLORING_REPAIR_REGIME);
    expect(out).toHaveLength(1);
    expect(row.pipeline_status).toBe("queued");
  });

  it("never leaves a failed coloring row silently if a new regime exists", () => {
    const rows: FakeRow[] = [
      { id: "r1", pipeline_status: "failed", metadata: { coloring_dead_pages: [] } },
      { id: "r2", pipeline_status: "failed", metadata: { coloring_dead_pages: [7], coloring_last_requeued_regime_version: "old" } },
    ];
    const out = watchdogRequeue(rows, CURRENT_COLORING_REPAIR_REGIME);
    expect(out.map(r => r.id).sort()).toEqual(["r1", "r2"]);
    for (const r of rows) expect(r.pipeline_status).toBe("queued");
  });
});

// --- Cover ladder crash cascade (pure JS mirror of the state machine) ---

const IDEOGRAM_SPEEDS = ["QUALITY", "BALANCED", "TURBO"] as const;
const RUNGS = ["ideogram_v3_a", "ideogram_v3_b", "recraft_v3_ref", "gemini_refs", "svg_synthetic_fallback"] as const;

interface Attempt { speed?: string | null; started_at: string; ended_at?: string | null; ok?: boolean; reason?: string | null; status?: string; }
interface State {
  next_index: number;
  ideogram_speed_cursor: number;
  attempts_by_rung: Record<string, Attempt[]>;
}

function cascadeAfterFailure(state: State) {
  const rung = RUNGS[state.next_index];
  const isIdeogram = rung === "ideogram_v3_a" || rung === "ideogram_v3_b";
  if (isIdeogram && state.ideogram_speed_cursor < IDEOGRAM_SPEEDS.length - 1) {
    state.ideogram_speed_cursor += 1;
  } else {
    state.next_index += 1;
    state.ideogram_speed_cursor = 0;
  }
}

describe("class 2 — cover ladder rung crash leaves evidence + cascades", () => {
  it("wallclock timeout on ideogram QUALITY cascades to BALANCED, not to next rung", () => {
    const state: State = { next_index: 0, ideogram_speed_cursor: 0, attempts_by_rung: {} };
    // Simulate persisted attempt-before-call + wallclock timeout.
    state.attempts_by_rung["ideogram_v3_a"] = [{
      speed: "QUALITY", started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(), ok: false, reason: "wallclock_timeout", status: "error",
    }];
    cascadeAfterFailure(state);
    expect(state.next_index).toBe(0);
    expect(IDEOGRAM_SPEEDS[state.ideogram_speed_cursor]).toBe("BALANCED");
  });

  it("after QUALITY → BALANCED → TURBO all fail on ideogram_v3_a, advances to ideogram_v3_b", () => {
    const state: State = { next_index: 0, ideogram_speed_cursor: 0, attempts_by_rung: {} };
    cascadeAfterFailure(state); // -> BALANCED
    cascadeAfterFailure(state); // -> TURBO
    cascadeAfterFailure(state); // exhausted -> next rung
    expect(RUNGS[state.next_index]).toBe("ideogram_v3_b");
    expect(state.ideogram_speed_cursor).toBe(0);
  });

  it("non-ideogram rung failure advances rung directly (no speed cascade)", () => {
    const state: State = { next_index: 2 /* recraft_v3_ref */, ideogram_speed_cursor: 0, attempts_by_rung: {} };
    cascadeAfterFailure(state);
    expect(RUNGS[state.next_index]).toBe("gemini_refs");
  });

  it("crashed attempt (no ended_at) is left as evidence for the next invocation", () => {
    const state: State = { next_index: 0, ideogram_speed_cursor: 0, attempts_by_rung: {} };
    const started = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 min ago
    state.attempts_by_rung["ideogram_v3_a"] = [{ speed: "QUALITY", started_at: started, ended_at: null }];
    const last = state.attempts_by_rung["ideogram_v3_a"].slice(-1)[0];
    expect(last.ended_at).toBeNull();
    const stale = Date.now() - new Date(last.started_at).getTime() > 3 * 60_000;
    expect(stale).toBe(true);
    // Detector marks it crashed and cascades
    last.ended_at = new Date().toISOString();
    last.status = "crashed";
    cascadeAfterFailure(state);
    expect(IDEOGRAM_SPEEDS[state.ideogram_speed_cursor]).toBe("BALANCED");
  });

  it("regime version constant is present and non-empty", () => {
    expect(typeof CURRENT_COLORING_REPAIR_REGIME).toBe("string");
    expect(CURRENT_COLORING_REPAIR_REGIME.length).toBeGreaterThan(3);
  });
});
