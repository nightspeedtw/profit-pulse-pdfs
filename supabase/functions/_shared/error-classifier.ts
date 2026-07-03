// Structured error classifier + Lovable-fix-instruction generator.
// Every pipeline error should be run through classifyError() so the
// admin dashboard shows *what happened, why, whether it can auto-recover,
// what it is doing about it, and if code needs fixing — exactly what to change.

export type CanonicalStatus =
  | "idea_generated"
  | "queued_for_production"
  | "production_running"
  | "generating_outline"
  | "writing_chapters"
  | "building_manuscript"
  | "running_qc"
  | "auto_fixing"
  | "generating_cover"
  | "generating_thumbnail"
  | "rendering_pdf"
  | "waiting_for_browserless_slot"
  | "waiting_for_shopify_quota"
  | "waiting_for_ai_budget"
  | "waiting_for_worker_slot"
  | "uploading_shopify_draft"
  | "verifying_shopify_draft"
  | "draft_uploaded"
  | "completed"
  | "needs_admin_attention"
  | "needs_code_fix"
  | "failed_non_recoverable";

export type ErrorType =
  | "qc_repairable"
  | "dependency_repairable"
  | "temporary_api_error"
  | "quota_wait"
  | "config_error"
  | "data_binding_bug"
  | "state_machine_bug"
  | "concurrency_bug"
  | "renderer_bug"
  | "shopify_bug"
  | "pdf_quality_bug"
  | "status_visibility_bug"
  | "non_recoverable";

export type Severity = "low" | "medium" | "high" | "critical";

export interface StructuredError {
  error_type: ErrorType;
  severity: Severity;
  recoverable: boolean;
  affected_step: string;
  user_friendly_message: string;
  technical_message: string;
  detected_root_cause: string;
  auto_recovery_action: string;
  next_retry_at: string | null;
  needs_code_fix: boolean;
  lovable_fix_instruction: string;
  affected_files: string[];
  test_to_confirm: string;
  suggested_status: CanonicalStatus;
  fingerprint: string;
}

export interface ClassifyContext {
  step: string;
  ebook_id?: string | null;
  run_id?: string | null;
  extra?: Record<string, unknown>;
}

