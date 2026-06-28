import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, AlertTriangle, ShieldCheck, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type AutoFixChipState = {
  id: string;
  qc_status: string | null;
  failed_gate: string | null;
  failed_score: number | null;
  required_score: number | null;
  auto_fix_attempt_count: number | null;
  max_auto_fix_attempts: number | null;
  last_auto_fix_action: string | null;
};

/**
 * Compact one-line auto-fix indicator for list rows.
 * Detailed controls live on the job detail page (FinalApproval / AutoFixPanel).
 */
export function AutoFixChip({ ebook, onChanged }: { ebook: AutoFixChipState; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const status = ebook.qc_status ?? "qc_pending";
  const attempts = ebook.auto_fix_attempt_count ?? 0;
  const max = ebook.max_auto_fix_attempts ?? 3;

  // Map status -> visual.
  const visual = (() => {
    if (status === "auto_fixing") {
      return { label: `Auto-fixing ${attempts}/${max}`, tone: "info" as const, icon: Loader2, spin: true };
    }
    if (status === "needs_admin_review" || status === "auto_fix_failed") {
      return { label: "Needs review", tone: "err" as const, icon: AlertTriangle };
    }
    if ((status === "ready_to_continue" || status === "qc_passed") && attempts > 0) {
      return { label: "Auto-fixed", tone: "ok" as const, icon: ShieldCheck };
    }
    if (status === "ready_to_continue" || status === "qc_passed") {
      return { label: "QC pass", tone: "ok" as const, icon: ShieldCheck };
    }
    return null;
  })();

  if (!visual) return null;

  const Icon = visual.icon;
  const toneClass =
    visual.tone === "err"
      ? "border-destructive text-destructive bg-destructive/10"
      : visual.tone === "ok"
      ? "border-green-600 text-green-700 bg-green-50"
      : "border-foreground/30 text-foreground bg-muted/40";

  const quickFix = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("autofix-action", {
        body: { ebook_id: ebook.id, action: "retry" },
      });
      if (error) throw error;
      const errMsg = (data as { error?: string } | null)?.error;
      if (errMsg) throw new Error(errMsg);
      toast.success("Auto-fix retry queued");
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className={`gap-1 ${toneClass}`}>
        <Icon className={`size-3 ${visual.spin ? "animate-spin" : ""}`} />
        {visual.label}
      </Badge>
      {(status === "needs_admin_review" || status === "auto_fix_failed") && (
        <>
          {ebook.failed_gate && (
            <span className="text-[11px] text-muted-foreground font-mono">
              {ebook.failed_gate}
              {ebook.failed_score != null && ebook.required_score != null
                ? ` ${ebook.failed_score}/${ebook.required_score}`
                : ""}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              quickFix();
            }}
            disabled={busy}
            title="Run Auto-Fix Now"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          </Button>
          <Link to={`/admin/ebook/${ebook.id}`}>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" title="Open detail to edit / regenerate / reject">
              <Wrench className="size-3" />
            </Button>
          </Link>
        </>
      )}
    </div>
  );
}
