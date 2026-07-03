// Premium-ebook-master QC Gate Card.
// Shows Formatter QC / Reader QC / Cover PDF / Cover Thumbnail scores
// against the required pass targets so the admin knows at a glance
// whether an ebook is ready for Shopify upload.
import { useState } from "react";
import { CheckCircle2, XCircle, MinusCircle, RotateCw, Wand2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface GateResult {
  score: number | null;
  pass: boolean;
  target: number;
  status?: string | null;
  attempts?: number | null;
  breakdown?: Record<string, number | null>;
}

export interface QcGateReport {
  formatter: GateResult;
  reader: GateResult;
  cover_pdf: GateResult;
  cover_thumb: GateResult;
  ready_for_shopify: boolean;
  blocking_gates: string[];
  missing_gates: string[];
}

export interface ReRenderInfo {
  count: number;
  reason: string | null;
  last_at: string | null;
}

const GATE_LABEL: Record<string, { en: string; th: string }> = {
  formatter: { en: "Formatter QC", th: "จัดหน้า" },
  reader: { en: "Reader QC", th: "ผู้อ่าน" },
  cover_pdf: { en: "Cover PDF (A4)", th: "หน้าปก PDF" },
  cover_thumb: { en: "Cover Thumbnail", th: "หน้าปก Mockup" },
};

function GateRow({
  name,
  gate,
  isMissing,
}: {
  name: keyof QcGateReport;
  gate: GateResult;
  isMissing: boolean;
}) {
  const label = GATE_LABEL[name as string];
  const score = gate.score;
  const scoreText = score == null ? "—" : String(Math.round(score));
  const statusIcon = isMissing ? (
    <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />
  ) : gate.pass ? (
    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
  ) : (
    <XCircle className="h-3.5 w-3.5 text-destructive" />
  );
  return (
    <div className="flex items-center gap-2 text-xs">
      {statusIcon}
      <span className="flex-1 truncate">
        <span className="font-medium">{label.en}</span>
        <span className="text-muted-foreground"> · {label.th}</span>
      </span>
      <span
        className={
          isMissing
            ? "text-muted-foreground font-mono"
            : gate.pass
            ? "text-emerald-700 dark:text-emerald-400 font-mono"
            : "text-destructive font-mono"
        }
      >
        {scoreText} / {gate.target}
      </span>
      {name === "reader" && gate.attempts && gate.attempts > 0 && (
        <span className="text-[10px] text-muted-foreground">
          fix {gate.attempts}
        </span>
      )}
    </div>
  );
}

export function QcGateCard({
  qc,
  reRender,
  compact = false,
  ebookId,
}: {
  qc: QcGateReport | null | undefined;
  reRender?: ReRenderInfo | null;
  compact?: boolean;
  ebookId?: string;
}) {
  const [fixing, setFixing] = useState<string | null>(null);
  if (!qc) return null;

  async function autoFix(gate: "any" | "reader" | "cover_pdf" | "cover_thumb" | "formatter") {
    if (!ebookId) return;
    setFixing(gate);
    try {
      const { data, error } = await supabase.functions.invoke("autofix-action", {
        body: { ebook_id: ebookId, action: "autofix_gate", gate },
      });
      if (error) throw error;
      toast.success(`Auto Fix เริ่มแล้ว · ${gate}`, {
        description: (data as { gate?: string } | null)?.gate ?? gate,
      });
    } catch (e) {
      toast.error("Auto Fix ล้มเหลว", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setFixing(null);
    }
  }

  const gateNames: (keyof QcGateReport)[] = [
    "formatter",
    "reader",
    "cover_pdf",
    "cover_thumb",
  ];

  const ready = qc.ready_for_shopify;
  const blockingLabels = qc.blocking_gates
    .map((g) => GATE_LABEL[g]?.en ?? g)
    .join(", ");

  return (
    <div
      className={
        "rounded-md border p-2.5 space-y-1.5 " +
        (ready
          ? "border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/10"
          : "border-border/60 bg-muted/30")
      }
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">
          QC Gates
        </span>
        {ready ? (
          <Badge className="bg-emerald-600 text-white text-[10px] gap-1">
            <CheckCircle2 className="h-3 w-3" />
            พร้อมอัพ Shopify · Ready
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] gap-1 border-destructive/50 text-destructive">
            <XCircle className="h-3 w-3" />
            ยังไม่ผ่าน · Blocked
          </Badge>
        )}
      </div>
      {!compact && (
        <div className="grid grid-cols-1 gap-1">
          {gateNames.map((n) => (
            <GateRow
              key={n}
              name={n}
              gate={qc[n] as GateResult}
              isMissing={qc.missing_gates.includes(n as string)}
            />
          ))}
        </div>
      )}
      {!ready && blockingLabels && (
        <div className="pt-1 border-t space-y-1.5">
          <div className="text-[11px] text-destructive/90">
            ติดที่: {blockingLabels}
          </div>
          {ebookId && (
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="destructive"
                className="h-6 px-2 text-[10px] gap-1"
                disabled={!!fixing}
                onClick={() => autoFix("any")}
              >
                {fixing === "any" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                Auto Fix ทันที
              </Button>
              {qc.blocking_gates.map((g) => {
                const key = g as "reader" | "cover_pdf" | "cover_thumb" | "formatter";
                const label = GATE_LABEL[g]?.en ?? g;
                return (
                  <Button
                    key={g}
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px] gap-1"
                    disabled={!!fixing}
                    onClick={() => autoFix(key)}
                  >
                    {fixing === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    Fix {label}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {reRender && reRender.count > 0 && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 pt-0.5 border-t">
          <RotateCw className="h-3 w-3 mt-0.5 shrink-0 animate-spin-slow" />
          <span>
            <span className="font-medium">Re-rendering ×{reRender.count}</span>
            {reRender.reason ? ` — ${reRender.reason}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
