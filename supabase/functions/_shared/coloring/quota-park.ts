// Provider-quota parking helpers for the coloring lane.
//
// When a book cannot render right now because its available image
// provider(s) are quota-exhausted or billing-locked, we park it in a
// distinct pipeline_status with a scheduled wake time. The coloring
// worker-tick sweeps parked rows whose next_retry_at has arrived and
// whose provider is healthy again, then requeues them.
//
// States (pipeline_status is a free-form text column — these are
// convention-only, no enum change required):
//
//   awaiting_quota_reset  — Cloudflare daily neuron pool exhausted (429
//                           "daily free allocation") and FAL is unavailable
//                           or also blocked. Wake = next 00:00 UTC + jitter.
//                           No human action required.
//
//   awaiting_billing      — FAL 403 "Exhausted balance" and no healthy
//                           fallback available. Wake = +30 min (cheap
//                           re-check; owner may top up any moment).
//                           Requires human top-up at fal.ai/dashboard/billing.

// deno-lint-ignore-file no-explicit-any

export type ColoringParkState = "awaiting_quota_reset" | "awaiting_billing";

export function nextUtcMidnight(from: Date = new Date()): Date {
  return new Date(Date.UTC(
    from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, 0, 0, 0,
  ));
}

/** Wake time for `awaiting_quota_reset`: next UTC midnight + small jitter. */
export function computeQuotaResetWake(from: Date = new Date()): Date {
  const wake = nextUtcMidnight(from);
  // 0-180s jitter so multiple parked books don't stampede at 00:00:00.
  wake.setUTCSeconds(wake.getUTCSeconds() + Math.floor(Math.random() * 180) + 60);
  return wake;
}

/** Wake time for `awaiting_billing`: +30 min. */
export function computeBillingRecheckWake(from: Date = new Date()): Date {
  return new Date(from.getTime() + 30 * 60_000);
}

export interface ProviderHealthSnapshot {
  cf_locked: boolean;      // Cloudflare daily-quota latch active
  fal_locked: boolean;     // FAL per-provider billing_blocked
}

/**
 * Decide which park state fits a provider outage.
 *
 *   - Only CF locked, FAL healthy         → don't park (caller should route to FAL)
 *   - Only FAL locked, CF healthy         → don't park (caller should route to CF)
 *   - CF locked + FAL locked (or unknown) → prefer awaiting_quota_reset when the
 *                                           trigger error was a CF quota; otherwise
 *                                           awaiting_billing.
 *   - FAL locked and no CF configured     → awaiting_billing
 */
export function pickParkState(
  health: ProviderHealthSnapshot,
  triggerErrorMessage: string,
): ColoringParkState {
  const isCfQuota = /daily free allocation|neurons|workers paid|@cf\//i.test(triggerErrorMessage);
  const isFalBilling = /exhausted balance|user is locked|top up your balance|insufficient (funds|credit|balance)/i
    .test(triggerErrorMessage);

  if (isCfQuota && !health.fal_locked) {
    // CF is dry but FAL should be healthy — a call to render is safe.
    // Caller decides not to park in that case; here we still return a
    // best-guess for the DB write (worst-case latch until midnight).
    return "awaiting_quota_reset";
  }
  if (isFalBilling && health.fal_locked && !health.cf_locked) {
    return "awaiting_billing";
  }
  if (health.cf_locked && !health.fal_locked) return "awaiting_billing"; // FAL is our only hope now
  if (!health.cf_locked && health.fal_locked) return "awaiting_quota_reset"; // CF is our only hope now
  // Both dry — CF's daily reset is the deterministic recovery.
  return "awaiting_quota_reset";
}

/**
 * Park a coloring book row. Idempotent — safe to call repeatedly.
 * Preserves the original blocker_reason for audit; sets pipeline_status
 * and next_retry_at.
 */
export async function parkColoringBook(
  db: any,
  ebook_id: string,
  state: ColoringParkState,
  triggerErrorMessage: string,
): Promise<Date> {
  const wake = state === "awaiting_quota_reset"
    ? computeQuotaResetWake()
    : computeBillingRecheckWake();
  const reason = state === "awaiting_quota_reset"
    ? `awaiting_quota_reset: cloudflare daily neuron pool exhausted — auto-resume at ${wake.toISOString()}. Trigger: ${triggerErrorMessage.slice(0, 200)}`
    : `awaiting_billing: fal.ai balance exhausted — top up at fal.ai/dashboard/billing to resume. Re-check at ${wake.toISOString()}. Trigger: ${triggerErrorMessage.slice(0, 200)}`;
  await db.from("ebooks_kids").update({
    pipeline_status: state,
    blocker_reason: reason,
    next_retry_at: wake.toISOString(),
  }).eq("id", ebook_id);
  return wake;
}
