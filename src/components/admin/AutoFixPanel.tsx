import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, ShieldCheck, X, Wrench, Edit3, AlertTriangle, History } from "lucide-react";
import { toast } from "sonner";

export interface AutoFixState {
  qc_status?: string | null;
  failed_gate?: string | null;
  failed_component?: string | null;
  failed_score?: number | null;
  required_score?: number | null;
  auto_fix_attempt_count?: number | null;
  max_auto_fix_attempts?: number | null;
  last_auto_fix_action?: string | null;
  admin_review_reason?: string | null;
  next_recommended_action?: string | null;
  blocked_at?: string | null;
  resolved_at?: string | null;
  auto_fix_history?: Array<{
    attempt: number;
    gate: string;
    component?: string | null;
    reason?: string;
    action?: string;
    before?: number | null;
    after?: number | null;
    result: "pass" | "fail";
    at: string;
  }> | null;
}

export function AutoFixPanel({
  ebookId,
  state,
  onChanged,
}: {
  ebookId: string;
  state: AutoFixState;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const status = state.qc_status ?? "qc_pending";
  const attempts = state.auto_fix_attempt_count ?? 0;
  const max = state.max_auto_fix_attempts ?? 3;
  const history = state.auto_fix_history ?? [];

  const call = async (
    action: "retry" | "reset" | "mark_approved" | "reject" | "rebuild_pdf",
    label: string,
  ) => {
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("autofix-action", {
        body: { ebook_id: ebookId, action },
      });
      if (error) throw error;
      const errMsg = (data as { error?: string } | null)?.error;
      if (errMsg) throw new Error(errMsg);
      toast.success(label);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  // Banner content varies by status.
  let banner: { tone: "info" | "warn" | "ok" | "err"; text: string } | null = null;
  if (status === "auto_fixing") {
    banner = { tone: "info", text: `Auto-fixing failed QC gate… attempt ${attempts}/${max}` };
  } else if (status === "ready_to_continue" || status === "qc_passed") {
    banner = attempts > 0
      ? { tone: "ok", text: `Auto-fixed and passed (${attempts} attempt${attempts === 1 ? "" : "s"})` }
      : null;
  } else if (status === "needs_admin_review" || status === "auto_fix_failed") {
    banner = { tone: "err", text: "Needs Admin Review" };
  }

  // Don't render anything if nothing interesting to show.
  if (!banner && history.length === 0 && status === "qc_pending") return null;

  const toneClass =
    banner?.tone === "err"
      ? "border-destructive bg-destructive/10 text-destructive"
      : banner?.tone === "warn"
      ? "border-amber-500 bg-amber-50 text-amber-900"
      : banner?.tone === "ok"
      ? "border-green-600 bg-green-50 text-green-900"
      : "border-foreground/20 bg-muted/40";

  return (
    <div className={`border-2 ${toneClass} p-3 space-y-3`}>
      {banner && (
        <div className="flex items-center gap-2 text-sm font-medium">
          {banner.tone === "err" && <AlertTriangle className="size-4" />}
          {banner.tone === "info" && <Loader2 className="size-4 animate-spin" />}
          {banner.tone === "ok" && <ShieldCheck className="size-4" />}
          <span>{banner.text}</span>
          <Badge variant="outline" className="ml-auto">
            {attempts}/{max} attempts
          </Badge>
        </div>
      )}

      {(status === "needs_admin_review" || status === "auto_fix_failed") && (
        <div className="text-xs space-y-1">
          {state.failed_gate && (
            <div>
              <span className="font-medium">Failed gate:</span> {state.failed_gate}
              {state.failed_component ? ` (${state.failed_component})` : ""}
            </div>
          )}
          {(state.failed_score != null || state.required_score != null) && (
            <div>
              <span className="font-medium">Score:</span> {state.failed_score ?? "—"}{" "}
              <span className="opacity-70">/ required {state.required_score ?? "—"}</span>
            </div>
          )}
          {state.admin_review_reason && (
            <div>
              <span className="font-medium">Reason:</span> {state.admin_review_reason}
            </div>
          )}
          {state.next_recommended_action && (
            <div>
              <span className="font-medium">Recommended:</span> {state.next_recommended_action}
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            className="text-xs flex items-center gap-1 underline decoration-dotted"
          >
            <History className="size-3" />
            {historyOpen ? "Hide" : "Show"} fix history ({history.length})
          </button>
          {historyOpen && (
            <ul className="mt-2 space-y-1 text-xs">
              {history.slice(-10).map((h, i) => (
                <li key={i} className="flex items-start gap-2 border-t border-foreground/10 pt-1">
                  <Badge variant={h.result === "pass" ? "default" : "destructive"} className="shrink-0">
                    #{h.attempt}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div>
                      <span className="font-medium">{h.gate}</span>
                      {h.component ? ` · ${h.component}` : ""} — {h.action ?? "—"}
                    </div>
                    {(h.before != null || h.after != null) && (
                      <div className="opacity-70">
                        score {h.before ?? "—"} → {h.after ?? "—"}
                      </div>
                    )}
                    {h.reason && <div className="opacity-70">{h.reason}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(status === "needs_admin_review" || status === "auto_fix_failed") && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => call("retry", "Auto-fix retry queued")}
            disabled={!!busy}
          >
            {busy === "retry" ? <Loader2 className="size-3 animate-spin mr-1" /> : <RefreshCw className="size-3 mr-1" />}
            Retry Auto-Fix Once
          </Button>
          {state.failed_gate === "pdf_layout" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => call("rebuild_pdf", "Rebuilding PDF…")}
              disabled={!!busy}
            >
              {busy === "rebuild_pdf" ? <Loader2 className="size-3 animate-spin mr-1" /> : <Wrench className="size-3 mr-1" />}
              Regenerate Component
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => toast.info("Open the relevant editor tab to fix manually, then click Retry Auto-Fix Once.")}
            disabled={!!busy}
          >
            <Edit3 className="size-3 mr-1" /> Edit Manually
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => call("reject", "Marked as rejected")}
            disabled={!!busy}
          >
            <X className="size-3 mr-1" /> Reject
          </Button>
          <Button
            size="sm"
            onClick={() => call("mark_approved", "Marked approved manually (audit-logged)")}
            disabled={!!busy}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {busy === "mark_approved" ? <Loader2 className="size-3 animate-spin mr-1" /> : <ShieldCheck className="size-3 mr-1" />}
            Mark Approved Manually
          </Button>
        </div>
      )}
    </div>
  );
}
