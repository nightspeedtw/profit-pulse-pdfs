// Deploy-time invariant suite — the immune system's grep-based half.
//
// These checks encode defect CLASSES we've already burned on. A violating
// edit should fail CI here, not at 2am in production. New defect classes
// discovered in future must register a check here as part of the fix
// (see .lovable/immune-system-doctrine.md).

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const FN_ROOT = join(REPO_ROOT, "supabase", "functions");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const EDGE_FILES = (() => {
  try { return walk(FN_ROOT); } catch { return []; }
})();

function read(p: string): string {
  try { return readFileSync(p, "utf8"); } catch { return ""; }
}

describe("immune-system invariants", () => {
  it("has edge functions to scan", () => {
    expect(EDGE_FILES.length).toBeGreaterThan(0);
  });

  // provider_monoculture — book-critical image paths must go through the
  // failover helper, not hardcoded fal / runware / cloudflare direct fetches.
  it("no book-critical file bypasses generateImageWithFailover for image gen", () => {
    const bookCritical = EDGE_FILES.filter(p =>
      /coloring-book-(render|cover|thumbnail)/.test(p) ||
      /kids-interior/.test(p));
    const offenders: string[] = [];
    for (const p of bookCritical) {
      const src = read(p);
      // Hardcoded provider endpoints without the failover helper nearby.
      const usesFailover = /generateImageWithFailover|generateWithFailover/.test(src);
      const hardcoded =
        /fal\.run\/fal-ai\//.test(src) ||
        /api\.runware\.ai\/v1/.test(src) ||
        /api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/ai\/run/.test(src);
      if (hardcoded && !usesFailover) offenders.push(relative(REPO_ROOT, p));
    }
    expect(offenders, `provider_monoculture: hardcoded provider call without failover in:\n${offenders.join("\n")}`).toEqual([]);
  });

  // resource_limit — never JSON.stringify a full BigInt payload; never
  // decode full-resolution images synchronously in an edge function.
  it("no BigInt values crossing JSON boundaries in edge functions", () => {
    const offenders: string[] = [];
    for (const p of EDGE_FILES) {
      const src = read(p);
      // BigInt literal used inside a JSON payload construction.
      if (/BigInt\s*\(/.test(src) && /JSON\.stringify/.test(src)) {
        // Allow if payload-guard is imported (sanitizer present).
        if (!/payload-guard|sanitizeForJson|safeStringify/.test(src)) {
          offenders.push(relative(REPO_ROOT, p));
        }
      }
    }
    expect(offenders, `resource_limit: BigInt reaches JSON.stringify without sanitizer:\n${offenders.join("\n")}`).toEqual([]);
  });

  // ceiling_without_consequence — any file that INCREMENTS an attempt
  // counter must also reference the ceiling constant OR call a park/block
  // helper. If it only ++'s and never checks, that's a leak.
  it("every attempt-counter increment has a ceiling check in the same file", () => {
    const offenders: string[] = [];
    const counterPattern = /(coloring_(cover|interior)_invocations|stall_auto_requeued_count)/g;
    for (const p of EDGE_FILES) {
      const src = read(p);
      const matches = [...src.matchAll(counterPattern)];
      if (matches.length === 0) continue;
      // If the file writes the counter (upsert/patchMeta near it), require
      // a ceiling comparison OR a park helper reference.
      const writesCounter = /(patchMeta|metadata:\s*\{|upsert\(|update\()/.test(src)
        && /invocations|requeued_count/.test(src);
      if (!writesCounter) continue;
      const hasCeiling =
        /MAX_(COVER|INTERIOR)_INVOCATIONS|AUTO_REQUEUE_CEILING|>=?\s*\d+/.test(src) &&
        /(markCoverBlocked|human_review|park|shelve|retired|blocker_reason)/.test(src);
      if (!hasCeiling) offenders.push(relative(REPO_ROOT, p));
    }
    expect(offenders, `ceiling_without_consequence: counter written but no ceiling+park in:\n${offenders.join("\n")}`).toEqual([]);
  });

  // persistence_contract — health-monitor's heartbeat reader path.
  it("worker-tick writes last_worker_tick_at that health-monitor reads", () => {
    const worker = read(join(FN_ROOT, "coloring-worker-tick", "index.ts"));
    const monitor = read(join(FN_ROOT, "health-monitor", "index.ts"));
    expect(worker.includes("last_worker_tick_at"),
      "coloring-worker-tick must write last_worker_tick_at (reader: health-monitor)").toBe(true);
    expect(monitor.includes("last_worker_tick_at"),
      "health-monitor must read last_worker_tick_at (writer: coloring-worker-tick)").toBe(true);
  });

  // state_nobody_owns — every pipeline_status literal used in code that
  // isn't terminal must appear in either a dispatcher .in([...]) call or
  // a watchdog handler somewhere. Baselined orphans below are legacy
  // adult-ebook statuses documented in nightly-self-audit; any NEW orphan
  // fails CI. Do NOT extend BASELINE_ORPHANS — instead add a dispatcher.
  it("no NEW non-terminal pipeline_status literal without a dispatcher claim", () => {
    const TERMINAL = new Set([
      "published","live","retired","cancelled","rejected","parked_rotated",
      "human_review_required","failed","passed","ready_to_publish","shelved",
      "unknown","not_found","idea","concept_preflight","illustrating","rendering",
    ]);
    // Legacy adult-ebook statuses observed 2026-07-18 with no active
    // dispatcher — flagged separately by nightly-self-audit's runtime scan
    // if books actually land in them. Frozen baseline.
    const BASELINE_ORPHANS = new Set([
      "writing","ideation","final_qc","chapter_qc","outline_generation",
      "story_generation","qc_pending","awaiting_publish","awaiting_render",
    ]);
    const literalRe = /pipeline_status[^a-zA-Z_].{0,60}?['"]([a-z_]{3,30})['"]/g;
    const seen = new Set<string>();
    const claimed = new Set<string>();
    for (const p of EDGE_FILES) {
      const src = read(p);
      for (const m of src.matchAll(literalRe)) seen.add(m[1]);
      for (const m of src.matchAll(/\.in\(\s*['"]pipeline_status['"]\s*,\s*\[([^\]]+)\]/g)) {
        for (const lit of m[1].matchAll(/['"]([a-z_]+)['"]/g)) claimed.add(lit[1]);
      }
      for (const m of src.matchAll(/\.eq\(\s*['"]pipeline_status['"]\s*,\s*['"]([a-z_]+)['"]/g)) {
        claimed.add(m[1]);
      }
    }
    const newOrphans = [...seen].filter(s =>
      !TERMINAL.has(s) && !claimed.has(s) && !BASELINE_ORPHANS.has(s));
    expect(newOrphans, `state_nobody_owns: NEW non-terminal pipeline_status literal without dispatcher claim: ${newOrphans.join(", ")}. Either add a dispatcher .in()/.eq() for it, or mark the state terminal.`).toEqual([]);
  });

  it("post-story art stages must re-read stored story_gate.passed", () => {
    const pipeline = read(join(FN_ROOT, "autopilot-kids-pipeline", "index.ts"));
    const renderer = read(join(FN_ROOT, "kids-render-interior", "index.ts"));
    const supervisor = read(join(FN_ROOT, "kids-repair-supervisor", "index.ts"));

    expect(pipeline).toContain("readAndAssertStoredStoryGatePassed");
    expect(pipeline).toContain("POST_STORY_GATE_STEPS");
    expect(pipeline).toContain("ctx.ebook = await readAndAssertStoredStoryGatePassed(db, ctx.ebookId, 'generate_cover')");
    expect(pipeline).toContain("ctx.ebook = await readAndAssertStoredStoryGatePassed(db, ctx.ebookId, 'generate_interior')");
    expect(pipeline).not.toMatch(/generateManuscript[\s\S]{0,2500}pipeline_status:\s*['"]illustrating['"]/);

    expect(renderer).toContain("assertStoredStoryGatePassedBeforeRender");
    expect(renderer.indexOf("const storyGateTripwire = await assertStoredStoryGatePassedBeforeRender(db, ebookId)")).toBeLessThan(renderer.indexOf("if (body.chained)"));
    expect(supervisor).toContain("free_resume_story_gate_tripwire");
  });

  it("concept preflight mechanically bans possessive quirk clone templates", () => {
    const preflight = read(join(FN_ROOT, "kids-concept-preflight", "index.ts"));
    expect(preflight).toContain("detectPossessiveQuirkTemplateHits");
    expect(preflight).toContain("possessive_quirk_reduplicated_template");
    expect(preflight).toContain("Name's Rumble-Roar X");
  });
});
