// Coloring Lab V2 — isolated experimental admin UI.
// Rendered only when FEATURES.ENABLE_COLORING_LANE_V2 is true.
// This page never mutates the v1 coloring lane in any way; it reads and
// writes exclusively to coloring_v2_* tables via v2 edge functions.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

type AgeBand = { slug: string; label: string; min_age: number; max_age: number };
type V2Book = {
  id: string;
  title: string | null;
  age_band: string;
  theme: string;
  page_count: number;
  generation_status: string;
  qc_status: string;
  sellability_status: string;
  publish_status: string;
  overall_qc_score: number | null;
  typography_qc_score: number | null;
  cost_actual_usd: number | null;
  created_at: string;
};

const THEME_PRESETS = [
  "Space and planets",
  "Underwater ocean",
  "Dinosaurs",
  "Enchanted forest",
  "Superhero unicorns",
  "Farm animals",
  "Fairy tale castle",
  "Robots and machines",
];

export default function ColoringLabV2() {
  const [bands, setBands] = useState<AgeBand[]>([]);
  const [books, setBooks] = useState<V2Book[]>([]);
  const [starting, setStarting] = useState(false);

  // form
  const [ageBand, setAgeBand] = useState("8-12");
  const [themeMode, setThemeMode] = useState<"select"|"custom"|"random"|"surprise">("select");
  const [theme, setTheme] = useState("Space and planets");
  const [customTheme, setCustomTheme] = useState("");
  const [pageCount, setPageCount] = useState<16 | 32>(16);
  const [language, setLanguage] = useState("en");
  const [educationalFacts, setEducationalFacts] = useState(true);
  const [coverMood, setCoverMood] = useState("adventurous");
  const [providerMode, setProviderMode] = useState("auto");
  const [autopilotMode, setAutopilotMode] = useState<"full_auto"|"assisted">("full_auto");

  const resolvedTheme = useMemo(() => {
    if (themeMode === "custom") return customTheme.trim();
    if (themeMode === "random" || themeMode === "surprise") {
      return THEME_PRESETS[Math.floor(Math.random() * THEME_PRESETS.length)];
    }
    return theme;
  }, [themeMode, customTheme, theme]);

  const refresh = async () => {
    const [b, bk] = await Promise.all([
      supabase.from("coloring_v2_age_bands" as never).select("slug,label,min_age,max_age").order("min_age"),
      supabase.from("coloring_v2_books" as never)
        .select("id,title,age_band,theme,page_count,generation_status,qc_status,sellability_status,publish_status,overall_qc_score,typography_qc_score,cost_actual_usd,created_at")
        .order("created_at", { ascending: false }).limit(50),
    ]);
    if (b.data) setBands(b.data as unknown as AgeBand[]);
    if (bk.data) setBooks(bk.data as unknown as V2Book[]);
  };

  useEffect(() => { void refresh(); }, []);

  const handleStart = async () => {
    if (!resolvedTheme) {
      toast({ title: "Theme required", variant: "destructive" });
      return;
    }
    setStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke("coloring-v2-start", {
        body: {
          age_band: ageBand,
          theme: resolvedTheme,
          theme_mode: themeMode,
          page_count: pageCount,
          language,
          educational_facts: educationalFacts,
          cover_mood: coverMood,
          provider_mode: providerMode,
          autopilot_mode: autopilotMode,
        },
      });
      if (error) throw error;
      toast({ title: "V2 book queued", description: `book_id: ${(data as { book_id?: string })?.book_id ?? "?"}` });
      await refresh();
    } catch (e) {
      toast({ title: "Failed to start", description: (e as Error).message, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-100 px-4 py-3 text-sm">
        <strong>Experimental — Coloring Lane V2.</strong> Runs in an isolated pipeline (coloring_v2_* tables, coloring-v2 storage bucket, coloring-v2-* functions). It does not affect the existing coloring lane. Publish stays <em>draft</em> until you approve it here.
      </div>

      <Card>
        <CardHeader><CardTitle>Start a new V2 coloring book</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Age band</Label>
            <Select value={ageBand} onValueChange={setAgeBand}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {bands.map(b => <SelectItem key={b.slug} value={b.slug}>{b.slug} · {b.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Theme mode</Label>
            <Select value={themeMode} onValueChange={(v) => setThemeMode(v as typeof themeMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="select">Select from list</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
                <SelectItem value="random">Random preset</SelectItem>
                <SelectItem value="surprise">Surprise me</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {themeMode === "select" && (
            <div className="md:col-span-2">
              <Label>Theme</Label>
              <Select value={theme} onValueChange={setTheme}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {THEME_PRESETS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {themeMode === "custom" && (
            <div className="md:col-span-2">
              <Label>Custom theme</Label>
              <Textarea value={customTheme} onChange={e => setCustomTheme(e.target.value)} placeholder="e.g. Ancient Egyptian pyramids and desert animals" />
            </div>
          )}
          <div>
            <Label>Page count</Label>
            <Select value={String(pageCount)} onValueChange={v => setPageCount(Number(v) as 16 | 32)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="16">16 pages</SelectItem>
                <SelectItem value="32">32 pages</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Language</Label>
            <Input value={language} onChange={e => setLanguage(e.target.value)} />
          </div>
          <div>
            <Label>Cover mood</Label>
            <Input value={coverMood} onChange={e => setCoverMood(e.target.value)} />
          </div>
          <div className="flex items-center gap-3 pt-6">
            <Switch checked={educationalFacts} onCheckedChange={setEducationalFacts} id="facts" />
            <Label htmlFor="facts">Include educational facts</Label>
          </div>
          <div>
            <Label>Provider mode</Label>
            <Select value={providerMode} onValueChange={setProviderMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (recommended)</SelectItem>
                <SelectItem value="premium_only">Premium only (OpenAI)</SelectItem>
                <SelectItem value="draft_only">Draft only (Runware)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Autopilot mode</Label>
            <Select value={autopilotMode} onValueChange={v => setAutopilotMode(v as typeof autopilotMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full_auto">Full auto</SelectItem>
                <SelectItem value="assisted">Assisted (pause before cover)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={handleStart} disabled={starting}>
              {starting ? "Queuing…" : "Start V2 book"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent V2 books</CardTitle></CardHeader>
        <CardContent>
          {books.length === 0 ? (
            <p className="text-sm text-muted-foreground">No V2 books yet. Start one above.</p>
          ) : (
            <div className="space-y-2">
              {books.map(b => (
                <div key={b.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{b.title ?? "(untitled)"} <span className="text-muted-foreground">· {b.theme}</span></div>
                    <div className="text-xs text-muted-foreground">{b.age_band} · {b.page_count}p · {new Date(b.created_at).toLocaleString()}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline">gen: {b.generation_status}</Badge>
                    <Badge variant="outline">qc: {b.qc_status}</Badge>
                    <Badge variant="outline">sell: {b.sellability_status}</Badge>
                    <Badge variant="outline">pub: {b.publish_status}</Badge>
                    {b.overall_qc_score != null && <Badge>QC {b.overall_qc_score}</Badge>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
