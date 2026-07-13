import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { BookOpen, Loader2 } from "lucide-react";
import { listAgeGroups, listThemes, type KidsAgeGroup, type KidsTheme } from "@/lib/kidsTaxonomy";

interface Props {
  onStarted?: () => void;
}

const TONES = [
  "warm, whimsical, emotionally reassuring",
  "playful, funny, energetic",
  "gentle, calming, bedtime",
  "brave, adventurous, curious",
];
const LENGTHS = ["short", "standard", "long"] as const;
const INTENSITIES = ["low", "medium", "high"] as const;
const PRICES = ["budget", "standard", "premium"] as const;

export function BuildKidsBookButton({ onStarted }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ages, setAges] = useState<KidsAgeGroup[]>([]);
  const [themes, setThemes] = useState<KidsTheme[]>([]);

  const [ageSlug, setAgeSlug] = useState<string>("all");
  const [themeSlugs, setThemeSlugs] = useState<string[]>([]);
  const [language, setLanguage] = useState("en");
  const [market, setMarket] = useState("US");
  const [tone, setTone] = useState(TONES[0]);
  const [length, setLength] = useState<(typeof LENGTHS)[number]>("standard");
  const [intensity, setIntensity] = useState<(typeof INTENSITIES)[number]>("high");
  const [price, setPrice] = useState<(typeof PRICES)[number]>("standard");
  const [mode, setMode] = useState<"safe" | "full">("full");

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [a, t] = await Promise.all([listAgeGroups(), listThemes()]);
      setAges(a);
      setThemes(t);
    })();
  }, [open]);

  const toggleTheme = (slug: string) =>
    setThemeSlugs(prev => (prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]));

  const start = async () => {
    setBusy(true);
    try {
      // One-click parent production job. Internally cycles concept →
      // manuscript → story gate → art → PDF → QC, self-healing within
      // bounded budgets. Concept/story misses are recorded as internal
      // attempts, not surfaced as red FAILED rows.
      const { data, error } = await supabase.functions.invoke("kids-one-click-build", {
        body: {
          age_band: ageSlug === "all" ? "4-6" : ageSlug,
          theme_slugs: themeSlugs,
          preferred_lanes: [
            "food_kitchen_chaos",
            "tiny_detective",
            "animal_buddy_mechanical",
            "neighborhood_micro_adventure",
            "shop_library_museum_logic",
          ],
        },
      });
      if (error) throw error;
      const started = data as { parent_run_id?: string; ebook_id?: string };
      toast({
        title: "Kids build started",
        description: `One parent job running (up to 5 concept batches, self-healing repairs, publish only on strict QC).`,
      });
      setOpen(false);
      onStarted?.();
    } catch (e) {
      toast({ title: "Failed to start", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default">
          <BookOpen className="size-4" /> Build Kids Picture Book
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Build Kids Picture Book</DialogTitle>
        </DialogHeader>


        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Age band</Label>
            <select value={ageSlug} onChange={e => setAgeSlug(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm">
              <option value="all">All ages (auto-pick primary)</option>
              {ages.map(a => (
                <option key={a.slug} value={a.slug}>{a.label_en}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label>Themes (pick one or more)</Label>
            <div className="flex flex-wrap gap-1.5">
              {themes.map(t => {
                const active = themeSlugs.includes(t.slug);
                return (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => toggleTheme(t.slug)}
                    className={`px-2.5 py-1 text-xs rounded-full border ${active ? "bg-foreground text-background" : "bg-background"}`}
                  >
                    {t.label_en}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Language</Label>
              <input value={language} onChange={e => setLanguage(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div className="space-y-1">
              <Label>Target market</Label>
              <input value={market} onChange={e => setMarket(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Tone</Label>
            <select value={tone} onChange={e => setTone(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm">
              {TONES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Length</Label>
              <select value={length} onChange={e => setLength(e.target.value as typeof length)} className="w-full border rounded px-2 py-1.5 text-sm">
                {LENGTHS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Illustration</Label>
              <select value={intensity} onChange={e => setIntensity(e.target.value as typeof intensity)} className="w-full border rounded px-2 py-1.5 text-sm">
                {INTENSITIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Price</Label>
              <select value={price} onChange={e => setPrice(e.target.value as typeof price)} className="w-full border rounded px-2 py-1.5 text-sm">
                {PRICES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Autopilot mode</Label>
            <div className="flex gap-2">
              <button onClick={() => setMode("safe")} className={`flex-1 px-3 py-1.5 rounded border text-sm ${mode === "safe" ? "bg-foreground text-background" : ""}`}>
                Safe (stop at review)
              </button>
              <button onClick={() => setMode("full")} className={`flex-1 px-3 py-1.5 rounded border text-sm ${mode === "full" ? "bg-foreground text-background" : ""}`}>
                Full (publish if QC passes)
              </button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={start} disabled={busy}>
            {busy ? <><Loader2 className="size-4 animate-spin" /> Starting…</> : <>Start build</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BuildKidsBookButton;
