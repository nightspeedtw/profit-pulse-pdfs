import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Check, Loader2, Circle, ArrowRight } from "lucide-react";
import { FEATURES } from "@/config/features";

type StepState = "pending" | "ready" | "running" | "done";

interface EbookLite {
  status: string;
  updated_at: string;
  cover_url: string | null;
  interior_visuals: unknown | null;
  pdf_url: string | null;
}

interface Props {
  ebook: EbookLite;
  busy: string | null;
  onRun: (fn: string) => void | Promise<void>;
}

// Rough average durations (seconds) for ETA
const ETA = {
  "generate-cover": 60,
  "generate-interior-visuals": 30,
  "build-pdf": 35,
  "render-pdf": 45,
} as const;

function useTick(active: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

function fmt(s: number) {
  if (s <= 0) return "0s";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${r}s`;
}

export function PdfWizard({ ebook, busy, onRun }: Props) {
  const legacy = FEATURES.LEGACY_PIPELINE;
  const runningFn =
    ebook.status === "cover" ? "generate-cover" :
    ebook.status === "visuals" && legacy ? "generate-interior-visuals" :
    ebook.status === "building_pdf" ? (legacy ? "build-pdf" : "render-pdf") :
    ebook.status === "rendering" ? "render-pdf" : null;

  useTick(!!runningFn);

  const coverStep = {
    key: "generate-cover" as const,
    label: "1. Regenerate cover",
    description: "AI background + code-rendered title/subtitle/badge.",
    state: (ebook.status === "cover" ? "running" : ebook.cover_url ? "done" : "ready") as StepState,
    cta: ebook.cover_url ? "Regenerate" : "Generate cover",
  };

  const visualsStep = {
    key: "generate-interior-visuals" as const,
    label: "2. Generate visuals",
    description: "Framework diagrams + worksheets for the PDF interior.",
    state: (
      ebook.status === "visuals" ? "running" :
      ebook.interior_visuals ? "done" :
      ebook.cover_url ? "ready" : "pending"
    ) as StepState,
    cta: ebook.interior_visuals ? "Regenerate visuals" : "Generate visuals",
  };

  const buildStep = {
    key: "build-pdf" as const,
    label: "3. Build PDF",
    description: "Compose cover + chapters + visuals into the final PDF.",
    state: (
      ebook.status === "building_pdf" ? "running" :
      ebook.pdf_url ? "done" :
      ebook.interior_visuals && ebook.cover_url ? "ready" : "pending"
    ) as StepState,
    cta: ebook.pdf_url ? "Rebuild PDF" : "Build PDF",
  };

  const renderStep = {
    key: "render-pdf" as const,
    label: "2. Render final PDF",
    description: "Phase 1 renderer — composes cover, chapters, and worksheets in one pass.",
    state: (
      ebook.status === "building_pdf" || ebook.status === "rendering" ? "running" :
      ebook.pdf_url ? "done" :
      ebook.cover_url ? "ready" : "pending"
    ) as StepState,
    cta: ebook.pdf_url ? "Re-render PDF" : "Render PDF",
  };

  const steps: Array<{
    key: keyof typeof ETA;
    label: string;
    description: string;
    state: StepState;
    cta: string;
  }> = legacy ? [coverStep, visualsStep, buildStep] : [coverStep, renderStep];

  const elapsed = runningFn
    ? Math.max(0, (Date.now() - new Date(ebook.updated_at).getTime()) / 1000)
    : 0;
  const est = runningFn ? ETA[runningFn] : 0;
  const pct = runningFn ? Math.min(95, Math.round((elapsed / est) * 100)) : 0;
  const remaining = runningFn ? Math.max(0, est - elapsed) : 0;
  const stuck = runningFn ? elapsed > est * 3 : false;

  return (
    <Card className="border-2 border-foreground">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>PDF wizard</span>
          {runningFn && (
            <Badge variant={stuck ? "destructive" : "secondary"}>
              {stuck ? "Stalled" : "Working"} · {fmt(elapsed)} / ~{fmt(est)}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {runningFn && (
          <div className="space-y-1">
            <Progress value={pct} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {stuck
                ? `Running for ${fmt(elapsed)} — much longer than the ~${fmt(est)} average. The worker may have stopped; try running the step again.`
                : `≈ ${fmt(remaining)} remaining. This page auto-refreshes.`}
            </p>
          </div>
        )}

        <ol className="space-y-2">
          {steps.map((s, i) => {
            const isBusy = busy === s.key || s.state === "running";
            const disabled =
              !!busy || !!runningFn || s.state === "pending" || s.state === "running";
            return (
              <li
                key={s.key}
                className={`flex items-center gap-3 border-2 p-3 ${
                  s.state === "running"
                    ? "border-foreground bg-muted/40"
                    : s.state === "done"
                    ? "border-foreground/30"
                    : s.state === "ready"
                    ? "border-foreground"
                    : "border-foreground/20 opacity-60"
                }`}
              >
                <div className="shrink-0">
                  {s.state === "done" ? (
                    <Check className="size-5 text-green-600" />
                  ) : s.state === "running" ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : s.state === "ready" ? (
                    <ArrowRight className="size-5" />
                  ) : (
                    <Circle className="size-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.description}</div>
                  {s.state === "running" && (
                    <div className="mt-1 text-xs">
                      {fmt(elapsed)} elapsed · ~{fmt(remaining)} left
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={s.state === "ready" ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onRun(s.key)}
                >
                  {isBusy && <Loader2 className="size-3 animate-spin mr-1" />}
                  {s.cta}
                </Button>
              </li>
            );
          })}
        </ol>

        {steps[steps.length - 1].state === "done" && (
          <p className="text-xs text-muted-foreground pt-1">
            PDF ready — open the Cover & PDF card below to download.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
