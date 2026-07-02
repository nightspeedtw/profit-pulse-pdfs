// Live Autopilot run tracker.
// Writes to autopilot_pipeline_runs + autopilot_pipeline_steps so the admin UI
// can subscribe via Supabase Realtime and show transparent progress.

// deno-lint-ignore no-explicit-any
type Db = any;

export interface StepDef { name: string; label: string; order: number }

export const AUTOPILOT_STEPS: StepDef[] = [
  { name: "start_run",         label: "Start run",                   order: 1 },
  { name: "generate_idea",     label: "Generate Idea",               order: 2 },
  { name: "title_and_hook",    label: "Writing Title & Hook",        order: 3 },
  { name: "idea_qc",           label: "Running Idea QC",             order: 4 },
  { name: "outline",           label: "Generating Outline",          order: 5 },
  { name: "outline_qc",        label: "Running Outline QC",          order: 6 },
  { name: "chapter_writing",   label: "Writing Chapters",            order: 7 },
  { name: "chapter_qc",        label: "Running Chapter QC",          order: 8 },
  { name: "manuscript_qc",     label: "Running Manuscript QC",       order: 9 },
  { name: "cover",             label: "Generating Cover",            order: 10 },
  { name: "cover_qc",          label: "Running Cover QC",            order: 11 },
  { name: "thumbnail",         label: "Generating Thumbnail",        order: 12 },
  { name: "thumbnail_qc",      label: "Running Thumbnail QC",        order: 13 },
  { name: "pdf_layout",        label: "Designing PDF",               order: 14 },
  { name: "pdf_render",        label: "Rendering PDF",               order: 15 },
  { name: "pdf_qc",            label: "Running PDF QC",              order: 16 },
  { name: "product_copy",      label: "Generating Product Copy",     order: 17 },
  { name: "product_qc",        label: "Running Product Page QC",     order: 18 },
  { name: "shopify_draft",     label: "Uploading Shopify Draft",     order: 19 },
  { name: "shopify_verify",    label: "Verifying Shopify Draft",     order: 20 },
  { name: "complete",          label: "Complete",                    order: 21 },
];

const STEP_MAP = new Map(AUTOPILOT_STEPS.map((s) => [s.name, s] as const));
const TOTAL = AUTOPILOT_STEPS.length;

// Map internal step_name → canonical_status shown on the admin dashboard.
const STEP_TO_CANONICAL: Record<string, string> = {
  start_run: "production_running",
  generate_idea: "production_running",
  title_and_hook: "production_running",
  idea_qc: "running_qc",
  outline: "generating_outline",
  outline_qc: "running_qc",
  chapter_writing: "writing_chapters",
  chapter_qc: "running_qc",
  manuscript_qc: "running_qc",
  cover: "generating_cover",
  cover_qc: "running_qc",
  thumbnail: "generating_thumbnail",
  thumbnail_qc: "running_qc",
  pdf_layout: "rendering_pdf",
  pdf_render: "rendering_pdf",
  pdf_qc: "running_qc",
  product_copy: "production_running",
  product_qc: "running_qc",
  shopify_draft: "uploading_shopify_draft",
  shopify_verify: "verifying_shopify_draft",
  complete: "completed",
};

export class RunTracker {
  private startTs = new Map<string, number>();
  private ebookId: string | null = null;

  constructor(public db: Db, public runId: string, ebookId: string | null = null) {
    this.ebookId = ebookId;
  }

  setEbookId(id: string | null) { this.ebookId = id; }

  private async syncEbook(patch: Record<string, unknown>) {
    if (!this.ebookId) return;
    try {
      await this.db.from("ebooks").update({
        ...patch,
        last_heartbeat_at: new Date().toISOString(),
      }).eq("id", this.ebookId);
    } catch (_err) { /* best-effort */ }
  }

