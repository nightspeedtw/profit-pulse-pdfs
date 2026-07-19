// Owner doctrine "quality_at_the_source" — plan-time prevention.
//
// Given a page-plan entry (subject, scene_bucket), consult
// v_subject_scene_provider_fpy. If historical first-pass yield is < 60%
// with a meaningful sample size (>= 5 attempts), swap the bucket to the
// subject's highest-FPY bucket BEFORE any money is spent. Combos we swap
// out are recorded in practice_backlog so they get worked on offline,
// not on a customer's book.
//
// Missing data (subject never rendered before) is NEVER a defect — new
// combos are allowed through by default so the ledger can learn.

import type { SceneBucket } from "./page-plan.ts";
import { SCENE_TAXONOMY } from "./page-plan.ts";

export const FPY_FLOOR_PCT = 60;
export const FPY_MIN_SAMPLE = 5;

interface FpyRow {
  subject_key: string;
  scene_bucket: string;
  provider: string;
  attempts: number;
  passes: number;
  fpy_pct: number | null;
}

// deno-lint-ignore no-explicit-any
export async function loadFpyRows(db: any, call_class = "coloring_interior"): Promise<FpyRow[]> {
  try {
    const { data } = await db
      .from("v_subject_scene_provider_fpy")
      .select("subject_key,scene_bucket,provider,attempts,passes,fpy_pct")
      .eq("call_class", call_class);
    return Array.isArray(data) ? data as FpyRow[] : [];
  } catch (_e) {
    return [];
  }
}

/** Aggregate provider dimension: subject × bucket → weighted fpy across providers. */
function aggregateBySubjectBucket(rows: FpyRow[]): Map<string, { attempts: number; passes: number; fpy: number }> {
  const m = new Map<string, { attempts: number; passes: number; fpy: number }>();
  for (const r of rows) {
    const k = `${r.subject_key}|${r.scene_bucket}`;
    const cur = m.get(k) ?? { attempts: 0, passes: 0, fpy: 0 };
    cur.attempts += r.attempts ?? 0;
    cur.passes += r.passes ?? 0;
    m.set(k, cur);
  }
  for (const [k, v] of m) {
    v.fpy = v.attempts > 0 ? (100 * v.passes) / v.attempts : 0;
    m.set(k, v);
  }
  return m;
}

export interface BucketSwap {
  page: number;
  subject: string;
  from_bucket: SceneBucket;
  to_bucket: SceneBucket;
  reason: string;
  fpy_pct: number;
  sample_size: number;
}

/**
 * Post-process a generated page plan: for any entry whose (subject,bucket)
 * historical FPY is below the floor, swap to the highest-FPY bucket for
 * that subject. Returns the mutated plan and the list of swaps applied.
 * If no viable alternative exists, the entry is left as-is (the render
 * still happens; the ledger will collect fresh signal).
 */
