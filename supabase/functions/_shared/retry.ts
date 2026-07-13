// Milestone 10 — production hardening helpers.
// Provides withRetry() and stepLog() utilities used by the autopilot pipeline.

export interface RetryOpts {
  retries?: number;            // total attempts = retries + 1
  delayMs?: number;            // base delay (ms) for exponential backoff
  label?: string;              // log label
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOpts = {},
): Promise<{ value: T; attempts: number }> {
  const retries = Math.max(0, opts.retries ?? 2);
  const baseDelay = opts.delayMs ?? 800;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const value = await fn(attempt);
      return { value, attempts: attempt };
    } catch (err) {
      lastErr = err;
      const more = attempt <= retries;
      const allow = opts.shouldRetry ? opts.shouldRetry(err, attempt) : true;
      console.warn(
        `[retry${opts.label ? ":" + opts.label : ""}] attempt ${attempt} failed:`,
        (err as Error)?.message ?? err,
        more && allow ? "→ retrying" : "→ giving up",
      );
      if (!more || !allow) break;
      await new Promise((r) => setTimeout(r, baseDelay * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Per-step log: writes a row to pipeline_step_logs and returns a finisher.
export interface StepLogger {
  finish: (status: "ok" | "fail" | "skip", extra?: {
    cost_estimate?: number;
    retry_count?: number;
    error_message?: string | null;
    payload?: Record<string, unknown>;
  }) => Promise<void>;
  id: string | null;
}

// deno-lint-ignore no-explicit-any
export async function stepLog(db: any, init: {
  ebook_id?: string | null;
  idea_id?: string | null;
  step_name: string;
  payload?: Record<string, unknown>;
}): Promise<StepLogger> {
  const startedAt = Date.now();
  let id: string | null = null;
  try {
    const { data } = await db.from("pipeline_step_logs").insert({
      ebook_id: init.ebook_id ?? null,
      idea_id: init.idea_id ?? null,
      step_name: init.step_name,
      status: "running",
      payload: init.payload ?? {},
    }).select("id").single();
    id = data?.id ?? null;
  } catch (e) {
    console.error("stepLog insert failed:", (e as Error).message);
  }
  return {
    id,
    finish: async (status, extra = {}) => {
      const completedAt = new Date();
      const duration = Date.now() - startedAt;
      try {
        if (id) {
          await db.from("pipeline_step_logs").update({
            status,
            completed_at: completedAt.toISOString(),
            duration_ms: duration,
            cost_estimate: extra.cost_estimate ?? 0,
            retry_count: extra.retry_count ?? 0,
            error_message: extra.error_message ?? null,
            payload: extra.payload ?? init.payload ?? {},
          }).eq("id", id);
        } else {
          // Fallback: insert a completed row if we never got an id.
          await db.from("pipeline_step_logs").insert({
            ebook_id: init.ebook_id ?? null,
            idea_id: init.idea_id ?? null,
            step_name: init.step_name,
            status,
            completed_at: completedAt.toISOString(),
            duration_ms: duration,
            cost_estimate: extra.cost_estimate ?? 0,
            retry_count: extra.retry_count ?? 0,
            error_message: extra.error_message ?? null,
            payload: extra.payload ?? init.payload ?? {},
          });
        }
      } catch (e) {
        console.error("stepLog finish failed:", (e as Error).message);
      }
    },
  };
}

// Updates production_queue with a failed-status row tied to this ebook.
// deno-lint-ignore no-explicit-any
export async function markQueueFailed(db: any, ebook_id: string | null | undefined, step: string, error: string) {
  if (!ebook_id) return;
  try {
    const { data: row } = await db.from("production_queue")
      .select("id, attempts").eq("ebook_id", ebook_id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (row) {
      await db.from("production_queue").update({
        last_error: `[${step}] ${error}`.slice(0, 1000),
        attempts: (row.attempts ?? 0) + 1,
        metadata: { failed_step: step, failed_at: new Date().toISOString() },
      }).eq("id", row.id);
    }
  } catch (e) {
    console.error("markQueueFailed:", (e as Error).message);
  }
}

// Cost guard: if today's spend ≥ daily budget, pause autopilot + mark reason.
// deno-lint-ignore no-explicit-any
export async function enforceCostGuard(db: any): Promise<{ tripped: boolean; spent: number; budget: number }> {
  const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).maybeSingle();
  if (!settings) return { tripped: false, spent: 0, budget: 0 };
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { data: dayCosts } = await db.from("cost_log").select("cost_usd").gte("created_at", dayStart.toISOString());
  const spent = (dayCosts ?? []).reduce((s: number, r: { cost_usd: number }) => s + Number(r.cost_usd), 0);
  const budget = Number(settings.daily_budget_usd ?? 5);
  if (spent >= budget) {
    await db.from("generation_settings").update({
      paused: true,
      cost_limit_reached: true,
      cost_limit_reached_at: new Date().toISOString(),
      cost_limit_reason: `Daily budget exceeded ($${spent.toFixed(2)} ≥ $${budget.toFixed(2)})`,
    }).eq("id", 1);
    return { tripped: true, spent, budget };
  }
  return { tripped: false, spent, budget };
}

// Returns retry budget for a given step kind.
export function retriesFor(step: string): number {
  if (step.includes("publish")) return 3;
  if (step.includes("pdf") || step.includes("render")) return 2;
  if (step.includes("cover") || step.includes("image")) return 1; // image gen: retry once
  return 2; // default = AI calls
}