  static async start(db: Db, opts: {
    ebook_id?: string | null;
    idea_id?: string | null;
    mode?: string;
    test_mode?: boolean;
    triggered_by?: string | null;
  }): Promise<RunTracker> {
    const { data, error } = await db
      .from("autopilot_pipeline_runs")
      .insert({
        ebook_id: opts.ebook_id ?? null,
        idea_id: opts.idea_id ?? null,
        status: "running",
        mode: opts.mode ?? null,
        test_mode: !!opts.test_mode,
        triggered_by: opts.triggered_by ?? null,
        current_step: "start_run",
        current_step_label: "Start run",
        current_action_message: "Starting Autopilot run…",
        progress_percent: 0,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`tracker.start: ${error?.message}`);

    // Seed all step rows as pending so the UI shows the full timeline immediately.
    const rows = AUTOPILOT_STEPS.map((s) => ({
      run_id: data.id,
      ebook_id: opts.ebook_id ?? null,
      step_order: s.order,
      step_name: s.name,
      step_label: s.label,
      status: "pending",
    }));
    await db.from("autopilot_pipeline_steps").insert(rows);

    const t = new RunTracker(db, data.id, opts.ebook_id ?? null);
    await t.passStep("start_run", { message: "Pipeline started" });
    return t;
  }

  private label(name: string) {
    return STEP_MAP.get(name)?.label ?? name;
  }

  private async patchRun(patch: Record<string, unknown>) {
    await this.db
      .from("autopilot_pipeline_runs")
      .update({ ...patch, updated_at: new Date().toISOString(), last_heartbeat_at: new Date().toISOString() })
      .eq("id", this.runId);
  }

  private async patchStep(step_name: string, patch: Record<string, unknown>) {
    await this.db
      .from("autopilot_pipeline_steps")
      .update(patch)
      .eq("run_id", this.runId)
      .eq("step_name", step_name);
  }

  private async progress() {
    // Count any "done" status (passed, passed_existing, skipped) toward progress.
    const { count } = await this.db
      .from("autopilot_pipeline_steps")
      .select("id", { count: "exact", head: true })
      .eq("run_id", this.runId)
      .in("status", ["passed", "passed_existing", "skipped"]);
    return Math.min(100, Math.round(((count ?? 0) / TOTAL) * 100));
  }

  async setEbook(ebook_id: string) {
    await this.patchRun({ ebook_id });
    await this.db
      .from("autopilot_pipeline_steps")
      .update({ ebook_id })
      .eq("run_id", this.runId);
  }

  async startStep(step_name: string, message?: string, subtask?: string) {
    this.startTs.set(step_name, Date.now());
    const label = this.label(step_name);
    await this.patchStep(step_name, {
      status: "running",
      message: message ?? `Running ${label}…`,
      started_at: new Date().toISOString(),
      error_message: null,
      metadata_json: subtask ? { current_subtask: subtask } : {},
    });
    await this.patchRun({
      status: "running",
      current_step: step_name,
      current_step_label: label,
      current_action_message: message ?? `Running ${label}…`,
      current_subtask: subtask ?? null,
    });
    await this.syncEbook({
      canonical_status: STEP_TO_CANONICAL[step_name] ?? "production_running",
      current_step: step_name,
      current_step_label: label,
      current_action_message: message ?? `Running ${label}…`,
      current_subtask: subtask ?? null,
    });
  }

  /**
   * Live progress heartbeat inside a step — updates current_action_message,
   * current_subtask, and last_heartbeat_at so the overview never goes stale.
   * Call after every subtask (chapter written, page rendered, asset uploaded).
   */
  async heartbeat(step_name: string, patch: {
    message?: string;
    subtask?: string;
    subtask_index?: number;
    subtask_total?: number;
    progress_percent?: number;   // step-local sub-progress (0-100)
  }) {
    const stepMeta: Record<string, unknown> = {};
    if (patch.subtask !== undefined) stepMeta.current_subtask = patch.subtask;
    if (patch.subtask_index !== undefined) stepMeta.subtask_index = patch.subtask_index;
    if (patch.subtask_total !== undefined) stepMeta.subtask_total = patch.subtask_total;
    if (patch.progress_percent !== undefined) stepMeta.step_progress_percent = patch.progress_percent;

    const stepPatch: Record<string, unknown> = {};
    if (patch.message !== undefined) stepPatch.message = patch.message;
    if (Object.keys(stepMeta).length) stepPatch.metadata_json = stepMeta;
    if (Object.keys(stepPatch).length) await this.patchStep(step_name, stepPatch);

    const runPatch: Record<string, unknown> = {};
    if (patch.message !== undefined) runPatch.current_action_message = patch.message;
    if (patch.subtask !== undefined) runPatch.current_subtask = patch.subtask;
    await this.patchRun(runPatch);
    if (patch.message !== undefined || patch.subtask !== undefined) {
      await this.syncEbook({
        current_action_message: patch.message ?? undefined,
        current_subtask: patch.subtask ?? undefined,
      });
    } else {
      await this.syncEbook({}); // just refresh heartbeat
    }
  }

  async updateStep(step_name: string, patch: {
    message?: string;
    subtask?: string;
    score?: number | null;
    required_score?: number | null;
    auto_fix_attempts?: number;
    metadata?: Record<string, unknown>;
  }) {
    const updates: Record<string, unknown> = {};
    if (patch.message !== undefined) updates.message = patch.message;
    if (patch.score !== undefined) updates.score = patch.score;
    if (patch.required_score !== undefined) updates.required_score = patch.required_score;
    if (patch.auto_fix_attempts !== undefined) updates.auto_fix_attempts = patch.auto_fix_attempts;
    const meta = { ...(patch.metadata ?? {}) };
    if (patch.subtask !== undefined) (meta as Record<string, unknown>).current_subtask = patch.subtask;
    if (Object.keys(meta).length) updates.metadata_json = meta;
    if (Object.keys(updates).length) await this.patchStep(step_name, updates);
    const runPatch: Record<string, unknown> = {};
    if (patch.message !== undefined) runPatch.current_action_message = patch.message;
    if (patch.subtask !== undefined) runPatch.current_subtask = patch.subtask;
    if (Object.keys(runPatch).length) await this.patchRun(runPatch);
  }

  async markAutoFixing(step_name: string, attempt: number, max: number, reason?: string, action?: string) {
    const label = this.label(step_name);
    const msg = `Auto-fixing failed QC gate…`;
    const subtask = `Repairing ${label.replace(/^Running\s+/, "").toLowerCase()} — attempt ${attempt}/${max}${reason ? ` (${reason.slice(0, 100)})` : ""}${action ? ` · ${action}` : ""}`;
    await this.patchStep(step_name, {
      status: "auto_fixing",
      auto_fix_attempts: attempt,
      max_auto_fix_attempts: max,
      message: msg,
      error_message: reason ?? null,
      metadata_json: { current_subtask: subtask, auto_fix_attempt: attempt, auto_fix_max: max },
    });
    await this.patchRun({
      status: "auto_fixing",
      current_step: step_name,
      current_step_label: label,
      current_action_message: msg,
      current_subtask: subtask,
    });
    await this.syncEbook({
      canonical_status: "auto_fixing",
      current_step: step_name,
      current_step_label: label,
      current_action_message: msg,
      current_subtask: subtask,
      auto_fix_attempts: attempt,
    });
  }

  async passStep(step_name: string, opts: { message?: string; score?: number | null } = {}) {
    const started = this.startTs.get(step_name);
    const duration = started ? Date.now() - started : null;
    await this.patchStep(step_name, {
      status: "passed",
      message: opts.message ?? `${this.label(step_name)} ✓`,
      score: opts.score ?? null,
      completed_at: new Date().toISOString(),
      duration_ms: duration,
    });
    const pct = await this.progress();
    await this.patchRun({ progress_percent: pct, status: "running" });
    await this.syncEbook({ progress_pct: pct });
  }

  async failStep(step_name: string, error: string) {
    await this.patchStep(step_name, {
      status: "failed",
      error_message: error.slice(0, 800),
      message: `${this.label(step_name)} failed: ${error.slice(0, 200)}`,
      completed_at: new Date().toISOString(),
    });
    await this.patchRun({
      status: "failed",
      failed_at: new Date().toISOString(),
      error_message: error.slice(0, 800),
      current_action_message: `${this.label(step_name)} failed.`,
    });
    await this.syncEbook({
      canonical_status: "failed_non_recoverable",
      current_action_message: `${this.label(step_name)} failed.`,
      blocker_reason: error.slice(0, 200),
    });
  }

  async needsAdmin(step_name: string, reason: string, recommended?: string) {
    await this.patchStep(step_name, {
      status: "needs_admin",
      error_message: reason.slice(0, 800),
      message: `Needs admin: ${reason.slice(0, 200)}`,
      completed_at: new Date().toISOString(),
    });
    await this.patchRun({
      status: "needs_admin",
      admin_needed_reason: [reason, recommended ? `Recommended: ${recommended}` : null].filter(Boolean).join(" "),
      current_action_message: `Needs admin attention at ${this.label(step_name)}`,
    });
    await this.syncEbook({
      canonical_status: "needs_admin_attention",
      needs_review_reason: reason.slice(0, 400),
      current_action_message: `Needs admin attention at ${this.label(step_name)}`,
    });
  }


  async skipStep(step_name: string, message?: string, opts: { existing?: boolean } = {}) {
    const existing = !!opts.existing;
    await this.patchStep(step_name, {
      status: existing ? "passed_existing" : "skipped",
      message: message ?? (existing
        ? `${this.label(step_name)} — existing output found`
        : `${this.label(step_name)} skipped`),
      completed_at: new Date().toISOString(),
    });
    const pct = await this.progress();
    await this.patchRun({ progress_percent: pct });
  }

  async complete(summary: Record<string, unknown> = {}) {
    await this.passStep("complete", { message: "Pipeline complete" });
    await this.patchRun({
      status: "completed",
      completed_at: new Date().toISOString(),
      progress_percent: 100,
      current_action_message: "Pipeline complete",
      summary_json: summary,
    });
    await this.syncEbook({
      canonical_status: "completed",
      progress_pct: 100,
      current_action_message: "Pipeline complete",
      blocker_reason: null,
      blocker_class: null,
    });
  }


  async isPauseRequested(): Promise<boolean> {
    const { data } = await this.db
      .from("autopilot_pipeline_runs")
      .select("pause_requested")
      .eq("id", this.runId)
      .maybeSingle();
    return !!data?.pause_requested;
  }

  async markPaused() {
    await this.patchRun({ status: "paused", current_action_message: "Paused after current step" });
  }
}
