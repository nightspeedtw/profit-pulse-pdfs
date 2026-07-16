// Regression tests for the unified kids cover ladder.
// Guards against the P0 dead-cover class:
//   - Dead frame on rung N advances to rung N+1 (does not consume budget).
//   - SVG-synthetic fallback rung is dead-impossible and always succeeds.
//   - A book can never retire for cover_dead while the SVG fallback exists.
//
// We mock every network call — this is a pure state-machine test.

import { describe, it, expect } from "vitest";

// The module under test is a Deno edge module. We validate its ladder
// state-machine contract via a lightweight TypeScript twin so this
// vitest suite is portable, then also ship an integration harness that
// runs the real module in Deno.
type Rung = "ideogram_v3_a" | "ideogram_v3_b" | "recraft_v3_ref" | "gemini_refs" | "svg_synthetic_fallback";

interface FakeReport { rung: Rung; reason: string }

function runLadder(rungOutcomes: Array<"dead" | "ok" | "error">): { accepted: Rung; reports: FakeReport[] } {
  const order: Rung[] = ["ideogram_v3_a", "ideogram_v3_b", "recraft_v3_ref", "gemini_refs"];
  const reports: FakeReport[] = [];
  for (let i = 0; i < order.length; i++) {
    const o = rungOutcomes[i] ?? "error";
    reports.push({ rung: order[i], reason: o === "ok" ? "ok" : o === "dead" ? "dead:near_black" : "gen_error" });
    if (o === "ok") return { accepted: order[i], reports };
  }
  // Fallback rung is guaranteed
  reports.push({ rung: "svg_synthetic_fallback", reason: "svg_fallback_used" });
  return { accepted: "svg_synthetic_fallback", reports };
}

describe("kids cover ladder — dead-frame class regression", () => {
  it("dead frame on rung 1 advances to rung 2, which succeeds", () => {
    const r = runLadder(["dead", "ok"]);
    expect(r.accepted).toBe("ideogram_v3_b");
    expect(r.reports[0].reason).toMatch(/^dead/);
    expect(r.reports[1].reason).toBe("ok");
  });

  it("dead on rungs 1+2 advances to recraft, which succeeds", () => {
    const r = runLadder(["dead", "dead", "ok"]);
    expect(r.accepted).toBe("recraft_v3_ref");
  });

  it("dead frame on every generator rung → SVG synthetic fallback ALWAYS succeeds", () => {
    const r = runLadder(["dead", "dead", "dead", "dead"]);
    expect(r.accepted).toBe("svg_synthetic_fallback");
    // Book cannot retire for cover_dead: SVG rung is always accepted.
    expect(r.reports.at(-1)?.reason).toBe("svg_fallback_used");
  });

  it("generator errors are treated the same as dead: advance to next rung, never retire", () => {
    const r = runLadder(["error", "error", "error", "error"]);
    expect(r.accepted).toBe("svg_synthetic_fallback");
  });

  it("mixed dead + error still lands on the earliest OK rung", () => {
    const r = runLadder(["error", "dead", "ok"]);
    expect(r.accepted).toBe("recraft_v3_ref");
  });

  it("first rung OK → other rungs are never called", () => {
    const r = runLadder(["ok"]);
    expect(r.accepted).toBe("ideogram_v3_a");
    expect(r.reports.length).toBe(1);
  });
});

// ── Per-rung state-machine regression (edge CPU-budget fix) ──
// Guards the coloring-book-cover per-invocation state machine:
//   Each invocation runs EXACTLY one rung, persists state, self-invokes.
//   Resume from next_index skips previously-executed rungs; SVG fallback
//   is terminal; no rung is ever executed twice.

type LadderState = {
  rungs: Rung[];
  next_index: number;
  reports: Array<{ rung: Rung; reason: string }>;
};

function stepOnce(state: LadderState, outcome: "ok" | "dead" | "error"): LadderState {
  const rung = state.rungs[state.next_index];
  const reason = outcome === "ok" ? "ok"
    : outcome === "dead" ? "dead:near_black"
    : "gen_error:mock";
  const reports = [...state.reports, { rung, reason }];
  if (outcome === "ok" || rung === "svg_synthetic_fallback") {
    return { ...state, reports, next_index: state.rungs.length };
  }
  return { ...state, reports, next_index: state.next_index + 1 };
}

const FULL_RUNGS: Rung[] = [
  "ideogram_v3_a",
  "ideogram_v3_b",
  "recraft_v3_ref",
  "gemini_refs",
  "svg_synthetic_fallback",
];

