// Self-Healing Recovery classifier + Shopify upload queue helpers.
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
  reason: string;   // short machine token, e.g. daily_shopify_upload_cap_reached
  detail: string;   // human-readable
  retryable: boolean;
  nextRetryAt?: string; // ISO
}

const CAP_REGEX = /(daily.*shopify.*cap|shopify.*upload cap|20\/day|quota)/i;
const RATE_REGEX = /\b(429|rate.?limit|too many requests)\b/i;
const NET_REGEX = /\b(timeout|ETIMEDOUT|ECONNRESET|network|fetch failed)\b/i;
const SRV_REGEX = /\b(500|502|503|504|bad gateway|service unavailable|internal server error)\b/i;
const AUTH_REGEX = /\b(401|invalid api key|unauthorized|wrong password|unrecognized login)\b/i;
const MISSING_SHOPIFY_TOKEN = /(missing.*shopify.*token|SHOPIFY_.*not set)/i;
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

/** Classify an arbitrary error string coming from any pipeline step. */
export function classifyError(input: string | undefined | null, ctx: { step?: string } = {}): Classification {
  const s = (input ?? "").toString();

  if (CAP_REGEX.test(s)) {
    return {
      klass: "recoverable_quota_error",
      reason: "daily_shopify_upload_cap_reached",
      detail: "Daily Shopify upload cap reached — waiting for next quota window.",
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
  if (AUTH_REGEX.test(s) || MISSING_SHOPIFY_TOKEN.test(s)) {
    return {
      klass: "non_recoverable_config_error",
      reason: "invalid_shopify_credentials",
      detail: "Shopify credentials invalid or missing — reconnect the store or update the access token in Settings.",
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

/** Map an autopilot status label to a user-visible status. */
export function humanStatus(state: string | null | undefined): string {
  switch (state) {
    case "waiting_for_shopify_quota": return "Waiting for Shopify Quota";
    case "waiting_for_ai_budget": return "Waiting for AI Budget";
    case "waiting_for_worker_slot": return "Waiting for Worker Slot";
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

/** Enqueue (or refresh) an ebook in the Shopify upload queue. */
export async function enqueueShopifyUpload(
  db: any,
  ebook_id: string,
  opts: { run_id?: string; reason?: string; nextRetryAt?: string; priority?: number } = {},
) {
  const row = {
    ebook_id,
    run_id: opts.run_id ?? null,
    status: opts.reason === "daily_shopify_upload_cap_reached" ? "waiting_for_quota" : "queued",
    blocker_reason: opts.reason ?? null,
    next_retry_at: opts.nextRetryAt ?? nextUtcMidnight(),
    priority: opts.priority ?? 100,
  };
  const { error } = await db.from("shopify_upload_queue").upsert(row, { onConflict: "ebook_id" });
  if (error) console.warn("[recovery] enqueueShopifyUpload error", error.message);
}

/** Mark an ebook + its pipeline run with a classified blocker (no admin flag by default). */
export async function markBlocker(
  db: any,
  ebook_id: string,
  c: Classification,
  extra: { autopilot_state?: string } = {},
) {
  const autopilot_state = extra.autopilot_state ?? (
    c.klass === "recoverable_quota_error" && c.reason === "daily_shopify_upload_cap_reached"
      ? "waiting_for_shopify_quota"
      : c.klass === "recoverable_quota_error"
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
