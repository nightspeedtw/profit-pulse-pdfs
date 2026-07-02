import { useMemo, useState } from "react";
import { Copy, Check, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export interface SystemFix {
  id: string;
  title: string;
  detected_problem: string;
  root_cause: string | null;
  error_type: string;
  severity: string;
  affected_files: string[] | null;
  affected_ebook_id: string | null;
  affected_run_id: string | null;
  required_fix: string;
  acceptance_test: string | null;
  lovable_prompt: string;
  status: string;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
}

export function SystemFixCard({ fix }: { fix: SystemFix }) {
  const [copied, setCopied] = useState(false);
  const files = useMemo(
    () => (Array.isArray(fix.affected_files) ? fix.affected_files : []),
    [fix.affected_files],
  );

  const copy = async () => {
    await navigator.clipboard.writeText(fix.lovable_prompt);
    setCopied(true);
    toast.success("Lovable fix prompt copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const severityTone =
    fix.severity === "critical"
      ? "destructive"
      : fix.severity === "high"
        ? "destructive"
        : "secondary";

  return (
    <Card className="border-destructive/40">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-destructive" />
            <CardTitle className="text-base">{fix.title}</CardTitle>
          </div>
          <div className="flex gap-1">
            <Badge variant={severityTone as "destructive" | "secondary"}>{fix.severity}</Badge>
            <Badge variant="outline">{fix.error_type}</Badge>
            {fix.occurrences > 1 && (
              <Badge variant="outline">×{fix.occurrences}</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Section label="Detected problem">{fix.detected_problem}</Section>
        {fix.root_cause && <Section label="Root cause">{fix.root_cause}</Section>}
        {files.length > 0 && (
          <Section label="Affected files">
            <ul className="mt-1 space-y-0.5 font-mono text-xs">
              {files.map((f) => (
                <li key={f}>• {f}</li>
              ))}
            </ul>
          </Section>
        )}
        <Section label="Required fix">
          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed">
            {fix.required_fix}
          </pre>
        </Section>
        {fix.acceptance_test && (
          <Section label="Acceptance test">{fix.acceptance_test}</Section>
        )}
        <div className="flex gap-2 pt-2">
          <Button onClick={copy} variant="destructive" size="sm" className="gap-2">
            {copied ? <Check className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
            {copied ? "Copied — paste into Lovable" : "Fix → Send to Lovable"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
