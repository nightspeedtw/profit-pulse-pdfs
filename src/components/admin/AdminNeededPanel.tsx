// AdminNeededPanel — shown ONLY when a job genuinely needs a human decision.
// In hands-off Autopilot there are no "approve" buttons — admin sees this panel
// only after auto-fix has exhausted 3 attempts or a real config/error blocker exists.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, RefreshCw, Wrench, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

export interface AdminNeededState {
  id: string;
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
  auto_fix_history?: Array<{ attempt: number; action?: string; score?: number; ts?: string }> | null;
  autopilot_state?: string | null;
  needs_review_reason?: string | null;
}

interface Props {
  ebook: AdminNeededState;
  onChanged: () => void | Promise<void>;
}

export function AdminNeededPanel({ ebook, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const needsAdmin =
    ebook.qc_status === "needs_admin_review" ||
    ebook.qc_status === "auto_fix_failed" ||
    ebook.autopilot_state === "needs_review" ||
    ebook.autopilot_state === "failed";

  if (!needsAdmin) return null;

  const attempts = ebook.auto_fix_attempt_count ?? 0;
  const maxAttempts = ebook.max_auto_fix_attempts ?? 3;
  const gate = ebook.failed_gate ?? ebook.autopilot_state ?? "unknown";
  const rawReason = ebook.admin_review_reason ?? ebook.needs_review_reason ?? "";
  const exhausted = attempts >= maxAttempts;
  // Detect a recoverable pipeline-dependency issue (e.g. outline missing) so we
  // don't mislabel it as "Auto-fix exhausted" when no auto-fix attempts were used.
  const isDependencyIssue =
    !exhausted &&
    /outline|dependency|missing|no outline|repair/i.test(`${rawReason} ${gate}`);

  let badgeLabel: string;
  let badgeVariant: "destructive" | "default" | "outline" = "destructive";
  let heading = "Admin Needed";
  let reason: string;

  if (isDependencyIssue) {
    heading = "Dependency Repair Needed";
    badgeLabel = "Pipeline dependency repair";
    badgeVariant = "default";
    reason =
      rawReason ||
      "Autopilot detected that a required dependency (likely the outline) is missing. The system is going back to Generate Outline and will resume chapter writing automatically.";
  } else if (exhausted) {
    badgeLabel = "Auto-fix exhausted";
    reason = rawReason || `Auto-fix could not resolve "${gate}" after ${attempts}/${maxAttempts} attempts.`;
  } else {
    badgeLabel = "Pipeline blocked";
    reason = rawReason || `Pipeline blocked on "${gate}".`;
  }

  const history = Array.isArray(ebook.auto_fix_history) ? ebook.auto_fix_history : [];

  async function callAction(action: "retry" | "reset" | "reject" | "rebuild_pdf") {
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("autofix-action", {
        body: { ebook_id: ebook.id, action },
      });
      if (error) throw error;
      const errMsg = (data as { error?: string } | null)?.error;
      if (errMsg) throw new Error(errMsg);
      toast.success(`Action "${action}" sent`);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="border-2 border-orange-700 bg-orange-50/40">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="size-6 text-orange-700 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display text-xl uppercase tracking-wide">{heading}</h2>
              <Badge variant={badgeVariant}>{badgeLabel}</Badge>
              <Badge variant="outline" className="font-mono">{gate}</Badge>
            </div>
            <p className="mt-2 text-sm whitespace-pre-line">{reason}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Stat label="Failed gate" value={gate} />
          <Stat
            label="Score"
            value={
              ebook.failed_score != null
                ? `${ebook.failed_score}${ebook.required_score != null ? ` / ${ebook.required_score}` : ""}`
                : "—"
            }
          />
          <Stat label="Attempts used" value={`${attempts} / ${maxAttempts}`} />
          <Stat label="Last action" value={ebook.last_auto_fix_action ?? "—"} />
        </div>

        {history.length > 0 && (
          <details className="border-2 border-foreground/15 p-3">
            <summary className="cursor-pointer text-xs font-mono uppercase text-muted-foreground">
              What the system tried ({history.length})
            </summary>
            <ol className="mt-2 space-y-1 text-xs">
              {history.map((h, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-mono text-muted-foreground">#{h.attempt ?? i + 1}</span>
                  <span className="flex-1">{h.action ?? "—"}</span>
                  {h.score != null && <span className="font-mono">score {h.score}</span>}
                </li>
              ))}
            </ol>
          </details>
        )}

        {ebook.next_recommended_action && (
          <p className="text-sm border-l-4 border-orange-700 pl-3">
            <span className="font-medium">Recommended:</span> {ebook.next_recommended_action}
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={() => callAction("retry")} disabled={!!busy}>
            {busy === "retry" ? <Loader2 className="size-4 animate-spin mr-1" /> : <RotateCcw className="size-4 mr-1" />}
            Retry Auto-Fix Once
          </Button>
          <Button variant="outline" onClick={() => callAction("rebuild_pdf")} disabled={!!busy}>
            {busy === "rebuild_pdf" ? <Loader2 className="size-4 animate-spin mr-1" /> : <Wrench className="size-4 mr-1" />}
            Regenerate Failed Component
          </Button>
          <Button variant="outline" onClick={() => callAction("reset")} disabled={!!busy}>
            <RefreshCw className="size-4 mr-1" />
            Reset & Resume Pipeline
          </Button>
          <Button variant="destructive" onClick={() => callAction("reject")} disabled={!!busy}>
            <X className="size-4 mr-1" />
            Reject Job
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-foreground/15 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono">{label}</div>
      <div className="text-sm font-medium truncate" title={value}>{value}</div>
    </div>
  );
}
