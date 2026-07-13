// Canonical status → user-facing copy + visual grouping.
// The single source of truth for how a status is rendered in the admin UI.

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
  | "waiting_for_ai_budget"
  | "waiting_for_worker_slot"
  | "draft_uploaded"
  | "completed"
  | "needs_admin_attention"
  | "needs_code_fix"
  | "failed_non_recoverable";

export interface StatusView {
  label: string;
  tone: "neutral" | "info" | "warn" | "success" | "danger" | "pending";
  helper?: string;
}

export function statusView(status?: string | null): StatusView {
  const s = (status ?? "") as CanonicalStatus;
  switch (s) {
    case "idea_generated":
      return { label: "Idea generated", tone: "neutral" };
    case "queued_for_production":
      return { label: "Queued — waiting for production slot", tone: "pending" };
    case "production_running":
    case "generating_outline":
    case "writing_chapters":
    case "building_manuscript":
    case "running_qc":
    case "generating_cover":
    case "generating_thumbnail":
    case "rendering_pdf":
      return { label: prettyHeavy(s), tone: "info" };
    case "auto_fixing":
      return { label: "Auto-fixing", tone: "warn" };
    case "waiting_for_browserless_slot":
      return {
        label: "Waiting for Browserless Slot",
        tone: "warn",
        helper: "Retrying automatically",
      };
    case "waiting_for_ai_budget":
      return { label: "Waiting for AI Budget", tone: "warn", helper: "Retrying automatically" };
    case "waiting_for_worker_slot":
      return { label: "Waiting for Worker Slot", tone: "warn", helper: "Retrying automatically" };
    case "draft_uploaded":
      return { label: "Draft ready", tone: "success" };
    case "completed":
      return { label: "Completed", tone: "success" };
    case "needs_admin_attention":
      return {
        label: "Admin attention required",
        tone: "danger",
        helper: "Cannot be fixed automatically",
      };
    case "needs_code_fix":
      return {
        label: "System code fix required",
        tone: "danger",
        helper: "Lovable instruction generated",
      };
    case "failed_non_recoverable":
      return { label: "Failed (non-recoverable)", tone: "danger" };
    default:
      return { label: status || "Idle", tone: "neutral" };
  }
}

function prettyHeavy(s: CanonicalStatus): string {
  const map: Record<string, string> = {
    production_running: "Producing",
    generating_outline: "Generating outline",
    writing_chapters: "Writing chapters",
    building_manuscript: "Building manuscript",
    running_qc: "Running QC",
    generating_cover: "Generating cover",
    generating_thumbnail: "Generating thumbnail",
    rendering_pdf: "Rendering PDF",
  };
  return map[s] ?? s;
}

export function elapsedSince(iso?: string | null): string {
  if (!iso) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export function untilRetry(iso?: string | null): string {
  if (!iso) return "—";
  const secs = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (secs <= 0) return "any moment";
  if (secs < 60) return `in ${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  return `in ${h}h ${m % 60}m`;
}
