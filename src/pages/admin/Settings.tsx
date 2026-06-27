import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

type Settings = {
  id: number;
  daily_quota: number;
  mode: "low_cost" | "premium" | "hybrid";
  enabled_category_ids: string[];
  min_score_threshold: number;
  min_word_count: number;
  max_refund_risk: number;
  daily_budget_usd: number;
  auto_publish: boolean;
  cron_enabled: boolean;
};

type Category = { id: string; name: string; enabled: boolean };

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: setRow }, { data: catRows }] = await Promise.all([
        supabase.from("generation_settings").select("*").eq("id", 1).single(),
        supabase.from("categories").select("id,name,enabled").order("name"),
      ]);
      if (setRow) setS(setRow as Settings);
      if (catRows) setCats(catRows as Category[]);
    })();
  }, []);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    const { error } = await supabase.from("generation_settings").update({
      daily_quota: s.daily_quota,
      mode: s.mode,
      enabled_category_ids: s.enabled_category_ids,
      min_score_threshold: s.min_score_threshold,
      min_word_count: s.min_word_count,
      max_refund_risk: s.max_refund_risk,
      daily_budget_usd: s.daily_budget_usd,
      auto_publish: s.auto_publish,
      cron_enabled: s.cron_enabled,
    }).eq("id", 1);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Settings saved");
  };

  if (!s) return <div>Loading…</div>;

  const toggleCat = (id: string, on: boolean) => {
    setS({
      ...s,
      enabled_category_ids: on
        ? [...new Set([...s.enabled_category_ids, id])]
        : s.enabled_category_ids.filter((c) => c !== id),
    });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <p className="font-mono uppercase tracking-widest text-xs">[ Settings ]</p>
        <h1 className="font-display text-4xl uppercase">Generation settings</h1>
      </div>

      <Card className="border-2 border-foreground">
        <CardHeader><CardTitle>Daily generation</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Daily quota</Label>
              <Select value={String(s.daily_quota)} onValueChange={(v) => setS({ ...s, daily_quota: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 5, 10, 20, 50].map((n) => <SelectItem key={n} value={String(n)}>{n} ebooks/day</SelectItem>)}
                  <SelectItem value="0">Custom (manual only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Mode</Label>
              <Select value={s.mode} onValueChange={(v) => setS({ ...s, mode: v as Settings["mode"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low_cost">Low cost (Flash Lite)</SelectItem>
                  <SelectItem value="hybrid">Hybrid (recommended)</SelectItem>
                  <SelectItem value="premium">Premium (Pro models)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <Label>Enable daily cron</Label>
              <p className="text-xs text-muted-foreground">Runs the pipeline automatically each day.</p>
            </div>
            <Switch checked={s.cron_enabled} onCheckedChange={(v) => setS({ ...s, cron_enabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Auto-publish approved</Label>
              <p className="text-xs text-muted-foreground">If off, products stay as Shopify drafts.</p>
            </div>
            <Switch checked={s.auto_publish} onCheckedChange={(v) => setS({ ...s, auto_publish: v })} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-2 border-foreground">
        <CardHeader><CardTitle>Quality gates</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <Label>Min total idea score (0–60)</Label>
            <Input type="number" value={s.min_score_threshold ?? ""} onChange={(e) => setS({ ...s, min_score_threshold: e.target.value === "" ? 0 : Number(e.target.value) })} />
          </div>
          <div>
            <Label>Min word count</Label>
            <Input type="number" value={s.min_word_count ?? ""} onChange={(e) => setS({ ...s, min_word_count: e.target.value === "" ? 0 : Number(e.target.value) })} />
            <p className="text-xs text-muted-foreground mt-1">Recommended: 18,000 (70–90 page PDF, 10 chapters × 1,500–1,800 words)</p>
          </div>
          <div>
            <Label>Max refund risk (0–10)</Label>
            <Input type="number" value={s.max_refund_risk ?? ""} onChange={(e) => setS({ ...s, max_refund_risk: e.target.value === "" ? 0 : Number(e.target.value) })} />
          </div>
          <div>
            <Label>Daily budget (USD)</Label>
            <Input type="number" step="0.01" value={s.daily_budget_usd ?? ""} onChange={(e) => setS({ ...s, daily_budget_usd: e.target.value === "" ? 0 : Number(e.target.value) })} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-2 border-foreground">
        <CardHeader><CardTitle>Categories for daily generation</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {cats.map((c) => (
            <label key={c.id} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={s.enabled_category_ids.includes(c.id)}
                onCheckedChange={(v) => toggleCat(c.id, !!v)}
              />
              <span>{c.name}</span>
            </label>
          ))}
          {cats.length === 0 && <p className="text-sm text-muted-foreground">No categories yet — create some on the Categories page.</p>}
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
    </div>
  );
}
