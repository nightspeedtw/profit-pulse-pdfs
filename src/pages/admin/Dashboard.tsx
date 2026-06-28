import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plane, ArrowRight, FlaskConical, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

type FailedJob = {
  id: string;
  type: string;
  status: string;
  error: string | null;
  attempts: number;
  ebook_id: string | null;
  idea_id: string | null;
  created_at: string;
};

type Stats = {
  ideasTotal: number;
  ideasToday: number;
  ebooksWriting: number;
  ebooksReady: number;
  ebooksNeedsReview: number;
  ebooksPublished: number;
  costToday: number;
};

type TestRun = {
  status: "idle" | "starting" | "running" | "ready" | "failed";
  message: string;
  ideaId?: string;
  ebookId?: string;
  ebookState?: string | null;
  startedAt?: number;
} | null;

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    ideasTotal: 0, ideasToday: 0, ebooksWriting: 0, ebooksReady: 0,
    ebooksNeedsReview: 0, ebooksPublished: 0, costToday: 0,
  });
  const [generating, setGenerating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRun, setTestRun] = useState<TestRun>(null);
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);

  const load = async () => {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const [
      { count: ideasTotal },
      { count: ideasToday },
      { count: ebooksWriting },
      { count: ebooksReady },
      { count: ebooksNeedsReview },
      { count: ebooksPublished },
      { data: costs },
    ] = await Promise.all([
      supabase.from("ebook_ideas").select("id", { count: "exact", head: true }),
      supabase.from("ebook_ideas").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()),
      supabase.from("ebooks").select("id", { count: "exact", head: true }).like("autopilot_state", "writing%"),
      supabase.from("ebooks").select("id", { count: "exact", head: true }).eq("autopilot_state", "ready_to_publish"),
      supabase.from("ebooks").select("id", { count: "exact", head: true }).eq("autopilot_state", "needs_review"),
      supabase.from("ebooks").select("id", { count: "exact", head: true }).eq("shopify_status", "published"),
      supabase.from("cost_log").select("cost_usd").gte("created_at", since.toISOString()),
    ]);
    setStats({
      ideasTotal: ideasTotal ?? 0,
      ideasToday: ideasToday ?? 0,
      ebooksWriting: ebooksWriting ?? 0,
      ebooksReady: ebooksReady ?? 0,
      ebooksNeedsReview: ebooksNeedsReview ?? 0,
      ebooksPublished: ebooksPublished ?? 0,
      costToday: (costs ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
    });
    const { data: jobs } = await supabase
      .from("generation_jobs")
      .select("id,type,status,error,attempts,ebook_id,idea_id,created_at")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(10);
    setFailedJobs((jobs ?? []) as FailedJob[]);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  // Poll active test run progress
  useEffect(() => {
    if (!testRun?.ideaId || testRun.status === "ready" || testRun.status === "failed") return;
    let cancelled = false;
    const tick = async () => {
      const { data: eb } = await supabase
        .from("ebooks")
        .select("id, autopilot_state, autopilot_error")
        .eq("source_idea_id", testRun.ideaId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (eb) {
        const state = eb.autopilot_state ?? "queued";
        const done = state === "ready_to_publish" || state === "needs_review" || state === "published";
        setTestRun((prev) => prev ? {
          ...prev,
          status: done ? "ready" : (eb.autopilot_error ? "failed" : "running"),
          message: eb.autopilot_error ?? `State: ${state}`,
          ebookId: eb.id,
          ebookState: state,
        } : prev);
      }
    };
    tick();
    const t = setInterval(tick, 5_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [testRun?.ideaId, testRun?.status]);

  const generateNow = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-idea", { body: {} });
      if (error) throw error;
      toast.success(`Generated ${data?.created ?? 0} idea(s).`);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const runSampleTest = async () => {
    setTesting(true);
    setTestRun({ status: "starting", message: "Creating fixture idea…" });
    try {
      const { data, error } = await supabase.functions.invoke("test-sample-pdf", { body: {} });
      if (error) throw error;
      const ideaId = data?.idea_id as string | undefined;
      setTestRun({ status: "running", message: "Pipeline started. Polling…", ideaId, startedAt: Date.now() });
      toast.success(data?.message ?? "Test pipeline started");
      load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Test failed to start";
      setTestRun({ status: "failed", message: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  const retryJob = async (id: string) => {
    const { error } = await supabase
      .from("generation_jobs")
      .update({ status: "queued", attempts: 0, error: null, scheduled_for: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Job requeued"); load(); }
  };

  const tiles: { label: string; value: number | string; tone?: string }[] = [
    { label: "Ideas (total)", value: stats.ideasTotal },
    { label: "Ideas (today)", value: stats.ideasToday },
    { label: "Writing", value: stats.ebooksWriting, tone: "text-blue-700" },
    { label: "Ready to publish", value: stats.ebooksReady, tone: "text-green-700" },
    { label: "Needs review", value: stats.ebooksNeedsReview, tone: "text-orange-700" },
    { label: "Published", value: stats.ebooksPublished, tone: "text-green-800" },
    { label: "AI cost (today)", value: `$${stats.costToday.toFixed(4)}` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs">[ Overview ]</p>
          <h1 className="font-display text-4xl uppercase">Dashboard</h1>
        </div>
        <div className="flex gap-2">
          <Button onClick={runSampleTest} disabled={testing} variant="outline">
            {testing ? <Loader2 className="size-4 animate-spin mr-1" /> : <FlaskConical className="size-4 mr-1" />}
            Test sample PDF
          </Button>
          <Button onClick={generateNow} disabled={generating} variant="outline">
            {generating ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
            Generate ideas now
          </Button>
          <Link to="/admin/autopilot">
            <Button><Plane className="size-4 mr-1" /> Open Autopilot</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {tiles.map((t) => (
          <Card key={t.label} className="border-2 border-foreground">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase text-muted-foreground">{t.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`font-display text-3xl ${t.tone ?? ""}`}>{t.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-2 border-foreground">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Autopilot pipeline</span>
            <Link to="/admin/autopilot" className="text-xs font-mono uppercase hover:underline flex items-center gap-1">
              Manage <ArrowRight className="size-3" />
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>QC gates at every step: topic → outline → chapters → editorial → product copy → cover → PDF → Shopify draft → publish.</p>
          <p>Publish thresholds: Final ≥ 90 · Conversion ≥ 85 · Compliance Safety ≥ 90.</p>
          <p>Open the <strong>Autopilot</strong> page to set daily quota, schedule publishing, and enable hands-off mode.</p>
        </CardContent>
      </Card>

      <Card className="border-2 border-foreground">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-orange-600" />
              Failed background jobs
            </span>
            <Badge variant={failedJobs.length > 0 ? "destructive" : "secondary"}>
              {failedJobs.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {failedJobs.length === 0 ? (
            <p className="text-muted-foreground">No failed jobs. Pipeline is healthy.</p>
          ) : (
            <div className="space-y-2">
              {failedJobs.map((j) => (
                <div key={j.id} className="flex items-start justify-between gap-3 border border-foreground/20 rounded p-3 bg-orange-50/30">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs uppercase font-bold">{j.type}</span>
                      <Badge variant="outline" className="text-xs">attempts: {j.attempts}</Badge>
                      {j.ebook_id && (
                        <Link to={`/admin/ebooks/${j.ebook_id}`} className="text-xs underline">
                          ebook ↗
                        </Link>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(j.created_at).toLocaleString()}
                      </span>
                    </div>
                    {j.error && (
                      <p className="text-xs text-red-700 mt-1 line-clamp-2 break-words">{j.error}</p>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => retryJob(j.id)}>
                    Retry
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