// deno-lint-ignore no-explicit-any
export async function applyFpyPlanSwaps<TEntry extends { canonical_page_number: number; primary_subject: string; scene_bucket?: string }>(
  plan: TEntry[],
  db: any,
  call_class = "coloring_interior",
): Promise<{ plan: TEntry[]; swaps: BucketSwap[] }> {
  const rows = await loadFpyRows(db, call_class);
  if (rows.length === 0) return { plan, swaps: [] };
  const agg = aggregateBySubjectBucket(rows);

  const swaps: BucketSwap[] = [];
  const backlogRows: Array<Record<string, unknown>> = [];

  for (const entry of plan) {
    const subjKey = (entry.primary_subject ?? "").toLowerCase();
    const bucket = (entry.scene_bucket ?? "") as SceneBucket;
    if (!subjKey || !bucket) continue;
    const stat = agg.get(`${subjKey}|${bucket}`);
    if (!stat || stat.attempts < FPY_MIN_SAMPLE) continue;
    if (stat.fpy >= FPY_FLOOR_PCT) continue;

    // Find best alternative bucket for this subject with sample_size ≥ FPY_MIN_SAMPLE
    let best: { bucket: SceneBucket; fpy: number; attempts: number } | null = null;
    for (const b of SCENE_TAXONOMY) {
      if (b === bucket) continue;
      const s = agg.get(`${subjKey}|${b}`);
      if (!s || s.attempts < FPY_MIN_SAMPLE) continue;
      if (s.fpy < FPY_FLOOR_PCT) continue;
      if (!best || s.fpy > best.fpy) best = { bucket: b, fpy: s.fpy, attempts: s.attempts };
    }
    if (!best) continue;

    swaps.push({
      page: entry.canonical_page_number,
      subject: entry.primary_subject,
      from_bucket: bucket,
      to_bucket: best.bucket,
      reason: "plan_time_fpy_swap",
      fpy_pct: Math.round(stat.fpy * 10) / 10,
      sample_size: stat.attempts,
    });
    backlogRows.push({
      subject: subjKey,
      scene_bucket: bucket,
      provider: null,
      fpy_pct: Math.round(stat.fpy * 10) / 10,
      sample_size: stat.attempts,
      reason: `swapped_out_at_plan (best=${best.bucket} @ ${Math.round(best.fpy)}%)`,
      status: "parked",
    });

    // Apply swap (bucket only; the caller is responsible for regenerating
    // the scene sentence to match the new bucket, or the renderer treats
    // the primary_subject as authoritative and the bucket as a hint).
    (entry as { scene_bucket?: string }).scene_bucket = best.bucket;
  }

  if (backlogRows.length) {
    try {
      // Upsert with best-effort; unique(subject, scene_bucket, provider)
      await db.from("practice_backlog").upsert(backlogRows, {
        onConflict: "subject,scene_bucket,provider",
        ignoreDuplicates: false,
      });
    } catch (_e) { /* best-effort */ }
  }

  return { plan, swaps };
}

/**
 * Provider routing by measured FPY. Returns providers ordered
 * highest-FPY-first for a call class, keeping providers with < min_sample
 * attempts at the tail (unknown quality, still worth trying).
 */
// deno-lint-ignore no-explicit-any
export async function providerOrderByFpy(db: any, call_class: string): Promise<string[]> {
  try {
    const { data } = await db
      .from("v_call_class_provider_fpy")
      .select("provider,attempts,fpy_pct")
      .eq("call_class", call_class);
    const rows = Array.isArray(data) ? data as Array<{ provider: string; attempts: number; fpy_pct: number | null }> : [];
    const ranked = rows
      .map((r) => ({ provider: r.provider, attempts: r.attempts ?? 0, fpy: r.fpy_pct ?? 0 }))
      .sort((a, b) => {
        const aHas = a.attempts >= FPY_MIN_SAMPLE ? 1 : 0;
        const bHas = b.attempts >= FPY_MIN_SAMPLE ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        return b.fpy - a.fpy;
      });
    return ranked.map((r) => r.provider);
  } catch (_e) {
    return [];
  }
}

/** Record a first-pass outcome for one page. Never throws. */
// deno-lint-ignore no-explicit-any
export async function logPageFpyEvent(db: any, row: {
  book_id: string;
  page_number?: number | null;
  call_class?: string;
  subject?: string | null;
  scene_bucket?: string | null;
  provider: string;
  passed_first: boolean;
  fail_reasons?: string[] | null;
  style_contract?: string | null;
}): Promise<void> {
  try {
    await db.from("page_fpy_events").insert({
      book_id: row.book_id,
      page_number: row.page_number ?? null,
      call_class: row.call_class ?? "coloring_interior",
      subject: row.subject ?? null,
      scene_bucket: row.scene_bucket ?? null,
      provider: row.provider,
      passed_first: row.passed_first,
      fail_reasons: row.fail_reasons ?? null,
      style_contract: row.style_contract ?? null,
    });
  } catch (_e) { /* best-effort */ }
}
