// _shared/coloring/self-advance.ts
//
// Conveyor throughput fix: after any stage that leaves a book still in
// 'queued' with more work to do, schedule a background self-advance instead
// of parking until the next cron tick.
//
// Contract:
//   * Never awaited by the stage handler — always waitUntil (or a fire-and-
//     forget promise) so the HTTP response returns immediately.
//   * Increments a sliding-hour counter (`coloring_self_advance_window`) in
//     ebooks_kids.metadata; refuses to schedule when the cap is exceeded so
//     a runaway loop can't burn tokens.
//   * Lane-blocked reasons (billing/verifier/budget) MUST NOT self-advance
//     — the caller decides by passing `{ skip: true }` or simply not calling
//     this at all. This helper does not re-check lane guards.
//
// Downstream target: coloring-worker-tick with `{ ebook_id }` so the
// dispatcher routes the single row through its normal stage-selection logic
// while still honoring the max_parallel cap and provider guards.

// @ts-nocheck
declare const EdgeRuntime: any;

const SUPABASE_URL = (globalThis as any).Deno?.env?.get?.("SUPABASE_URL");
const SERVICE_KEY = (globalThis as any).Deno?.env?.get?.("SUPABASE_SERVICE_ROLE_KEY");

export const SELF_ADVANCE_DEFAULT_HOURLY_CAP = 20;
export const SELF_ADVANCE_DELAY_SUCCESS_MS = 5_000;
export const SELF_ADVANCE_DELAY_BACKOFF_MS = 30_000;

export interface SelfAdvanceOpts {
  delayMs?: number;
  reason?: string;
  hourlyCap?: number;
  // Optional injected fetch for tests.
  fetchImpl?: typeof fetch;
  // Optional url/key overrides for tests.
  url?: string;
  serviceKey?: string;
}

export interface SelfAdvanceWindow {
  window_start: string; // ISO
  count: number;
}

export function tickWindow(
  prev: SelfAdvanceWindow | undefined,
  now: Date,
  hourlyCap: number,
): { window: SelfAdvanceWindow; allowed: boolean; reason?: string } {
  const windowStart = prev?.window_start ? new Date(prev.window_start) : null;
  const stillInside = windowStart && now.getTime() - windowStart.getTime() < 3_600_000;
  const base = stillInside
    ? { window_start: windowStart!.toISOString(), count: prev!.count }
    : { window_start: now.toISOString(), count: 0 };
  if (base.count >= hourlyCap) {
    return { window: base, allowed: false, reason: `self_advance_hourly_cap:${hourlyCap}` };
  }
  return { window: { ...base, count: base.count + 1 }, allowed: true };
}

async function bumpCounter(
  db: any,
  ebookId: string,
  hourlyCap: number,
): Promise<{ allowed: boolean; reason?: string }> {
  const { data } = await db.from("ebooks_kids").select("metadata").eq("id", ebookId).maybeSingle();
  const meta = (data?.metadata ?? {}) as Record<string, unknown>;
  const prev = meta.coloring_self_advance_window as SelfAdvanceWindow | undefined;
  const { window, allowed, reason } = tickWindow(prev, new Date(), hourlyCap);
  const merged = { ...meta, coloring_self_advance_window: window };
  await db.from("ebooks_kids").update({ metadata: merged }).eq("id", ebookId);
  return { allowed, reason };
}

/**
 * Schedule a background self-advance. Returns synchronously; the actual
 * POST happens after `delayMs` via EdgeRuntime.waitUntil (or a detached
 * promise in test environments).
 */
export async function scheduleSelfAdvance(
  db: any,
  ebookId: string,
  opts: SelfAdvanceOpts = {},
): Promise<{ scheduled: boolean; reason?: string }> {
  const cap = opts.hourlyCap ?? SELF_ADVANCE_DEFAULT_HOURLY_CAP;
  const delayMs = Math.max(0, opts.delayMs ?? SELF_ADVANCE_DELAY_SUCCESS_MS);
  const url = opts.url ?? SUPABASE_URL;
  const key = opts.serviceKey ?? SERVICE_KEY;
  const doFetch = opts.fetchImpl ?? fetch;

  const gate = await bumpCounter(db, ebookId, cap).catch((e) => ({
    allowed: false, reason: `counter_error:${(e as Error).message}`,
  }));
  if (!gate.allowed) return { scheduled: false, reason: gate.reason };

  if (!url || !key) return { scheduled: false, reason: "missing_env" };

  const task = async () => {
    try {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      // Fire-and-forget: 3s HTTP timeout is treated as "dispatched" — the
      // downstream function does its own waitUntil-style work.
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 3_000);
      try {
        await doFetch(`${url}/functions/v1/coloring-worker-tick`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
          body: JSON.stringify({ ebook_id: ebookId, self_advance: true, reason: opts.reason ?? null }),
          signal: ac.signal,
        });
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          console.warn(`[self-advance] fetch error for ${ebookId}:`, e?.message ?? String(e));
        }
      } finally {
        clearTimeout(t);
      }
    } catch (e) {
      console.warn(`[self-advance] task error for ${ebookId}:`, (e as Error).message);
    }
  };

  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    EdgeRuntime.waitUntil(task());
  } else {
    // Detached — swallow rejections so no unhandled promise crashes the isolate.
    task().catch(() => {});
  }
  return { scheduled: true };
}

/**
 * Fire-and-forget POST used by dispatchers (worker-tick) that must not
 * await the invoked function's full response. Returns after `timeoutMs`
 * (default 3s) or when the request completes, whichever comes first.
 */
export async function fireAndForgetPost(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 3_000,
  fetchImpl: typeof fetch = fetch,
): Promise<{ dispatched: boolean; status?: number; error?: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    return { dispatched: true, status: r.status };
  } catch (e: any) {
    if (e?.name === "AbortError") return { dispatched: true, error: "timeout_treated_as_dispatched" };
    return { dispatched: false, error: e?.message ?? String(e) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * True detached POST for dispatchers whose HTTP response must return
 * immediately. The request is kept alive with EdgeRuntime.waitUntil; a short
 * abort only protects the background task from hanging forever and does not
 * make the caller wait.
 */
export function dispatchPostNoWait(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 1_000,
  fetchImpl: typeof fetch = fetch,
): { dispatched: boolean; status?: number; error?: string } {
  const task = async () => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        console.warn(`[dispatchPostNoWait] fetch error:`, e?.message ?? String(e));
      }
    } finally {
      clearTimeout(t);
    }
  };
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    EdgeRuntime.waitUntil(task());
  } else {
    task().catch(() => {});
  }
  return { dispatched: true, status: 202 };
}
