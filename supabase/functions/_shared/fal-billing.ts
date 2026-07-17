// Per-provider image billing/lock/quota classifier + lane-level guards.
//
// PERMANENT CLASS FIX (v2 — per-provider latch): provider 4xx billing/lock
// responses (fal 403 "Exhausted balance", 402, 429 "quota", "user is
// locked", Cloudflare 4006/quota) are PROVIDER-STATE errors and must
// never burn page repair attempts or freeze the whole lane when another
// healthy provider exists.
//
// v1 stored ONE lane-wide `billing_blocked` bool. That was wrong once
// interiors ran on multi-provider failover: a fal 403 froze the whole
// lane even though Cloudflare was healthy and configured as primary.
//
// v2 stores per-provider state under
//   generation_settings.coloring_autopilot.provider_billing_blocked = {
//     fal: { active, status, provider_message, at, cleared_at? },
//     cloudflare: { ... },
//   }
// Lane dispatch checks now consult ONLY the daily budget cap. Per-request
// provider selection is handled by the failover dispatcher in
// image-providers.ts (skips locked providers, keeps healthy ones).
// Legacy `billing_blocked` is still mirrored to the FAL slot so older
// readers keep working.

export class FalBillingLockedError extends Error {
  readonly kind = "provider_billing_locked" as const;
  readonly family = "temporary_provider_error" as const;
  readonly status: number;
  readonly provider_message: string;
  constructor(status: number, providerMessage: string) {
    super(`provider_billing_locked (${status}): ${providerMessage.slice(0, 240)}`);
    this.status = status;
    this.provider_message = providerMessage;
  }
}

export class FalBudgetCapReachedError extends Error {
  readonly kind = "fal_budget_cap_reached" as const;
  readonly family = "recoverable_quota_error" as const;
  readonly spent_usd: number;
  readonly cap_usd: number;
  constructor(spent: number, cap: number) {
    super(`fal_budget_cap_reached: $${spent.toFixed(4)} of $${cap.toFixed(2)} daily cap`);
    this.spent_usd = spent;
    this.cap_usd = cap;
  }
}

const BILLING_PATTERNS: RegExp[] = [
  /exhausted balance/i,
  /insufficient (funds|balance|credit)/i,
  /balance.*(is )?(too low|exhaust|zero)/i,
  /payment required/i,
  /user is locked/i,
  /account.*(locked|suspended|disabled)/i,
  /billing/i,
  /top.?up/i,
  // Cloudflare Workers AI free-pool exhaustion wording:
  /daily free allocation/i,
  /neurons/i,
  /workers paid/i,
  /free (tier|allowance|allocation)/i,
];

const QUOTA_PATTERNS: RegExp[] = [
  /quota/i,
  /rate.?limit/i,
  /too many requests/i,
  /daily.*allocation/i,
];

/** Return true iff this Fal response should be treated as provider_billing_locked. */
export function isFalBillingLocked(status: number, body: string): boolean {
  if (status === 402) return true;
  if (status === 403 && BILLING_PATTERNS.some((r) => r.test(body))) return true;
  if (status === 401 && /locked|suspend/i.test(body)) return true;
  if (status === 429 && (BILLING_PATTERNS.some((r) => r.test(body)) || QUOTA_PATTERNS.some((r) => r.test(body)))) {
    // 429 quota that mentions balance/lock counts as billing; plain rate-limits
    // stay in the transient bucket and are retried elsewhere.
    return BILLING_PATTERNS.some((r) => r.test(body));
  }
  return false;
}

export const DEFAULT_FAL_DAILY_BUDGET_USD = 5;

export interface BillingBlockedState {
  active: boolean;
  provider_message?: string;
  status?: number;
  at?: string;
  cleared_at?: string;
}

export interface BudgetCapState {
  reached: boolean;
  spent_usd?: number;
  cap_usd?: number;
  day_utc?: string;
  at?: string;
}

export type ProviderKey = "fal" | "cloudflare" | "runware";

export interface ProviderBillingBlockedMap {
  fal?: BillingBlockedState;
  cloudflare?: BillingBlockedState;
  runware?: BillingBlockedState;
}

