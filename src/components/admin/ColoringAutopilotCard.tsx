import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Palette, Play, Save } from "lucide-react";

interface ColoringConfig {
  enabled: boolean;
  topic_mode: "random" | "specific";
  specific_category_key: string | null;
  age_band: "3-5" | "4-6" | "6-8";
  page_count: 24 | 32 | 48;
  batch_size: number;
  daily_cap: number;
  daily_stop_utc: string;
}

interface Category {
  category_key: string;
  category_name: string;
}

const DEFAULTS: ColoringConfig = {
  enabled: false,
  topic_mode: "random",
  specific_category_key: null,
  age_band: "4-6",
  page_count: 32,
  batch_size: 1,
  daily_cap: 3,
  daily_stop_utc: "22:00",
};

export function ColoringAutopilotCard() {
  const [cfg, setCfg] = useState<ColoringConfig>(DEFAULTS);
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("coloring-autopilot-config", { method: "GET" as any });
        if (error) throw error;
        setCfg({ ...DEFAULTS, ...(data?.config ?? {}) });
        setCats(data?.categories ?? []);
      } catch (e) {
        toast({ title: "Failed to load coloring autopilot config", description: String(e), variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async (next: ColoringConfig) => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("coloring-autopilot-config", { body: { config: next } });
      if (error) throw error;
      setCfg({ ...DEFAULTS, ...(data?.config ?? next) });
      toast({ title: "Coloring autopilot saved" });
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("coloring-autopilot-tick", {
        body: { manual: true, override_batch: cfg.batch_size },
      });
      if (error) throw error;
      const queued = (data?.queued ?? []) as Array<{ ok: boolean; title: string; ebook_id?: string; error?: string }>;
      const ok = queued.filter((q) => q.ok).length;
      toast({
        title: `Queued ${ok}/${queued.length} coloring book${queued.length === 1 ? "" : "s"}`,
        description: data?.skipped ? `Skipped: ${data.skipped}` : queued.map((q) => q.title).join(" · ").slice(0, 200),
      });
    } catch (e) {
      toast({ title: "Run failed", description: String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const update = <K extends keyof ColoringConfig>(k: K, v: ColoringConfig[K]) => setCfg((p) => ({ ...p, [k]: v }));

  return (
    <Card className="p-4 border-2 border-foreground">
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Palette className="size-5" />
          <h2 className="font-display uppercase text-lg">Coloring Book Autopilot</h2>
        </div>
        <div className="flex items-center gap-3">
          <Label htmlFor="cb-enabled" className="text-xs uppercase font-mono">Auto-schedule</Label>
          <Switch id="cb-enabled" checked={cfg.enabled} onCheckedChange={(v) => update("enabled", v)} disabled={loading} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Queues coloring books via the canonical pipeline. Rows are created immediately and generation begins after the P0 sequential-safe lock releases. Manual "Run now" ignores the daily cap and stop time.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <Label className="text-xs uppercase font-mono">Topic mode</Label>
          <Select value={cfg.topic_mode} onValueChange={(v) => update("topic_mode", v as ColoringConfig["topic_mode"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="random">Random (weighted)</SelectItem>
              <SelectItem value="specific">Specific category</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {cfg.topic_mode === "specific" && (
          <div>
            <Label className="text-xs uppercase font-mono">Category</Label>
            <Select
              value={cfg.specific_category_key ?? ""}
              onValueChange={(v) => update("specific_category_key", v)}
            >
              <SelectTrigger><SelectValue placeholder="Choose category" /></SelectTrigger>
              <SelectContent>
                {cats.map((c) => (
                  <SelectItem key={c.category_key} value={c.category_key}>{c.category_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <Label className="text-xs uppercase font-mono">Age band</Label>
          <Select value={cfg.age_band} onValueChange={(v) => update("age_band", v as ColoringConfig["age_band"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3-5">3–5</SelectItem>
              <SelectItem value="4-6">4–6</SelectItem>
              <SelectItem value="6-8">6–8</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs uppercase font-mono">Page count</Label>
          <Select value={String(cfg.page_count)} onValueChange={(v) => update("page_count", Number(v) as ColoringConfig["page_count"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="24">24 pages</SelectItem>
              <SelectItem value="32">32 pages</SelectItem>
              <SelectItem value="48">48 pages</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs uppercase font-mono">Batch size (per run)</Label>
          <Input
            type="number" min={1} max={20} value={cfg.batch_size}
            onChange={(e) => update("batch_size", Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          />
        </div>

        <div>
          <Label className="text-xs uppercase font-mono">Daily cap (books/day)</Label>
          <Input
            type="number" min={0} max={100} value={cfg.daily_cap}
            onChange={(e) => update("daily_cap", Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
          />
        </div>

        <div>
          <Label className="text-xs uppercase font-mono">Daily stop time (UTC)</Label>
          <Input
            type="time" value={cfg.daily_stop_utc}
            onChange={(e) => update("daily_stop_utc", e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2 mt-4 flex-wrap">
        <Button onClick={() => save(cfg)} disabled={saving || loading} variant="outline">
          <Save className={`size-4 ${saving ? "animate-pulse" : ""}`} /> Save settings
        </Button>
        <Button onClick={runNow} disabled={running || loading} variant="secondary">
          <Play className={`size-4 ${running ? "animate-pulse" : ""}`} /> Run now ({cfg.batch_size} book{cfg.batch_size === 1 ? "" : "s"})
        </Button>
      </div>
    </Card>
  );
}
