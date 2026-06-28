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

export class RunTracker {
  private startTs = new Map<string, number>();

  constructor(public db: Db, public runId: string) {}

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

    const t = new RunTracker(db, data.id);
    await t.passStep("start_run", { message: "Pipeline started" });
    return t;
  }

  private label(name: string) {
    return STEP_MAP.get(name)?.label ?? name;
  }

  private async patchRun(patch: Record<string, unknown>) {
    await this.db
      .from("autopilot_pipeline_runs")
      .update({ ...patch, updated_at: new Date().toISOString() })
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

  async startStep(step_name: string, message?: string) {
    this.startTs.set(step_name, Date.now());
    const label = this.label(step_name);
    await this.patchStep(step_name, {
      status: "running",
      message: message ?? `Running ${label}…`,
      started_at: new Date().toISOString(),
      error_message: null,
    });
    await this.patchRun({
      status: "running",
      current_step: step_name,
      current_step_label: label,
      current_action_message: message ?? `Running ${label}…`,
    });
  }

  async updateStep(step_name: string, patch: {
    message?: string;
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
    if (patch.metadata) updates.metadata_json = patch.metadata;
    if (Object.keys(updates).length) await this.patchStep(step_name, updates);
    if (patch.message) {
      await this.patchRun({ current_action_message: patch.message });
    }
  }

  async markAutoFixing(step_name: string, attempt: number, max: number, reason?: string, action?: string) {
    const label = this.label(step_name);
    const msg = `Auto-fixing ${label} — attempt ${attempt}/${max}${reason ? `. Reason: ${reason}` : ""}${action ? `. Action: ${action}` : ""}`;
    await this.patchStep(step_name, {
      status: "auto_fixing",
      auto_fix_attempts: attempt,
      max_auto_fix_attempts: max,
      message: msg,
      error_message: reason ?? null,
    });
    await this.patchRun({
      status: "auto_fixing",
      current_step: step_name,
      current_step_label: label,
      current_action_message: msg,
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
  }

  async skipStep(step_name: string, message?: string) {
    await this.patchStep(step_name, {
      status: "skipped",
      message: message ?? `${this.label(step_name)} skipped`,
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
