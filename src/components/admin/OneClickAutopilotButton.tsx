// One-Click Autopilot — Phase 1 Self-Healing entry point.
//
// Flow:
//   1. Call preflight-check.
//   2. If blocked → show admin actions.
//   3. If ready → POST autopilot-pipeline with { mode: "full" }.
//   4. Live status is rendered by AutopilotStatusCenter / LiveProductionQueue.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Rocket, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface PreflightReport {
  ready: boolean;
  blocking_errors: Array<{ code: string; detail: string; admin_action: string }>;
  warnings: Array<{ code: string; detail: string }>;
  auto_fixed: Array<{ code: string; detail: string }>;
  required_admin_actions: string[];
}

export function OneClickAutopilotButton() {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<PreflightReport | null>(null);

  async function launch() {
    setBusy(true);
    setReport(null);
    try {
      // 1. Preflight
      const { data: pfData, error: pfErr } = await supabase.functions.invoke("preflight-check", {
        body: {},
      });
      if (pfErr) throw pfErr;
      const pf = pfData as PreflightReport;
      setReport(pf);

      if (!pf.ready) {
        toast.error("Preflight blocked — fix required config before starting.");
        return;
      }
      if (pf.auto_fixed?.length) {
        toast.success(`Preflight auto-fixed ${pf.auto_fixed.length} item(s).`);
      }

      // 2. Start pipeline
      const { data: runData, error: runErr } = await supabase.functions.invoke(
        "autopilot-pipeline",
        { body: { mode: "full" } },
      );
      if (runErr) throw runErr;

      if ((runData as any)?.skipped) {
        toast.warning(`Autopilot skipped: ${(runData as any).skipped}`);
      } else {
        toast.success("One-Click Autopilot started — watch the live queue below.");
      }
    } catch (err: any) {
      console.error("[OneClickAutopilot] failed", err);
      toast.error(`Failed to start: ${err?.message ?? String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="h-5 w-5" />
          One-Click Autopilot
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Runs preflight → generates one full ebook end-to-end → publishes it live.
          Recoverable errors self-heal automatically. Only true non-recoverable issues stop the run.
        </p>

        <Button size="lg" onClick={launch} disabled={busy} className="w-full">
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Preparing…
            </>
          ) : (
            <>
              <Rocket className="h-4 w-4 mr-2" />
              Start One Ebook
            </>
          )}
        </Button>

        {report && (
          <div className="space-y-2">
            {report.ready ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Preflight passed</AlertTitle>
                <AlertDescription>
                  {report.auto_fixed.length > 0
                    ? `Auto-fixed: ${report.auto_fixed.map((a) => a.code).join(", ")}`
                    : "All required config present."}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Preflight blocked — {report.blocking_errors.length} issue(s)</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 list-disc list-inside text-sm space-y-1">
                    {report.blocking_errors.map((e) => (
                      <li key={e.code}>
                        <strong>{e.code}</strong> — {e.admin_action}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {report.warnings.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Warnings</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 list-disc list-inside text-xs space-y-1">
                    {report.warnings.map((w) => (
                      <li key={w.code}>
                        {w.code}: {w.detail}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default OneClickAutopilotButton;
