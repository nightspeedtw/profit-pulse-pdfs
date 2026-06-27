import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Play, Pause, RefreshCw, Upload, Rocket, XCircle, FileText, Plane } from "lucide-react";

type Ebook = {
  id: string;
  title: string;
  status: string;
  autopilot_state: string;
  autopilot_mode: string;
  shopify_status: string;
  word_count: number;
  price: number;
  final_quality_score: number | null;
  conversion_score: number | null;
  compliance_safety_score: number | null;
  needs_review_reason: string | null;
  cost_usd: number;
  cover_url: string | null;
  pdf_url: string | null;
  shopify_product_id: string | null;
  updated_at: string;
};

type Idea = { id: string; title: string; status: string; auto_rejected_reason: string | null };

const STATE_STYLES: Record<string, string> = {
  running: "bg-yellow-200 border-yellow-700",
  qc_topic: "bg-yellow-200 border-yellow-700",
  qc_outline: "bg-yellow-200 border-yellow-700",
  writing: "bg-blue-200 border-blue-700",
  qc_editorial: "bg-purple-200 border-purple-700",
  product_copy: "bg-purple-200 border-purple-700",
  cover: "bg-purple-200 border-purple-700",
  build_pdf: "bg-purple-200 border-purple-700",
  shopify_draft: "bg-purple-200 border-purple-700",
  ready_to_publish: "bg-green-200 border-green-700",
  done: "bg-green-300 border-green-800",
  needs_review: "bg-orange-200 border-orange-700",
  rejected: "bg-red-200 border-red-700",
  failed: "bg-red-200 border-red-700",
  idle: "bg-gray-100 border-gray-400",
};

function stateLabel(s: string) {
  if (!s) return "idle";
  if (s.startsWith("writing:")) return s;
  return s.replace(/_/g, " ");
}

function stateColor(s: string) {
  if (!s) return STATE_STYLES.idle;
  if (s.startsWith("writing")) return STATE_STYLES.writing;
  return STATE_STYLES[s] ?? STATE_STYLES.idle;
}

