// Quota-aware pacer for coloring interior generation.
//
// Cloudflare Workers AI free tier gives ~10,000 "neurons" per UTC day.
// One flux-1-schnell image at num_steps=4 ≈ ~10-14 neurons depending on
// prompt length. If we fire a full 32-page batch per book across 3 books
// in one tick, we can burn through the whole daily pool inside a minute
// and the lane collapses.
//
// This module keeps track of "how many CF-provider images have we already
// rendered today" (via cost_log rows tagged provider='cloudflare_direct')
// and caps the per-tick batch so we stay within a configurable safe
// budget. When no CF budget remains, callers should either:
//   a) route this tick to FAL (if FAL is healthy), or
//   b) park the book in `awaiting_quota_reset` with next_retry_at = next
//      UTC midnight (the exact instant CF's neuron pool resets).
//
// Config lives in generation_settings.coloring_autopilot.interior_pacing:
//   {
//     cf_daily_image_budget: 800,   // safe count under 10k neurons
//     safety_reserve_pct: 5,        // leave a headroom so we never hit hard-429
//   }
// Defaults below are conservative for the free tier.

// deno-lint-ignore-file no-explicit-any

export interface InteriorPacingConfig {
  cf_daily_image_budget: number;
  safety_reserve_pct: number;
}

export const DEFAULT_INTERIOR_PACING: InteriorPacingConfig = {
  // ~10k neurons / ~12 neurons per image ≈ 833 images; be conservative.
  cf_daily_image_budget: 750,
  safety_reserve_pct: 5,
};

export async function readInteriorPacing(db: any): Promise<InteriorPacingConfig> {
  try {
    const { data } = await db.from("generation_settings")
      .select("coloring_autopilot").eq("id", 1).maybeSingle();
    const cfg = (data?.coloring_autopilot ?? {}) as Record<string, unknown>;
    const p = (cfg.interior_pacing as Partial<InteriorPacingConfig> | undefined) ?? {};
    return {
      cf_daily_image_budget: Number.isFinite(p.cf_daily_image_budget as number)
        ? Number(p.cf_daily_image_budget)
        : DEFAULT_INTERIOR_PACING.cf_daily_image_budget,
      safety_reserve_pct: Number.isFinite(p.safety_reserve_pct as number)
        ? Number(p.safety_reserve_pct)
        : DEFAULT_INTERIOR_PACING.safety_reserve_pct,
    };
  } catch (_e) {
    return DEFAULT_INTERIOR_PACING;
  }
}

/** Count CF interior images already generated today UTC via cost_log. */
export async function cfImagesUsedToday(db: any): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { data } = await db.from("cost_log")
    .select("images")
    .eq("provider", "cloudflare_direct")
    .gte("created_at", start.toISOString());
  let sum = 0;
  for (const r of (data ?? []) as { images: number | string | null }[]) {
    const v = typeof r.images === "string" ? Number(r.images) : (r.images ?? 0);
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}

/**
 * Given a requested batch size, return the maximum number that can be
 * rendered on Cloudflare THIS TICK without breaching the daily budget.
 *
 * Pure function for unit tests; the render function calls the async
 * variant below which reads live counters.
 */
export function clampBatchToCfBudget(
  requestedBatch: number,
  cfg: InteriorPacingConfig,
  usedToday: number,
): number {
  if (!Number.isFinite(requestedBatch) || requestedBatch <= 0) return 0;
  const reserve = Math.max(0, cfg.cf_daily_image_budget * (cfg.safety_reserve_pct / 100));
  const effectiveBudget = Math.max(0, cfg.cf_daily_image_budget - reserve);
  const remaining = Math.max(0, Math.floor(effectiveBudget - usedToday));
  return Math.min(requestedBatch, remaining);
}

export async function maxCfImagesThisTick(db: any, requestedBatch: number): Promise<{
  allowed: number;
  used_today: number;
  cfg: InteriorPacingConfig;
}> {
  const cfg = await readInteriorPacing(db);
  const used = await cfImagesUsedToday(db);
  return { allowed: clampBatchToCfBudget(requestedBatch, cfg, used), used_today: used, cfg };
}