/** Read generation_settings.coloring_autopilot for a fast dispatch-time guard. */
export async function readLaneGuards(db: any): Promise<{
  billing_blocked: BillingBlockedState;                 // legacy (== fal)
  provider_billing_blocked: ProviderBillingBlockedMap;  // v2, per-provider
  budget_cap: BudgetCapState;
  cfg: Record<string, unknown>;
}> {
  const { data } = await db.from("generation_settings")
    .select("coloring_autopilot").eq("id", 1).maybeSingle();
  const cfg = (data?.coloring_autopilot ?? {}) as Record<string, unknown>;
  const provider_billing_blocked = (cfg.provider_billing_blocked as ProviderBillingBlockedMap | undefined) ?? {};
  // Legacy slot mirrors the FAL entry so older readers keep working.
  const legacy = (cfg.billing_blocked as BillingBlockedState | undefined) ?? { active: false };
  const fal = provider_billing_blocked.fal ?? legacy;
  const merged: ProviderBillingBlockedMap = {
    fal,
    cloudflare: provider_billing_blocked.cloudflare ?? { active: false },
    runware: provider_billing_blocked.runware ?? { active: false },
  };
  const budget_cap = (cfg.fal_budget_cap as BudgetCapState | undefined) ?? { reached: false };
  return { billing_blocked: fal, provider_billing_blocked: merged, budget_cap, cfg };
}

/** Merge-write coloring_autopilot without clobbering unrelated keys. */
export async function patchLaneCfg(db: any, patch: Record<string, unknown>): Promise<void> {
  const { data } = await db.from("generation_settings")
    .select("coloring_autopilot").eq("id", 1).maybeSingle();
  const merged = { ...(data?.coloring_autopilot ?? {}), ...patch };
  await db.from("generation_settings").update({ coloring_autopilot: merged }).eq("id", 1);
}

export async function markProviderBillingBlocked(
  db: any, provider: ProviderKey, err: FalBillingLockedError,
): Promise<void> {
  const { provider_billing_blocked } = await readLaneGuards(db);
  const next: ProviderBillingBlockedMap = {
    ...provider_billing_blocked,
    [provider]: {
      active: true,
      status: err.status,
      provider_message: err.provider_message.slice(0, 400),
      at: new Date().toISOString(),
    } as BillingBlockedState,
  };
  const patch: Record<string, unknown> = { provider_billing_blocked: next };
  // Mirror to legacy slot for fal so older readers still see it.
  if (provider === "fal") patch.billing_blocked = next.fal;
  await patchLaneCfg(db, patch);
}

export async function clearProviderBillingBlocked(db: any, provider: ProviderKey): Promise<void> {
  const { provider_billing_blocked } = await readLaneGuards(db);
  const next: ProviderBillingBlockedMap = {
    ...provider_billing_blocked,
    [provider]: { active: false, cleared_at: new Date().toISOString() } as BillingBlockedState,
  };
  const patch: Record<string, unknown> = { provider_billing_blocked: next };
  if (provider === "fal") patch.billing_blocked = next.fal;
  await patchLaneCfg(db, patch);
}

// Legacy aliases — FAL-specific, retained so existing callers compile.
export const markBillingBlocked = (db: any, err: FalBillingLockedError) =>
  markProviderBillingBlocked(db, "fal", err);
export const clearBillingBlocked = (db: any) =>
  clearProviderBillingBlocked(db, "fal");

/** Sum today's fal_direct spend from cost_log (UTC day). */
export async function sumFalSpendToday(db: any): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { data } = await db.from("cost_log")
    .select("cost_usd")
    .eq("provider", "fal_direct")
    .gte("created_at", start.toISOString());
  let sum = 0;
  for (const r of (data ?? []) as { cost_usd: number | string | null }[]) {
    const v = typeof r.cost_usd === "string" ? Number(r.cost_usd) : (r.cost_usd ?? 0);
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}

/**
 * Dispatch-time guard for the coloring lane.
 *
 * v2: per-provider billing blocks NO LONGER halt dispatch — the failover
 * dispatcher in image-providers.ts skips a locked provider and uses the
 * next healthy one. This guard now only enforces the daily FAL BUDGET CAP
 * (a spend-side safety, not a provider-state signal) so an accidental
 * runaway can't drain the account.
 */
export async function assertLaneCanDispatch(db: any): Promise<void> {
  const { cfg } = await readLaneGuards(db);
  const cap = Number((cfg.fal_daily_budget_usd as number | undefined) ?? DEFAULT_FAL_DAILY_BUDGET_USD);
  if (cap > 0) {
    const spent = await sumFalSpendToday(db);
    if (spent >= cap) {
      await patchLaneCfg(db, {
        fal_budget_cap: {
          reached: true, spent_usd: spent, cap_usd: cap,
          day_utc: new Date().toISOString().slice(0, 10),
          at: new Date().toISOString(),
        } as BudgetCapState,
      });
      throw new FalBudgetCapReachedError(spent, cap);
    }
  }
}
