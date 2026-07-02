import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Canonical pipeline statuses surfaced in the admin UI.
export type EbookBadgeKind =
  | "ready" | "writing" | "auto_fixing" | "repairing_dependency"
  | "waiting_for_shopify_quota" | "waiting_for_ai_budget" | "waiting_for_worker_slot"
  | "waiting_for_browserless_slot" | "queued_for_production"
  | "production_running" | "rendering_pdf"
  | "draft_upload_queued"
  | "qc_failed" | "needs_review" | "needs_admin_attention"
  | "draft_uploaded" | "published" | "rejected" | "paused"
  | "failed" | "failed_non_recoverable" | "idle" | "queued";

const STYLES: Record<EbookBadgeKind, { label: string; cls: string }> = {
  ready:                        { label: "Ready",                       cls: "bg-emerald-100 text-emerald-900 border-emerald-700" },
  writing:                      { label: "Writing",                     cls: "bg-sky-100 text-sky-900 border-sky-700" },
  auto_fixing:                  { label: "Auto-Fixing",                 cls: "bg-blue-100 text-blue-900 border-blue-700" },
  repairing_dependency:         { label: "Repairing Dependency",        cls: "bg-blue-100 text-blue-900 border-blue-700" },
  waiting_for_shopify_quota:    { label: "Waiting for Shopify Quota",   cls: "bg-cyan-100 text-cyan-900 border-cyan-700" },
  waiting_for_ai_budget:        { label: "Waiting for AI Budget",       cls: "bg-cyan-100 text-cyan-900 border-cyan-700" },
  waiting_for_worker_slot:      { label: "Waiting for Worker",          cls: "bg-cyan-100 text-cyan-900 border-cyan-700" },
  waiting_for_browserless_slot: { label: "Waiting for Browserless",     cls: "bg-cyan-100 text-cyan-900 border-cyan-700" },
  queued_for_production:        { label: "Queued for Production",       cls: "bg-slate-100 text-slate-900 border-slate-600" },
  production_running:           { label: "Production Running",          cls: "bg-sky-100 text-sky-900 border-sky-700" },
  rendering_pdf:                { label: "Rendering PDF",               cls: "bg-sky-100 text-sky-900 border-sky-700" },
  draft_upload_queued:          { label: "Draft Upload Queued",         cls: "bg-indigo-100 text-indigo-900 border-indigo-700" },
  qc_failed:                    { label: "QC Failed",                   cls: "bg-amber-100 text-amber-900 border-amber-700" },
  needs_review:                 { label: "Needs Review",                cls: "bg-orange-100 text-orange-900 border-orange-700" },
  needs_admin_attention:        { label: "Needs Admin Attention",       cls: "bg-orange-200 text-orange-950 border-orange-800" },
  draft_uploaded:               { label: "Draft Uploaded",              cls: "bg-violet-100 text-violet-900 border-violet-700" },
  published:                    { label: "Published",                   cls: "bg-emerald-200 text-emerald-950 border-emerald-800" },
  rejected:                     { label: "Rejected",                    cls: "bg-rose-100 text-rose-900 border-rose-700" },
  paused:                       { label: "Paused",                      cls: "bg-yellow-100 text-yellow-900 border-yellow-700" },
  failed:                       { label: "Failed",                      cls: "bg-red-100 text-red-900 border-red-700" },
  failed_non_recoverable:       { label: "Failed (config)",             cls: "bg-red-200 text-red-950 border-red-800" },
  idle:                         { label: "Idle",                        cls: "bg-muted text-muted-foreground border-foreground/20" },
  queued:                       { label: "Queued",                      cls: "bg-slate-100 text-slate-900 border-slate-600" },
};

// Maps the raw autopilot_state / shopify_status to a single display kind.
export function resolveEbookBadge(e: {
  autopilot_state?: string | null;
  shopify_status?: string | null;
  manuscript_qc_status?: string | null;
  pdf_status?: string | null;
  blocker_class?: string | null;
}): EbookBadgeKind {
  const s = e.autopilot_state ?? "idle";
  if (e.shopify_status === "published") return "published";
  if (s === "waiting_for_shopify_quota") return "waiting_for_shopify_quota";
  if (s === "waiting_for_ai_budget") return "waiting_for_ai_budget";
  if (s === "waiting_for_worker_slot") return "waiting_for_worker_slot";
  if (s === "waiting_for_browserless_slot") return "waiting_for_browserless_slot";
  if (s === "queued_for_production") return "queued_for_production";
  if (s === "production_running") return "production_running";
  if (s === "rendering_pdf") return "rendering_pdf";
  if (s === "auto_fixing") return "auto_fixing";
  if (s === "repairing_dependency") return "repairing_dependency";
  if (s === "draft_upload_queued") return "draft_upload_queued";
  if (s === "needs_admin_attention") return "needs_admin_attention";
  if (s === "failed_non_recoverable") return "failed_non_recoverable";
  if (s === "rejected") return "rejected";
  if (s === "failed") return e.blocker_class === "non_recoverable_config_error" ? "failed_non_recoverable" : "failed";
  if (s === "needs_review") {
    if (e.manuscript_qc_status === "needs_review" || e.pdf_status === "needs_review") return "qc_failed";
    return "needs_review";
  }
  if (s === "awaiting_cover_approval" || s === "awaiting_pdf_approval") return "needs_review";
  if (s === "ready_to_publish") return e.shopify_status === "draft" ? "draft_uploaded" : "ready";
  if (s === "done") return "published";
  if (s === "running" || s.startsWith("writing") || ["outline", "qc_topic", "qc_outline", "qc_editorial", "product_copy", "cover", "build_pdf"].includes(s)) return "writing";
  return "idle";
}


export function StatusBadge({ kind, className }: { kind: EbookBadgeKind; className?: string }) {
  const cfg = STYLES[kind] ?? STYLES.idle;
  return (
    <Badge variant="outline" className={cn("border-2 font-mono text-[10px] uppercase tracking-wide", cfg.cls, className)}>
      {cfg.label}
    </Badge>
  );
}

export const BADGE_OPTIONS: { value: EbookBadgeKind; label: string }[] = [
  { value: "ready", label: "Ready" },
  { value: "writing", label: "Writing" },
  { value: "qc_failed", label: "QC Failed" },
  { value: "needs_review", label: "Needs Review" },
  { value: "draft_uploaded", label: "Draft Uploaded" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "failed", label: "Failed" },
];
