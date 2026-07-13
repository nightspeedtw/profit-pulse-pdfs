// Self-Healing Recovery classifier + production lock helpers.
//
// Every recoverable failure the pipeline sees gets classified into one of
// six buckets and dispatched appropriately, so admin is only pulled in for
// true non-recoverable issues.

export type BlockerClass =
  | "recoverable_qc_error"
  | "recoverable_dependency_error"
  | "recoverable_temporary_api_error"
  | "recoverable_quota_error"
  | "non_recoverable_config_error"
  | "non_recoverable_compliance_error"
  | "unknown";

export interface Classification {
  klass: BlockerClass;
  reason: string;   // short machine token, e.g. daily_upload_cap_reached
  detail: string;   // human-readable
  retryable: boolean;
  nextRetryAt?: string; // ISO
}

const CAP_REGEX = /(daily.*upload cap|20\/day|quota)/i;
const RATE_REGEX = /\b(429|rate.?limit|too many requests)\b/i;
const BROWSERLESS_REGEX = /browserless/i;
const NET_REGEX = /\b(timeout|ETIMEDOUT|ECONNRESET|network|fetch failed)\b/i;
const SRV_REGEX = /\b(500|502|503|504|bad gateway|service unavailable|internal server error)\b/i;
const AUTH_REGEX = /\b(401|invalid api key|unauthorized|wrong password|unrecognized login)\b/i;
const COMPLIANCE_REGEX = /(prohibited|unsafe (claim|promise)|cannot.*rewrite.*(medical|financial|legal))/i;
const DEP_REGEX = /(missing (outline|chapters|manuscript|cover|pdf|product copy|price)|no outline yet|invalid outline)/i;

