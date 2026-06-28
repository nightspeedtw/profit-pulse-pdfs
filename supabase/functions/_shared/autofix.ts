// Global Auto-Fix engine.
// Wraps any QC gate with: run -> if fail, targeted fix -> re-run, up to N attempts.
// On final failure, sets qc_status='needs_admin_review' and records full history.
//
// One engine, one place for retry/cap/history logic. Used by every gate.

// deno-lint-ignore no-explicit-any
type Db = any;

export type GateResult = {
  pass: boolean;
  score?: number | null;
  required?: number | null;
  reason?: string;
};

export type AutoFixHistoryEntry = {
  attempt: number;
  gate: string;
  component?: string | null;
  reason?: string;
  action?: string;
  before?: number | null;
  after?: number | null;
  result: "pass" | "fail";
  at: string;
};

export type RunWithAutoFixOpts = {
  db: Db;
  ebookId: string;
  gate: string;
  component?: string | null;
  /** Run the QC check. Must return { pass, score, required, reason }. */
  check: () => Promise<GateResult>;
  /** Targeted fix for this gate. Returns short label of what was attempted. */
  fix: (attempt: number, lastReason?: string) => Promise<string>;
  /** Per-gate override; falls back to ebooks.max_auto_fix_attempts (default 3). */
  max?: number;
  /** Recommended manual action when auto-fix gives up. */
  recommendedAction?: string;
};

export type RunWithAutoFixResult = {
  pass: boolean;
  attempts: number;
  finalScore?: number | null;
  reason?: string;
  needsAdminReview: boolean;
};

async function loadEbook(db: Db, id: string) {
  const { data } = await db
    .from("ebooks")
    .select(
      "auto_fix_history, max_auto_fix_attempts, qc_status, auto_fix_attempt_count",
    )
    .eq("id", id)
    .single();
  return data ?? {};
}

async function appendHistory(db: Db, ebookId: string, entry: AutoFixHistoryEntry) {
  const { data } = await db
    .from("ebooks")
    .select("auto_fix_history")
    .eq("id", ebookId)
    .single();
  const history = Array.isArray(data?.auto_fix_history) ? data.auto_fix_history : [];
  history.push(entry);
  await db.from("ebooks").update({ auto_fix_history: history }).eq("id", ebookId);
}

export async function runWithAutoFix(
  opts: RunWithAutoFixOpts,
): Promise<RunWithAutoFixResult> {
  const { db, ebookId, gate, component, check, fix, recommendedAction } = opts;
  const eb = await loadEbook(db, ebookId);
  const max = opts.max ?? Number(eb.max_auto_fix_attempts ?? 3);

  // Mark "auto_fixing" while the loop runs.
  await db
    .from("ebooks")
    .update({
      qc_status: "auto_fixing",
      failed_gate: gate,
      failed_component: component ?? null,
    })
    .eq("id", ebookId);

  let attempts = 0;
  let lastReason: string | undefined;
  let lastScore: number | null | undefined;
  let lastRequired: number | null | undefined;

  // First check (attempt 0 = baseline).
  let result = await check();
  lastScore = result.score ?? null;
  lastRequired = result.required ?? null;
  lastReason = result.reason;

  if (result.pass) {
    await db
      .from("ebooks")
      .update({
        qc_status: "ready_to_continue",
        failed_gate: null,
        failed_component: null,
        failed_score: null,
        required_score: null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", ebookId);
    return { pass: true, attempts: 0, finalScore: lastScore, needsAdminReview: false };
  }

  while (attempts < max) {
    attempts += 1;
    const before = lastScore ?? null;
    let action = "noop";
    try {
      action = await fix(attempts, lastReason);
    } catch (err) {
      action = `fix_error: ${(err as Error).message ?? String(err)}`;
    }

    result = await check();
    const after = result.score ?? null;
    lastScore = after;
    lastRequired = result.required ?? lastRequired;
    lastReason = result.reason;

    await appendHistory(db, ebookId, {
      attempt: attempts,
      gate,
      component: component ?? null,
      reason: lastReason,
      action,
      before,
      after,
      result: result.pass ? "pass" : "fail",
      at: new Date().toISOString(),
    });

    await db
      .from("ebooks")
      .update({
        auto_fix_attempt_count: attempts,
        last_auto_fix_action: action,
        failed_score: after ?? null,
        required_score: lastRequired ?? null,
      })
      .eq("id", ebookId);

    if (result.pass) {
      await db
        .from("ebooks")
        .update({
          qc_status: "ready_to_continue",
          failed_gate: null,
          failed_component: null,
          failed_score: null,
          required_score: null,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", ebookId);
      return {
        pass: true,
        attempts,
        finalScore: after,
        needsAdminReview: false,
      };
    }
  }

  // Gave up.
  await db
    .from("ebooks")
    .update({
      qc_status: "needs_admin_review",
      failed_gate: gate,
      failed_component: component ?? null,
      failed_score: lastScore ?? null,
      required_score: lastRequired ?? null,
      admin_review_reason: lastReason ?? `auto-fix exhausted ${max} attempts on ${gate}`,
      next_recommended_action:
        recommendedAction ?? `Manually review ${gate}${component ? ` (${component})` : ""}.`,
      blocked_at: new Date().toISOString(),
    })
    .eq("id", ebookId);

  return {
    pass: false,
    attempts,
    finalScore: lastScore,
    reason: lastReason,
    needsAdminReview: true,
  };
}

/** Reset gate state — used when admin clicks "Retry Auto-Fix Once" or after manual fix. */
export async function resetAutoFix(db: Db, ebookId: string) {
  await db
    .from("ebooks")
    .update({
      qc_status: "qc_pending",
      failed_gate: null,
      failed_component: null,
      failed_score: null,
      required_score: null,
      auto_fix_attempt_count: 0,
      admin_review_reason: null,
      next_recommended_action: null,
      blocked_at: null,
    })
    .eq("id", ebookId);
}
