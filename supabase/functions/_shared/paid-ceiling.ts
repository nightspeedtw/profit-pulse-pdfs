// Paid-call ceiling enforcement — THE single choke point for runaway loops.
//
// Every paid provider call (image OR text) MUST await assertPaidCeiling()
// before spending. If a (ebook_id, step) has >= MAX_PAID_CALLS_PER_STEP_24H
// rows in cost_log within the last 24h, we throw BudgetCeilingError. Callers
// catch it, park the book with blocker 'paid_ceiling:<step>', and stop.
//
// Also exposes group ceilings (e.g. "coloring_cover_*" sums across
// ideogram/gpt_image/thumbnail providers) so per-provider retry caps cannot
// be bypassed by hopping providers.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

export const MAX_PAID_CALLS_PER_STEP_24H = 5;
export const MAX_PAID_CALLS_PER_GROUP_24H = 8; // sum across a step-group

export class BudgetCeilingError extends Error {
  code = "paid_ceiling";
  step: string;
  group?: string;
  count: number;
  constructor(step: string, count: number, group?: string) {
    super(`paid_ceiling:${group ?? step} count=${count} exceeds max`);
    this.name = "BudgetCeilingError";
    this.step = step;
    this.group = group;
    this.count = count;
  }
}

// Step-groups for sum-across-providers enforcement.
// Add more here as new fast-paths appear.
export const STEP_GROUPS: Record<string, RegExp> = {
  coloring_cover_any: /^coloring_cover_/,           // ideogram+gpt_image+thumbnail+runware
  coloring_page_any: /^coloring_(production_page|page)_/,
  kids_repair_story_any: /^kids_repair_story_gate/,
};

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/**
 * Throw BudgetCeilingError if the (ebook_id, step) has already exceeded the
 * ceiling in the last 24h. Also checks group ceilings when the step matches
 * a known group pattern.
 *
 * NEVER throws for non-ebook-scoped calls (ebook_id null) — those are audit
 * calls (sweeps, previews) and the guard is only for per-book spending.
 */
export async function assertPaidCeiling(opts: {
  ebook_id?: string | null;
  step: string;
  supabase?: any;
}): Promise<void> {
  const ebook_id = opts.ebook_id ?? null;
  if (!ebook_id) return;
  const sb = opts.supabase ?? db();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  // Per-step count.
  const { count: stepCount } = await sb.from("cost_log")
    .select("id", { count: "exact", head: true })
    .eq("ebook_id", ebook_id).eq("step", opts.step)
    .gte("created_at", since);
  if ((stepCount ?? 0) >= MAX_PAID_CALLS_PER_STEP_24H) {
    throw new BudgetCeilingError(opts.step, stepCount ?? 0);
  }

  // Group count (sum across providers).
  for (const [groupName, pattern] of Object.entries(STEP_GROUPS)) {
    if (!pattern.test(opts.step)) continue;
    const { data } = await sb.from("cost_log")
      .select("step").eq("ebook_id", ebook_id).gte("created_at", since);
    const groupCount = (data ?? []).filter((r: { step: string }) => pattern.test(r.step)).length;
    if (groupCount >= MAX_PAID_CALLS_PER_GROUP_24H) {
      throw new BudgetCeilingError(opts.step, groupCount, groupName);
    }
  }
}

/**
 * Park a book that hit the ceiling. Idempotent. Callers catch
 * BudgetCeilingError and invoke this.
 */
export async function parkOnPaidCeiling(
  ebook_id: string,
  err: BudgetCeilingError,
  supabase?: any,
): Promise<void> {
  const sb = supabase ?? db();
  const reason = `paid_ceiling:${err.group ?? err.step} (count=${err.count}) — auto-parked ${new Date().toISOString()}`;
  await sb.from("ebooks_kids").update({
    pipeline_status: "awaiting_owner",
    blocker_reason: reason,
    next_retry_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
  }).eq("id", ebook_id);
}

/** True if the error is a ceiling error. */
export function isBudgetCeilingError(e: unknown): e is BudgetCeilingError {
  return e instanceof BudgetCeilingError || (typeof e === "object" && e !== null && (e as any).code === "paid_ceiling");
}
