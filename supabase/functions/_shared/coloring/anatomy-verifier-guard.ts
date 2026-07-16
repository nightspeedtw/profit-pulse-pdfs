// Anatomy vision verifier lane guard.
//
// PERMANENT CLASS FIX (mirrors fal-billing): a vision-verifier HTTP error
// (404 model-deprecated, 5xx, timeout) is a PROVIDER-STATE outage, not a
// quality verdict. It must never:
//   - fail the page
//   - score the page 0
//   - increment coloring_repair_attempts
// Instead we increment a lane-level consecutive-failure counter; after 3
// consecutive dead calls we flip an `anatomy_verifier_blocked` lane flag
// (parked in generation_settings.coloring_autopilot) that halts further
// renders. First healthy verifier call clears the flag automatically.
//
// The same pattern applies to every vision verifier (cover vision,
// transcription QC, etc.). Use markVerifierHealthy() on any 2xx and
// noteVerifierFailure() on any provider outage.

export class AnatomyVerifierBlockedError extends Error {
  readonly kind = "anatomy_verifier_blocked" as const;
  readonly family = "temporary_provider_error" as const;
  readonly consecutive_failures: number;
  readonly last_reason: string;
  constructor(consecutive: number, lastReason: string) {
    super(
      `anatomy_verifier_blocked: ${consecutive} consecutive failures — last: ${lastReason.slice(0, 200)}`,
    );
    this.consecutive_failures = consecutive;
    this.last_reason = lastReason;
  }
}

export const ANATOMY_VERIFIER_MODEL_LADDER_DEFAULT = [
  "google/gemini-3.5-flash",
  "google/gemini-3-flash-preview",
  "google/gemini-3.1-flash-lite",
];

export const ANATOMY_VERIFIER_BLOCK_THRESHOLD = 3;

export interface VerifierBlockedState {
  active: boolean;
  consecutive_failures: number;
  last_reason?: string;
  at?: string;
  cleared_at?: string;
}

async function readCfg(db: any): Promise<Record<string, unknown>> {
  const { data } = await db.from("generation_settings")
    .select("coloring_autopilot").eq("id", 1).maybeSingle();
  return (data?.coloring_autopilot ?? {}) as Record<string, unknown>;
}

async function patchCfg(db: any, patch: Record<string, unknown>): Promise<void> {
  const cur = await readCfg(db);
  await db.from("generation_settings")
    .update({ coloring_autopilot: { ...cur, ...patch } }).eq("id", 1);
}

export async function readAnatomyVerifierModels(db: any): Promise<string[]> {
  const cfg = await readCfg(db);
  const list = cfg.anatomy_verifier_models as unknown;
  if (Array.isArray(list) && list.length > 0 && list.every((x) => typeof x === "string")) {
    return list as string[];
  }
  return [...ANATOMY_VERIFIER_MODEL_LADDER_DEFAULT];
}

export async function readVerifierBlockedState(db: any): Promise<VerifierBlockedState> {
  const cfg = await readCfg(db);
  const s = cfg.anatomy_verifier_blocked as VerifierBlockedState | undefined;
  return s ?? { active: false, consecutive_failures: 0 };
}

/**
 * Record a verifier outage. Returns the new state. When
 * consecutive_failures reaches ANATOMY_VERIFIER_BLOCK_THRESHOLD, throws
 * AnatomyVerifierBlockedError so the caller can halt the lane.
 */
export async function noteVerifierFailure(
  db: any,
  reason: string,
): Promise<VerifierBlockedState> {
  const prev = await readVerifierBlockedState(db);
  const next: VerifierBlockedState = {
    active: prev.consecutive_failures + 1 >= ANATOMY_VERIFIER_BLOCK_THRESHOLD,
    consecutive_failures: prev.consecutive_failures + 1,
    last_reason: reason.slice(0, 400),
    at: new Date().toISOString(),
  };
  await patchCfg(db, { anatomy_verifier_blocked: next });
  if (next.active) {
    throw new AnatomyVerifierBlockedError(next.consecutive_failures, reason);
  }
  return next;
}

/** Clear the lane flag + counter after a healthy call. Idempotent no-op if already clear. */
export async function markVerifierHealthy(db: any): Promise<void> {
  const prev = await readVerifierBlockedState(db);
  if (!prev.active && prev.consecutive_failures === 0) return;
  await patchCfg(db, {
    anatomy_verifier_blocked: {
      active: false,
      consecutive_failures: 0,
      cleared_at: new Date().toISOString(),
    } as VerifierBlockedState,
  });
}

/**
 * Throw AnatomyVerifierBlockedError if the lane is currently flagged.
 * Call BEFORE any render dispatch so we don't burn FAL cost while the
 * anatomy gate can't measure the output.
 */
export async function assertAnatomyVerifierAvailable(db: any): Promise<void> {
  const s = await readVerifierBlockedState(db);
  if (s.active) {
    throw new AnatomyVerifierBlockedError(
      s.consecutive_failures,
      s.last_reason ?? "lane flagged anatomy_verifier_blocked=true",
    );
  }
}