function backoff(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

const KNOWN_SIGNATURES: Array<{
  match: (msg: string, ctx: ClassifyContext) => boolean;
  build: (msg: string, ctx: ClassifyContext) => StructuredError;
}> = [
  // Browserless 429
  {
    match: (m) => /429|too many|browserless/i.test(m) && /render|browserless|pdf/i.test(m),
    build: (m, ctx) => ({
      error_type: "temporary_api_error",
      severity: "medium",
      recoverable: true,
      affected_step: ctx.step,
      user_friendly_message:
        "Waiting for Browserless Slot — retrying automatically in 5 minutes.",
      technical_message: m,
      detected_root_cause:
        "Browserless returned HTTP 429 (rate limit / concurrent slot exhausted).",
      auto_recovery_action:
        "Hold the pdf_render lock, mark ebook waiting_for_browserless_slot, retry with exponential backoff (2 → 5 → 10 min).",
      next_retry_at: backoff(5),
      needs_code_fix: false,
      lovable_fix_instruction: "",
      affected_files: [],
      test_to_confirm: "",
      suggested_status: "waiting_for_browserless_slot",
      fingerprint: "browserless_429",
    }),
  },
  // Shopify daily cap / 402 / quota
  {
    match: (m) => /shopify/i.test(m) && /(quota|throttl|daily|cap|402)/i.test(m),
    build: (m, ctx) => ({
      error_type: "quota_wait",
      severity: "low",
      recoverable: true,
      affected_step: ctx.step,
      user_friendly_message:
        "Waiting for Shopify Quota — upload will resume when quota resets.",
      technical_message: m,
      detected_root_cause: "Shopify daily/hourly cap reached; assets preserved.",
      auto_recovery_action:
        "Enqueue in shopify_upload_queue and resume when the next window opens.",
      next_retry_at: backoff(60),
      needs_code_fix: false,
      lovable_fix_instruction: "",
      affected_files: [],
      test_to_confirm: "",
      suggested_status: "waiting_for_shopify_quota",
      fingerprint: "shopify_quota",
    }),
  },
  // AI budget / credits
  {
    match: (m) => /credit|402|payment required|budget exceeded/i.test(m),
    build: (m, ctx) => ({
      error_type: "quota_wait",
      severity: "high",
      recoverable: true,
      affected_step: ctx.step,
      user_friendly_message: "Waiting for AI Budget — retrying automatically.",
      technical_message: m,
      detected_root_cause: "AI Gateway returned insufficient credits.",
      auto_recovery_action:
        "Pause the run, mark waiting_for_ai_budget, retry every 15 minutes.",
      next_retry_at: backoff(15),
      needs_code_fix: false,
      lovable_fix_instruction: "",
      affected_files: [],
      test_to_confirm: "",
      suggested_status: "waiting_for_ai_budget",
      fingerprint: "ai_budget",
    }),
  },
  // Missing outline
  {
    match: (m) => /no outline|outline missing|outline_json is null|invalid outline/i.test(m),
    build: (m, ctx) => ({
      error_type: "dependency_repairable",
      severity: "medium",
      recoverable: true,
      affected_step: ctx.step,
      user_friendly_message: "Auto-fixing missing outline — regenerating.",
      technical_message: m,
      detected_root_cause: "Chapter writing was reached without a valid outline_json.",
      auto_recovery_action:
        "Resume from generate_outline; validate JSON contract; retry up to 3 times then deterministic fallback.",
      next_retry_at: backoff(0),
      needs_code_fix: false,
      lovable_fix_instruction: "",
      affected_files: [],
      test_to_confirm: "",
      suggested_status: "generating_outline",
      fingerprint: "missing_outline",
    }),
  },
  // Missing chapters
  {
    match: (m) => /chapter.*missing|no chapters|chapters\.length/i.test(m),
    build: (m, ctx) => ({
      error_type: "dependency_repairable",
      severity: "medium",
      recoverable: true,
      affected_step: ctx.step,
      user_friendly_message: "Auto-fixing missing chapters — writing only the gaps.",
      technical_message: m,
      detected_root_cause: "Manuscript build ran without full chapter set.",
      auto_recovery_action: "Route back to write_chapters for missing indices only.",
      next_retry_at: backoff(0),
      needs_code_fix: false,
      lovable_fix_instruction: "",
      affected_files: [],
      test_to_confirm: "",
      suggested_status: "writing_chapters",
      fingerprint: "missing_chapters",
    }),
  },
  // AI JSON truncation / invalid structured response — recoverable by retrying
  // with compact prompts or deterministic fallback inside the QC function.
  {
    match: (m) => /truncated json|no json found|invalid.*json|json.*model response|finish_reason.*length/i.test(m),
    build: (m, ctx) => ({
      error_type: "qc_repairable",
      severity: "medium",
      recoverable: true,
      affected_step: ctx.step,
      user_friendly_message: "Auto-fixing AI JSON issue — retrying with compact QC / fallback scoring.",
      technical_message: m,
      detected_root_cause: "The AI returned malformed or truncated JSON during a QC step.",
      auto_recovery_action: "Retry the QC with smaller JSON output; if still invalid, use deterministic fallback scoring and continue repairs.",
      next_retry_at: backoff(1),
      needs_code_fix: false,
      lovable_fix_instruction: "",
      affected_files: [],
      test_to_confirm: "QC no longer returns HTTP 400 for truncated JSON; ebook moves to auto_fixing or next step.",
      suggested_status: "auto_fixing",
      fingerprint: "ai_json_truncated_qc",
    }),
  },
  // Edge-function idle timeout — recoverable by time-slicing the worker and
  // resuming from next_retry_at.
  {
    match: (m) => /idle_timeout|request idle timeout|150s|timeout limit/i.test(m),
    build: (m, ctx) => ({
      error_type: "temporary_api_error",
      severity: "medium",
      recoverable: true,
      affected_step: ctx.step,
      user_friendly_message: "Reader/QC worker timed out — continuing automatically in the next worker slice.",
      technical_message: m,
      detected_root_cause: "A long QC repair pass exceeded the edge worker idle timeout.",
      auto_recovery_action: "Mark waiting_for_worker_slot, preserve progress, and resume from the same ebook after a short backoff.",
      next_retry_at: backoff(2),
      needs_code_fix: false,
      lovable_fix_instruction: "",
      affected_files: [],
      test_to_confirm: "Reader QC returns a deferred/waiting status before 150s and the recovery worker resumes it.",
      suggested_status: "waiting_for_worker_slot",
      fingerprint: "edge_idle_timeout_qc",
    }),
  },
  // Worksheet overflow
  {
    match: (m) => /worksheet.*overflow|table.*overflow|column.*overflow/i.test(m),
    build: (m, ctx) => ({
      error_type: "pdf_quality_bug",
      severity: "medium",
      recoverable: true,
      affected_step: ctx.step,
      user_friendly_message: "Auto-fixing PDF worksheet overflow.",
      technical_message: m,
      detected_root_cause: "Worksheet table exceeded page width during PDF render.",
      auto_recovery_action:
        "Wrap headers, split table, apply header shortforms, rerender PDF, rerun QC.",
      next_retry_at: backoff(0),
      needs_code_fix: false,
      lovable_fix_instruction: "",
      affected_files: [],
      test_to_confirm: "",
      suggested_status: "auto_fixing",
      fingerprint: "worksheet_overflow",
    }),
  },
];

const CODE_FIX_SIGNATURES: Array<{
  match: (msg: string, ctx: ClassifyContext) => boolean;
  build: (msg: string, ctx: ClassifyContext) => StructuredError;
}> = [
  {
    match: (m) =>
      /production page.*zero jobs|jobs missing from production|autopilot_runs.*empty/i.test(m),
    build: (m, ctx) => ({
      error_type: "data_binding_bug",
      severity: "high",
      recoverable: false,
      affected_step: ctx.step,
      user_friendly_message: "System code fix required — Lovable instruction generated.",
      technical_message: m,
      detected_root_cause:
        "Production page is not reading from the canonical autopilot_pipeline_runs + ebooks join.",
      auto_recovery_action: "None — requires code change.",
      next_retry_at: null,
      needs_code_fix: true,
      lovable_fix_instruction: lovablePrompt({
        title: "Production page showing zero jobs",
        detected: "Production page displays 0 jobs even though autopilot_pipeline_runs has rows.",
        root_cause:
          "Production page is querying a deprecated table or applying a filter that hides all rows.",
        files: [
          "src/pages/admin/Production.tsx",
          "src/lib/adminData.ts",
          "supabase/functions/admin-data/index.ts",
        ],
        fix: [
          "Replace Production page query with unified query from autopilot_pipeline_runs joined with ebooks (see admin-data 'production' resource).",
          "Include all statuses by default; remove any today-only filter.",
          "Add fallback title if ebook.title is null (`Autopilot run <shortId>`).",
          "Refetch every 3–5 seconds while active jobs exist.",
        ],
        test:
          "Start One-Click Autopilot; within 3s the new run appears in Production and All Jobs count > 0; status/progress update live.",
      }),
      affected_files: ["src/pages/admin/Production.tsx", "src/lib/adminData.ts"],
      test_to_confirm: "Start autopilot → row appears within 3s and count > 0.",
      suggested_status: "needs_code_fix",
      fingerprint: "production_zero_jobs",
    }),
  },
  {
    match: (m) =>
      /concurrency|two.*running|duplicate.*production_running|lock.*not held/i.test(m),
    build: (m, ctx) => ({
      error_type: "concurrency_bug",
      severity: "critical",
      recoverable: false,
      affected_step: ctx.step,
      user_friendly_message: "System code fix required — Sequential Safe Mode violated.",
      technical_message: m,
      detected_root_cause:
        "More than one ebook holds a heavy production status without owning the heavy_production lock.",
      auto_recovery_action: "None — requires code change.",
      next_retry_at: null,
      needs_code_fix: true,
      lovable_fix_instruction: lovablePrompt({
        title: "Sequential Safe Mode violated — multiple heavy jobs running",
        detected:
          "Doctor detected more than one ebook with a heavy production status while the heavy_production lock is held by at most one.",
        root_cause:
          "A pipeline entry point is skipping try_acquire_lock('heavy_production', ebook_id) before entering heavy steps.",
        files: [
          "supabase/functions/autopilot-pipeline/index.ts",
          "supabase/functions/_shared/recovery.ts",
        ],
        fix: [
          "At the top of every heavy step (outline → shopify verify), call try_acquire_lock('heavy_production', ebook_id).",
          "On failure, set canonical_status = 'queued_for_production' with a queue_position and return.",
          "On success, always release_lock on final success, terminal failure, or quota-wait transitions.",
        ],
        test:
          "Kick off two Autopilot runs in the same second; exactly one should show 'production_running', the other should show 'queued_for_production' with queue_position = 1.",
      }),
      affected_files: [
        "supabase/functions/autopilot-pipeline/index.ts",
        "supabase/functions/_shared/recovery.ts",
      ],
      test_to_confirm:
        "Two simultaneous runs → only one production_running, the other queued.",
      suggested_status: "needs_code_fix",
      fingerprint: "concurrency_violation",
    }),
  },
  {
    match: (m) =>
      /heartbeat.*stale|no heartbeat|last_heartbeat/i.test(m),
    build: (m, ctx) => ({
      error_type: "status_visibility_bug",
      severity: "high",
      recoverable: true,
      affected_step: ctx.step,
      user_friendly_message: "System healed — stale heartbeat detected, lock released.",
      technical_message: m,
      detected_root_cause:
        "A run stopped writing heartbeats for > 5 minutes while holding heavy_production lock.",
      auto_recovery_action:
        "Release stale lock, requeue the run at position 1, dispatch next queued ebook.",
      next_retry_at: backoff(0),
      needs_code_fix: true,
      lovable_fix_instruction: lovablePrompt({
        title: "Pipeline stopped writing heartbeats",
        detected:
          "ebooks.last_heartbeat_at is more than 5 minutes old while the run is in a heavy status.",
        root_cause:
          "A long-running step is not calling the heartbeat writer inside its inner loop.",
        files: [
          "supabase/functions/autopilot-pipeline/index.ts",
          "supabase/functions/write-chapters/index.ts",
          "supabase/functions/render-pdf/index.ts",
        ],
        fix: [
          "Wrap every step's inner loop with a heartbeat writer that updates ebooks.last_heartbeat_at at least every 30s.",
          "Emit current_subtask and progress_pct on every heartbeat.",
        ],
        test:
          "Start any long step and watch ebooks.last_heartbeat_at update at least twice per minute.",
      }),
      affected_files: [
        "supabase/functions/autopilot-pipeline/index.ts",
        "supabase/functions/write-chapters/index.ts",
        "supabase/functions/render-pdf/index.ts",
      ],
      test_to_confirm: "last_heartbeat_at advances at least every 30s during heavy steps.",
      suggested_status: "auto_fixing",
      fingerprint: "stale_heartbeat",
    }),
  },
];

export function classifyError(err: unknown, ctx: ClassifyContext): StructuredError {
  const msg = err instanceof Error ? err.message : String(err ?? "unknown error");

  for (const sig of KNOWN_SIGNATURES) if (sig.match(msg, ctx)) return sig.build(msg, ctx);
  for (const sig of CODE_FIX_SIGNATURES) if (sig.match(msg, ctx)) return sig.build(msg, ctx);

  return {
    error_type: "non_recoverable",
    severity: "high",
    recoverable: false,
    affected_step: ctx.step,
    user_friendly_message:
      "Something failed and could not be automatically classified. Admin attention required.",
    technical_message: msg,
    detected_root_cause: "Unknown error signature.",
    auto_recovery_action: "None — retry once, then escalate to admin.",
    next_retry_at: backoff(1),
    needs_code_fix: false,
    lovable_fix_instruction: "",
    affected_files: [],
    test_to_confirm: "",
    suggested_status: "needs_admin_attention",
    fingerprint: `unknown_${ctx.step}_${hash(msg)}`,
  };
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 8);
}

