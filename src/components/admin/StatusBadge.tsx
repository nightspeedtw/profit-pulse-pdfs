import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Canonical pipeline statuses surfaced in the admin UI.
export type EbookBadgeKind =
  | "ready" | "writing" | "qc_failed" | "needs_review"
  | "draft_uploaded" | "published" | "rejected" | "paused"
  | "failed" | "idle" | "queued";

const STYLES: Record<EbookBadgeKind, { label: string; cls: string }> = {
  ready:           { label: "Ready",          cls: "bg-emerald-100 text-emerald-900 border-emerald-700" },
  writing:         { label: "Writing",        cls: "bg-sky-100 text-sky-900 border-sky-700" },
  qc_failed:       { label: "QC Failed",      cls: "bg-amber-100 text-amber-900 border-amber-700" },
  needs_review:    { label: "Needs Review",   cls: "bg-orange-100 text-orange-900 border-orange-700" },
  draft_uploaded:  { label: "Draft Uploaded", cls: "bg-violet-100 text-violet-900 border-violet-700" },
  published:       { label: "Published",      cls: "bg-emerald-200 text-emerald-950 border-emerald-800" },
  rejected:        { label: "Rejected",       cls: "bg-rose-100 text-rose-900 border-rose-700" },
  paused:          { label: "Paused",         cls: "bg-yellow-100 text-yellow-900 border-yellow-700" },
  failed:          { label: "Failed",         cls: "bg-red-100 text-red-900 border-red-700" },
  idle:            { label: "Idle",           cls: "bg-muted text-muted-foreground border-foreground/20" },
  queued:          { label: "Queued",         cls: "bg-slate-100 text-slate-900 border-slate-600" },
};

// Maps the raw autopilot_state / shopify_status to a single display kind.
export function resolveEbookBadge(e: {
  autopilot_state?: string | null;
  shopify_status?: string | null;
  manuscript_qc_status?: string | null;
  pdf_status?: string | null;
}): EbookBadgeKind {
  const s = e.autopilot_state ?? "idle";
  if (e.shopify_status === "published") return "published";
  if (s === "rejected") return "rejected";
  if (s === "failed") return "failed";
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