/** Return the next UTC midnight as an ISO string. */
export function nextUtcMidnight(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

/** Exponential backoff (seconds → ISO timestamp). */
export function backoffAt(attempt: number, baseSec = 30, capSec = 3600): string {
  const sec = Math.min(capSec, baseSec * Math.pow(2, Math.max(0, attempt - 1)));
  return new Date(Date.now() + sec * 1000).toISOString();
}

/**
 * Browserless rate-limit backoff schedule (attempts 1-3):
 * attempt 1 → 2 min · attempt 2 → 5 min · attempt 3 → 10 min.
 */
export function browserlessBackoffAt(attempt: number): string {
  const minutes = attempt <= 1 ? 2 : attempt === 2 ? 5 : 10;
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

/** Classify an arbitrary error string coming from any pipeline step. */
export function classifyError(input: string | undefined | null, ctx: { step?: string } = {}): Classification {
  const s = (input ?? "").toString();
  const step = ctx.step ?? "";

  // Browserless rate-limit — treat as its own bucket so the UI never says "QC failed".
  if (RATE_REGEX.test(s) && (BROWSERLESS_REGEX.test(s) || /render.?pdf|pdf/i.test(step))) {
    return {
      klass: "recoverable_temporary_api_error",
      reason: "browserless_rate_limited",
      detail: "PDF render rate limited by Browserless — will retry automatically.",
      retryable: true,
      nextRetryAt: browserlessBackoffAt(1),
    };
  }

  if (CAP_REGEX.test(s)) {
    return {
      klass: "recoverable_quota_error",
      reason: "daily_upload_cap_reached",
      detail: "Daily upload cap reached — waiting for next quota window.",
      retryable: true,
      nextRetryAt: nextUtcMidnight(),
    };
  }
  if (/ai.*(daily )?budget|cost_limit_reached/i.test(s)) {
    return {
      klass: "recoverable_quota_error",
      reason: "ai_daily_budget_reached",
      detail: "AI daily budget reached — waiting for next budget window.",
      retryable: true,
      nextRetryAt: nextUtcMidnight(),
    };
  }
  if (AUTH_REGEX.test(s)) {
    return {
      klass: "non_recoverable_config_error",
      reason: "invalid_credentials",
      detail: "Credentials invalid or missing — update the access token in Settings.",
      retryable: false,
    };
  }
  if (COMPLIANCE_REGEX.test(s)) {
    return {
      klass: "non_recoverable_compliance_error",
      reason: "compliance_violation",
      detail: "Content contains a claim that cannot be safely rewritten. Manual review required.",
      retryable: false,
    };
  }
  if (RATE_REGEX.test(s) || NET_REGEX.test(s) || SRV_REGEX.test(s)) {
    return {
      klass: "recoverable_temporary_api_error",
      reason: "temporary_api_error",
      detail: "Temporary upstream error — retrying with backoff.",
      retryable: true,
      nextRetryAt: backoffAt(1),
    };
  }
  if (DEP_REGEX.test(s)) {
    return {
      klass: "recoverable_dependency_error",
      reason: "missing_dependency",
      detail: "A required prior step output is missing — routing back to repair it.",
      retryable: true,
    };
  }
  // Default: assume QC-style repairable
  return {
    klass: "recoverable_qc_error",
    reason: "qc_repairable",
    detail: s.slice(0, 240) || "Repairable QC issue detected.",
    retryable: true,
  };
}

// ============================================================================
// Sequential production locks (heavy_production, pdf_render)
// ============================================================================

/** Named lock keys used across the pipeline. */
export const LOCK_HEAVY = "heavy_production";
export const LOCK_PDF   = "pdf_render";

export interface LockResult { acquired: boolean; holder: string | null; expires_at: string | null; }

/**
 * Attempt to acquire a named production lock via the atomic Postgres helper.
 * If the caller already holds the lock, this refreshes its TTL and returns
 * acquired = true (safe to call at the top of every pipeline invocation).
 */
export async function tryAcquireLock(
  db: any,
  name: string,
  holderEbookId: string,
  opts: { ttlSec?: number; runId?: string | null } = {},
): Promise<LockResult> {
  const { data, error } = await db.rpc("try_acquire_lock", {
    p_name: name,
    p_holder: holderEbookId,
    p_run_id: opts.runId ?? null,
    p_ttl_sec: opts.ttlSec ?? 3600,
  });
  if (error) {
    console.warn("[locks] try_acquire_lock error", name, error.message);
    return { acquired: false, holder: null, expires_at: null };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    acquired: !!row?.acquired,
    holder: row?.holder ?? null,
    expires_at: row?.expires_at ?? null,
  };
}

/** Release a named lock (safe no-op if we're not the holder). */
export async function releaseLock(db: any, name: string, holderEbookId: string): Promise<void> {
  const { error } = await db.rpc("release_lock", { p_name: name, p_holder: holderEbookId });
  if (error) console.warn("[locks] release_lock error", name, error.message);
}

/** Peek at the current holder without acquiring. */
export async function getLockHolder(db: any, name: string): Promise<{ holder: string | null; expires_at: string | null }> {
  const { data } = await db.from("production_locks")
    .select("holder_ebook_id,expires_at").eq("name", name).maybeSingle();
  return { holder: data?.holder_ebook_id ?? null, expires_at: data?.expires_at ?? null };
}

/** Map an autopilot status label to a user-visible status. */
export function humanStatus(state: string | null | undefined): string {
  switch (state) {
    case "waiting_for_ai_budget": return "Waiting for AI Budget";
    case "waiting_for_worker_slot": return "Waiting for Worker Slot";
    case "waiting_for_browserless_slot": return "Waiting for Browserless Slot";
    case "queued_for_production": return "Queued for Production";
    case "production_running": return "Production Running";
    case "rendering_pdf": return "Rendering PDF";
    case "auto_fixing": return "Auto-Fixing";
    case "repairing_dependency": return "Repairing Dependency";
    case "draft_upload_queued": return "Draft Upload Queued";
    case "draft_uploaded": return "Draft Uploaded";
    case "ready_to_publish": return "Ready to Publish";
    case "needs_admin_attention": return "Needs Admin Attention";
    case "failed_non_recoverable": return "Failed (non-recoverable)";
    case "running": return "Running";
    default: return state ?? "Unknown";
  }
}

/** Mark an ebook + its pipeline run with a classified blocker (no admin flag by default). */
export async function markBlocker(
  db: any,
  ebook_id: string,
  c: Classification,
  extra: { autopilot_state?: string } = {},
) {
  const autopilot_state = extra.autopilot_state ?? (
    c.klass === "recoverable_quota_error"
      ? "waiting_for_ai_budget"
      : c.klass === "non_recoverable_config_error" || c.klass === "non_recoverable_compliance_error"
      ? "needs_admin_attention"
      : "auto_fixing"
  );
  await db.from("ebooks").update({
    autopilot_state,
    blocker_class: c.klass,
    blocker_reason: c.reason,
    needs_review_reason: c.retryable ? null : c.detail,
    next_retry_at: c.nextRetryAt ?? null,
  }).eq("id", ebook_id);
}
