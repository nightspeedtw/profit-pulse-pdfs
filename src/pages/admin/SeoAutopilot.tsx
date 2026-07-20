import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

type Settings = {
  enabled: boolean;
  emergency_stop: boolean;
  publish_mode: "off" | "draft_first" | "auto_publish_when_passed";
  max_public_pages_per_day: number;
  max_draft_pages_per_day: number;
  max_blog_posts_per_day: number;
  max_programmatic_pages_per_day: number;
  require_human_review_for_new_keyword_clusters: boolean;
};

export default function SeoAutopilot() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clusters, setClusters] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  const load = async () => {
    const [s, c, q, a] = await Promise.all([
      supabase.from("seo_autopilot_settings").select("*").eq("id", true).maybeSingle(),
      supabase.from("seo_keyword_clusters").select("*").order("priority", { ascending: false }).limit(200),
      supabase.from("seo_content_queue").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("seo_audit_log").select("*").order("created_at", { ascending: false }).limit(25),
    ]);
    if (s.data) setSettings(s.data as any);
    setClusters(c.data ?? []);
    setQueue(q.data ?? []);
    setAudit(a.data ?? []);
  };
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const g = (st: string) => queue.filter((r) => r.status === st).length;
    return { draft: g("draft"), qa_failed: g("qa_failed"), approved: g("approved"), published: g("published"), paused: g("paused") };
  }, [queue]);

  const saveSetting = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    const { error } = await supabase.from("seo_autopilot_settings").update(patch as any).eq("id", true);
    if (error) toast.error(error.message);
    else toast.success("Saved");
  };

  const invoke = async (name: string, body: any = {}) => {
    setRunning(name);
    try {
      const { data, error } = await supabase.functions.invoke(name, { body });
      if (error) throw error;
      toast.success(`${name}: ${JSON.stringify(data).slice(0, 120)}`);
      await load();
    } catch (e: any) { toast.error(`${name}: ${e.message ?? e}`); }
    finally { setRunning(null); }
  };

  const qaOne = async (id: string) => invoke("seo-content-qa", { queue_ids: [id] });
  const publishOne = async (id: string) => invoke("seo-publish-approved", { queue_ids: [id] });
  const pauseOne = async (id: string) => {
    await supabase.from("seo_content_queue").update({ status: "paused" }).eq("id", id);
    load();
  };

  if (!settings) return <div className="p-6">Loading SEO Autopilot…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display uppercase">SEO / AEO / GEO Autopilot</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => invoke("seo-keyword-seed")} disabled={!!running}>Reseed clusters</Button>
          <Button onClick={() => invoke("seo-autopilot-tick", { force: true })} disabled={!!running}>Run tick now</Button>
        </div>
      </div>

      {/* Settings */}
      <Card>
        <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={settings.enabled} onChange={(e) => saveSetting({ enabled: e.target.checked })} />
            <span>Enabled</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={settings.emergency_stop} onChange={(e) => saveSetting({ emergency_stop: e.target.checked })} />
            <span className="text-destructive font-semibold">Emergency stop (kill switch)</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-muted-foreground">Publish mode</span>
            <select className="border rounded p-2 bg-background" value={settings.publish_mode} onChange={(e) => saveSetting({ publish_mode: e.target.value as any })}>
              <option value="off">off</option>
              <option value="draft_first">draft_first (safe)</option>
              <option value="auto_publish_when_passed">auto_publish_when_passed</option>
            </select>
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={settings.require_human_review_for_new_keyword_clusters} onChange={(e) => saveSetting({ require_human_review_for_new_keyword_clusters: e.target.checked })} />
            <span>Require human review for new clusters</span>
          </label>
          {(["max_draft_pages_per_day","max_blog_posts_per_day","max_public_pages_per_day","max_programmatic_pages_per_day"] as const).map((k) => (
            <label key={k} className="flex items-center gap-3">
              <span className="text-xs uppercase text-muted-foreground w-64">{k.replaceAll("_"," ")}</span>
              <input type="number" min={0} max={100} className="border rounded p-2 w-24 bg-background" value={(settings as any)[k]} onChange={(e) => saveSetting({ [k]: Number(e.target.value) } as any)} />
            </label>
          ))}
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(["draft","qa_failed","approved","published","paused"] as const).map((s) => (
          <Card key={s}><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">{s}</div><div className="text-2xl font-bold">{(stats as any)[s]}</div></CardContent></Card>
        ))}
      </div>

      {/* Queue */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between"><CardTitle>Content queue (latest 50)</CardTitle><span className="text-xs text-muted-foreground">{clusters.length} clusters loaded</span></CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground border-b">
              <tr><th className="text-left p-2">Title</th><th className="p-2">Type</th><th className="p-2">Status</th><th className="p-2">SEO</th><th className="p-2">AEO</th><th className="p-2">GEO</th><th className="p-2">Dup</th><th className="p-2">Words</th><th className="p-2">Findings</th><th className="p-2 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {queue.map((r) => (
                <tr key={r.id} className="border-b hover:bg-muted/30">
                  <td className="p-2 max-w-[320px] truncate"><div className="font-medium truncate">{r.title ?? r.target_slug}</div><div className="text-xs text-muted-foreground truncate">{r.target_slug}</div></td>
                  <td className="p-2 text-center">{r.page_type}</td>
                  <td className="p-2 text-center"><Badge variant={r.status === "approved" || r.status === "published" ? "default" : r.status === "qa_failed" ? "destructive" : "secondary"}>{r.status}</Badge></td>
                  <td className="p-2 text-center">{r.seo_score}</td>
                  <td className="p-2 text-center">{r.aeo_score}</td>
                  <td className="p-2 text-center">{r.geo_score}</td>
                  <td className="p-2 text-center">{r.duplicate_risk_score}</td>
                  <td className="p-2 text-center">{r.word_count}</td>
                  <td className="p-2 text-center">{Array.isArray(r.qa_findings) ? r.qa_findings.length : 0}</td>
                  <td className="p-2 text-right space-x-1">
                    <Button size="sm" variant="outline" onClick={() => qaOne(r.id)} disabled={!!running}>QA</Button>
                    {r.status === "approved" && <Button size="sm" onClick={() => publishOne(r.id)} disabled={!!running}>Publish</Button>}
                    {r.status !== "paused" && <Button size="sm" variant="ghost" onClick={() => pauseOne(r.id)}>Pause</Button>}
                  </td>
                </tr>
              ))}
              {!queue.length && <tr><td className="p-6 text-center text-muted-foreground" colSpan={10}>Queue empty. Run tick to generate drafts.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Audit log */}
      <Card>
        <CardHeader><CardTitle>Audit log (latest 25)</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs font-mono">
          {audit.map((a) => (
            <div key={a.id} className="flex gap-3 border-b py-1">
              <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
              <span className="font-semibold">{a.action}</span>
              <span className="text-muted-foreground truncate">{JSON.stringify(a.after_json ?? {})}</span>
            </div>
          ))}
          {!audit.length && <div className="text-muted-foreground">No audit rows yet.</div>}
        </CardContent>
      </Card>
    </div>
  );
}