export function lovablePrompt(input: {
  title: string;
  detected: string;
  root_cause: string;
  files: string[];
  fix: string[];
  test: string;
}): string {
  return [
    `Title: ${input.title}`,
    "",
    `Detected problem:`,
    input.detected,
    "",
    `Root cause:`,
    input.root_cause,
    "",
    `Affected files:`,
    ...input.files.map((f) => `  - ${f}`),
    "",
    `Required fix:`,
    ...input.fix.map((f, i) => `  ${i + 1}. ${f}`),
    "",
    `Acceptance test:`,
    input.test,
  ].join("\n");
}

// Convenience upsert (service role client is passed in to avoid duplicating env plumbing).
export async function recordSystemFix(
  supabase: {
    from: (t: string) => {
      upsert: (
        row: Record<string, unknown>,
        opts: { onConflict: string },
      ) => Promise<{ error: unknown }>;
    };
  },
  s: StructuredError,
  ctx: ClassifyContext,
): Promise<void> {
  if (!s.needs_code_fix) return;
  const row = {
    title: s.user_friendly_message,
    detected_problem: s.technical_message,
    root_cause: s.detected_root_cause,
    error_type: s.error_type,
    severity: s.severity,
    affected_files: s.affected_files,
    affected_ebook_id: ctx.ebook_id ?? null,
    affected_run_id: ctx.run_id ?? null,
    required_fix: s.lovable_fix_instruction,
    acceptance_test: s.test_to_confirm,
    lovable_prompt: s.lovable_fix_instruction,
    fingerprint: s.fingerprint,
    last_seen_at: new Date().toISOString(),
    status: "open",
  };
  await supabase
    .from("system_fix_instructions")
    .upsert(row, { onConflict: "fingerprint" });
}