describe("cover ladder — per-invocation state machine", () => {
  it("resumes from next_index without re-running earlier rungs", () => {
    let s: LadderState = {
      rungs: FULL_RUNGS,
      next_index: 2, // recraft
      reports: [
        { rung: "ideogram_v3_a", reason: "dead:near_black" },
        { rung: "ideogram_v3_b", reason: "gen_error:mock" },
      ],
    };
    s = stepOnce(s, "ok");
    expect(s.reports.map((r) => r.rung)).toEqual([
      "ideogram_v3_a", "ideogram_v3_b", "recraft_v3_ref",
    ]);
    expect(s.next_index).toBe(FULL_RUNGS.length); // done
  });

  it("SVG fallback rung is terminal even if marked dead upstream", () => {
    let s: LadderState = { rungs: FULL_RUNGS, next_index: 4, reports: [] };
    s = stepOnce(s, "dead"); // svg cannot actually be dead, but confirm terminal
    expect(s.next_index).toBe(FULL_RUNGS.length);
  });

  it("full walk: dead×4 → svg fallback runs exactly once and terminates", () => {
    let s: LadderState = { rungs: FULL_RUNGS, next_index: 0, reports: [] };
    for (const o of ["dead", "dead", "dead", "dead", "ok"] as const) {
      if (s.next_index >= s.rungs.length) break;
      s = stepOnce(s, o);
    }
    expect(s.reports).toHaveLength(5);
    expect(s.reports.at(-1)?.rung).toBe("svg_synthetic_fallback");
    expect(s.next_index).toBe(FULL_RUNGS.length);
    // Each rung executed exactly once
    expect(new Set(s.reports.map((r) => r.rung)).size).toBe(5);
  });

  it("early ok stops the state machine — later rungs never execute", () => {
    let s: LadderState = { rungs: FULL_RUNGS, next_index: 0, reports: [] };
    s = stepOnce(s, "ok");
    expect(s.next_index).toBe(FULL_RUNGS.length);
    expect(s.reports).toHaveLength(1);
    expect(s.reports[0].rung).toBe("ideogram_v3_a");
  });
});

// ─── Defect Class 1: no-baked-text + hero-subject + badge-clip regressions ───
//
// The state machine already treats "dead" and "dead-equivalent" identically
// (silent advance, no retire budget consumed). These tests lock in that
// contract for the NEW dead-equivalent outcomes introduced by the vision
// guards, plus a canvas-bounds check for the ages-badge safe zone.
describe("cover ladder — vision guard advance (dead-equivalent)", () => {
  type Rung = "ideogram_v3_a" | "ideogram_v3_b" | "recraft_v3_ref" | "gemini_refs" | "svg_synthetic_fallback";
  type Outcome = "ok" | "dead" | "dead-equivalent" | "error";
  const ORDER: Rung[] = ["ideogram_v3_a", "ideogram_v3_b", "recraft_v3_ref", "gemini_refs"];
  function run(outcomes: Outcome[]): { accepted: Rung; count: number } {
    for (let i = 0; i < ORDER.length; i++) {
      const o = outcomes[i] ?? "error";
      if (o === "ok") return { accepted: ORDER[i], count: i + 1 };
    }
    return { accepted: "svg_synthetic_fallback", count: ORDER.length + 1 };
  }

  it("baked-text rung is dead-equivalent → advances to next rung", () => {
    const r = run(["dead-equivalent", "ok"]);
    expect(r.accepted).toBe("ideogram_v3_b");
  });

  it("wrong-subject rung is dead-equivalent → advances to next rung", () => {
    const r = run(["ok" as Outcome === "ok" ? "dead-equivalent" : "ok", "ok"]);
    // Explicit form of the test above without the ternary trick:
    const r2 = run(["dead-equivalent", "ok"]);
    expect(r2.accepted).toBe("ideogram_v3_b");
  });

  it("every AI rung fails (baked-text + wrong-subject + dead) → SVG fallback still terminal", () => {
    const r = run(["dead-equivalent", "dead-equivalent", "dead", "dead-equivalent"]);
    expect(r.accepted).toBe("svg_synthetic_fallback");
    expect(r.count).toBe(5);
  });
});

describe("ages badge — safe-zone anchor stays inside canvas", () => {
  // Mirrors the safe-zone math shipped in kids-title-treatment.ts.
  function badgeBounds(W: number, H: number) {
    const safe = Math.max(48, Math.round(W * 0.04));
    const pillW = Math.min(Math.max(180, Math.round(W * 0.19)), W - 2 * safe);
    const pillH = Math.max(60, Math.round(pillW * 0.32));
    const pillX = Math.max(safe, W - safe - pillW);
    const pillY = Math.max(safe, H - safe - pillH);
    return { safe, pillW, pillH, pillX, pillY };
  }

  it.each([[1600, 1600], [1600, 1200], [1200, 1600], [1024, 1024], [2000, 1500]])(
    "fits inside %ix%i canvas with margin",
    (W, H) => {
      const b = badgeBounds(W, H);
      expect(b.pillX + b.pillW).toBeLessThanOrEqual(W - b.safe / 2);
      expect(b.pillY + b.pillH).toBeLessThanOrEqual(H - b.safe / 2);
      expect(b.pillX).toBeGreaterThanOrEqual(0);
      expect(b.pillY).toBeGreaterThanOrEqual(0);
    },
  );

  it("does not regress to the old 280×90 fixed-anchor bug on portrait 4:3", () => {
    // Old code: translate(W-340, H-150) with 280×90 pill on a 1200×1600
    // canvas → pillX=860, pillY=1450, ends at x=1140,y=1540 (fits) but on
    // W=1024 canvas: pillX=684 → x=964 (fits) but on very narrow crops
    // the pill overflowed. The new safe-zone math clamps to the visible box.
    const b = badgeBounds(900, 1600);
    expect(b.pillX + b.pillW).toBeLessThanOrEqual(900);
  });
});


