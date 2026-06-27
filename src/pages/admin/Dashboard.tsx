import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type Stats = { ideas: number; approved: number; uploaded: number; published: number; cost: number };

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({ ideas: 0, approved: 0, uploaded: 0, published: 0, cost: 0 });
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const [{ count: ideas }, { count: approved }, { count: uploaded }, { count: published }, { data: costs }] =
      await Promise.all([
        supabase.from("ebook_ideas").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()),
        supabase.from("ebooks").select("id", { count: "exact", head: true }).eq("status", "approved"),
        supabase.from("ebooks").select("id", { count: "exact", head: true }).eq("status", "uploaded"),
        supabase.from("ebooks").select("id", { count: "exact", head: true }).eq("status", "published"),
        supabase.from("cost_log").select("cost_usd").gte("created_at", since.toISOString()),
      ]);
    setStats({
      ideas: ideas ?? 0,
      approved: approved ?? 0,
      uploaded: uploaded ?? 0,
      published: published ?? 0,
      cost: (costs ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
    });
  };

  useEffect(() => { load(); }, []);

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

  const tiles: { label: string; value: number | string }[] = [
    { label: "Ideas (today)", value: stats.ideas },
    { label: "Approved", value: stats.approved },
    { label: "Uploaded", value: stats.uploaded },
    { label: "Published", value: stats.published },
    { label: "AI cost (today)", value: `$${stats.cost.toFixed(4)}` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs">[ Overview ]</p>
          <h1 className="font-display text-4xl uppercase">Dashboard</h1>
        </div>
        <Button onClick={generateNow} disabled={generating}>
          {generating ? <Loader2 className="size-4 animate-spin" /> : null}
          Generate ideas now
        </Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {tiles.map((t) => (
          <Card key={t.label} className="border-2 border-foreground">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase text-muted-foreground">{t.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-display text-3xl">{t.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="border-2 border-foreground">
        <CardHeader><CardTitle>Quality-first principle</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>Every ebook must pass QC before a cover is generated and before any upload to Shopify.</p>
          <p>Min 8,000 words · score threshold gate · duplicate check · unsafe-claim filter · refund-risk cap.</p>
          <p>Products are always created as drafts. You approve before publishing.</p>
        </CardContent>
      </Card>
    </div>
  );
}