export default function Autopilot() {
  const [ebooks, setEbooks] = useState<Ebook[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [filter, setFilter] = useState<"all" | "running" | "needs_review" | "rejected" | "published">("all");
  const [mode, setMode] = useState<"safe" | "full">("safe");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const [{ data: e }, { data: i }] = await Promise.all([
      supabase.from("ebooks")
        .select("id,title,status,autopilot_state,autopilot_mode,shopify_status,word_count,price,final_quality_score,conversion_score,compliance_safety_score,needs_review_reason,cost_usd,cover_url,pdf_url,shopify_product_id,updated_at")
        .order("updated_at", { ascending: false }).limit(100),
      supabase.from("ebook_ideas")
        .select("id,title,status,auto_rejected_reason")
        .in("status", ["idea", "approved", "rejected"])
        .order("updated_at", { ascending: false }).limit(50),
    ]);
    setEbooks((e ?? []) as Ebook[]);
    setIdeas((i ?? []) as Idea[]);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  async function run(name: string, body: any, msg: string, id: string) {
    setBusy(id);
    try {
      const { data, error } = await supabase.functions.invoke(name, { body });
      if (error || (data as any)?.error) throw new Error(error?.message ?? (data as any).error);
      toast.success(msg);
      await load();
    } catch (err: any) {
      toast.error(err.message ?? "Failed");
    } finally {
      setBusy(null);
    }
  }

  const filtered = ebooks.filter((e) => {
    if (filter === "all") return true;
    if (filter === "running") return ["qc_topic", "qc_outline", "qc_editorial", "product_copy", "cover", "build_pdf", "shopify_draft"].includes(e.autopilot_state) || e.autopilot_state?.startsWith("writing");
    if (filter === "needs_review") return e.autopilot_state === "needs_review" || e.autopilot_state === "ready_to_publish";
    if (filter === "rejected") return ["rejected", "failed"].includes(e.autopilot_state);
    if (filter === "published") return e.autopilot_state === "done" || e.shopify_status === "published";
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs">[ Autopilot ]</p>
          <h1 className="font-display text-4xl uppercase flex items-center gap-3">
            <Plane className="size-8" /> Autopilot Control
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Full A-Z pipeline with automated QC gates. <strong>Safe</strong> uploads as draft only. <strong>Full</strong> auto-publishes if all quality gates pass.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border-2 border-foreground">
            <button
              onClick={() => setMode("safe")}
              className={`px-3 py-1.5 text-xs font-mono uppercase ${mode === "safe" ? "bg-foreground text-background" : "bg-card"}`}
            >Safe</button>
            <button
              onClick={() => setMode("full")}
              className={`px-3 py-1.5 text-xs font-mono uppercase border-l-2 border-foreground ${mode === "full" ? "bg-foreground text-background" : "bg-card"}`}
            >Full</button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "running", "needs_review", "rejected", "published"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs font-mono uppercase border-2 ${filter === f ? "border-foreground bg-highlight" : "border-foreground/30"}`}>
            {f.replace(/_/g, " ")} ({f === "all" ? ebooks.length : ebooks.filter(e => {
              if (f === "running") return ["qc_topic","qc_outline","qc_editorial","product_copy","cover","build_pdf","shopify_draft"].includes(e.autopilot_state) || e.autopilot_state?.startsWith("writing");
              if (f === "needs_review") return e.autopilot_state === "needs_review" || e.autopilot_state === "ready_to_publish";
              if (f === "rejected") return ["rejected","failed"].includes(e.autopilot_state);
              if (f === "published") return e.autopilot_state === "done" || e.shopify_status === "published";
              return false;
            }).length})
          </button>
        ))}
      </div>

      {/* Ideas waiting (start autopilot from here) */}
      {ideas.filter(i => i.status === "approved" || i.status === "idea").length > 0 && (
        <Card className="border-2 border-foreground">
          <CardContent className="p-4 space-y-2">
            <p className="font-mono uppercase text-xs tracking-widest">Ideas ready for autopilot</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {ideas.filter(i => i.status === "approved" || i.status === "idea").slice(0, 12).map(i => (
                <div key={i.id} className="border-2 border-foreground/30 p-3 space-y-2">
                  <p className="text-sm font-medium line-clamp-2">{i.title}</p>
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={busy === i.id}
                    onClick={() => run("autopilot-orchestrator", { idea_id: i.id, mode }, `Autopilot started (${mode})`, i.id)}
                  >
                    <Plane className="size-3 mr-1" /> Launch {mode.toUpperCase()}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ebooks table */}
      <div className="border-2 border-foreground bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-highlight border-b-2 border-foreground">
            <tr className="text-left font-mono uppercase text-xs">
              <th className="p-3">Title</th>
              <th className="p-3">State</th>
              <th className="p-3">Mode</th>
              <th className="p-3">Quality / Conv / Safety</th>
              <th className="p-3">Shopify</th>
              <th className="p-3">Cost</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No ebooks in this view.</td></tr>
            )}
            {filtered.map((e) => (
              <tr key={e.id} className="border-b border-foreground/10 align-top">
                <td className="p-3">
                  <Link to={`/admin/ebook/${e.id}`} className="font-medium hover:underline line-clamp-2">{e.title}</Link>
                  <p className="text-xs text-muted-foreground">{e.word_count.toLocaleString()} words</p>
                  {e.needs_review_reason && (
                    <p className="text-xs text-orange-700 mt-1 line-clamp-2">⚠ {e.needs_review_reason}</p>
                  )}
                </td>
                <td className="p-3">
                  <Badge className={`border-2 ${stateColor(e.autopilot_state)} text-foreground`}>
                    {stateLabel(e.autopilot_state)}
                  </Badge>
                </td>
                <td className="p-3 font-mono text-xs uppercase">{e.autopilot_mode}</td>
                <td className="p-3 text-xs">
                  <span className={e.final_quality_score && e.final_quality_score >= 90 ? "text-green-700 font-bold" : "text-muted-foreground"}>
                    {e.final_quality_score ?? "—"}
                  </span>{" / "}
                  <span className={e.conversion_score && e.conversion_score >= 85 ? "text-green-700 font-bold" : "text-muted-foreground"}>
                    {e.conversion_score ?? "—"}
                  </span>{" / "}
                  <span className={e.compliance_safety_score && e.compliance_safety_score >= 90 ? "text-green-700 font-bold" : "text-muted-foreground"}>
                    {e.compliance_safety_score ?? "—"}
                  </span>
                </td>
                <td className="p-3 text-xs">
                  <Badge variant="outline">{e.shopify_status}</Badge>
                </td>
                <td className="p-3 text-xs font-mono">${Number(e.cost_usd ?? 0).toFixed(3)}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" disabled={busy === e.id}
                      onClick={() => run("autopilot-orchestrator", { ebook_id: e.id, mode }, "Resumed", e.id)}>
                      <RefreshCw className="size-3" />
                    </Button>
                    {e.shopify_product_id && (
                      <Button size="sm" variant="outline" disabled={busy === e.id}
                        onClick={() => run("shopify-publish", { ebook_id: e.id }, "Published", e.id)}>
                        <Rocket className="size-3" />
                      </Button>
                    )}
                    {e.shopify_product_id && (
                      <Button size="sm" variant="outline" disabled={busy === e.id}
                        onClick={() => run("shopify-publish", { ebook_id: e.id, force: true }, "Force-published", e.id)}>
                        <Upload className="size-3" />
                      </Button>
                    )}
                    {e.pdf_url && (
                      <a href={e.pdf_url} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline"><FileText className="size-3" /></Button>
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Auto-refresh every 15s. Quality gates: final ≥ 90, conversion ≥ 85, compliance safety ≥ 90.
        Refresh icon resumes/restarts the pipeline at the next pending step.
        Rocket publishes only if gates pass; Upload forces publish.
      </p>
    </div>
  );
}
