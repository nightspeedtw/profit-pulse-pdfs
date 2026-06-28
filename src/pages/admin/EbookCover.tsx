// Milestone 5 — Premium Cover Design dashboard.
// Preview · Regenerate background · Edit title/subtitle/badge/brand overlays ·
// Regenerate full · Approve cover. Publishing is blocked until cover_approved
// and cover_score >= 85 (enforced server-side in publishGate).
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, ImageIcon, CheckCircle2, XCircle, Sparkles } from "lucide-react";

type Ebook = any;

function ScoreBadge({ label, value }: { label: string; value: number | undefined | null }) {
  const v = Number(value ?? 0);
  const cls = v >= 85 ? "bg-green-500/10 text-green-700 border-green-500/30"
    : v >= 60 ? "bg-yellow-500/10 text-yellow-700 border-yellow-500/30"
    : "bg-red-500/10 text-red-700 border-red-500/30";
  return <Badge variant="outline" className={`${cls} font-mono text-xs`}>{label} {v}</Badge>;
}

export default function EbookCover() {
  const { id } = useParams();
  const [ebook, setEbook] = useState<Ebook | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // overlay edit buffers
  const [titleText, setTitleText] = useState("");
  const [subtitleText, setSubtitleText] = useState("");
  const [badgeText, setBadgeText] = useState("");
  const [brandText, setBrandText] = useState("");

  async function load() {
    if (!id) return;
    const { data } = await supabase.from("ebooks").select("*").eq("id", id).maybeSingle();
    setEbook(data);
    const s = (data?.cover_spec ?? {}) as any;
    setTitleText(s.title_text ?? data?.title ?? "");
    setSubtitleText(s.subtitle_text ?? data?.subtitle ?? "");
    setBadgeText(s.badge_text ?? "");
    setBrandText(s.brand_text ?? "SECRET PDF");
  }
  useEffect(() => { load(); }, [id]);

  // Poll while cover regen is running
  useEffect(() => {
    if (ebook?.status !== "cover") return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [ebook?.status]);

  async function invoke(label: string, body: any) {
    setBusy(label);
    try {
      const { data, error } = await supabase.functions.invoke("generate-cover", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: `${label} started`, description: `Mode: ${data?.mode ?? "full"} — running in background.` });
      await load();
    } catch (e: any) {
      toast({ title: `${label} failed`, description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  if (!ebook) return <div className="p-6"><Loader2 className="animate-spin" /></div>;

  const qc = (ebook.cover_qc ?? {}) as any;
  const spec = (ebook.cover_spec ?? {}) as any;
  const score = Number(ebook.cover_score ?? 0);
  const passed = score >= 85 && qc.title_readable && qc.subtitle_readable && qc.brand_visible
    && qc.matches_topic && qc.looks_premium && qc.works_as_thumbnail && qc.no_misleading_claim
    && qc.no_clutter && qc.no_overlap && qc.strong_contrast && qc.no_ai_text_errors && qc.mobile_thumbnail_readable;
  const checks: [string, boolean | undefined][] = [
    ["title readable", qc.title_readable],
    ["subtitle readable", qc.subtitle_readable],
    ["no overlapping text", qc.no_overlap],
    ["strong contrast", qc.strong_contrast],
    ["premium design", qc.looks_premium],
    ["topic match", qc.matches_topic],
    ["mobile thumbnail readable", qc.mobile_thumbnail_readable],
    ["no AI text errors", qc.no_ai_text_errors],
    ["brand visible", qc.brand_visible],
    ["no clutter", qc.no_clutter],
    ["no misleading claim", qc.no_misleading_claim],
    ["works as thumbnail", qc.works_as_thumbnail],
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs">[ Cover Design ]</p>
          <h1 className="font-display text-3xl uppercase leading-tight">{ebook.title}</h1>
          <div className="flex gap-2 mt-3 flex-wrap">
            <Badge variant="outline">cover_size: 1600×2400 (2:3)</Badge>
            <Badge variant="outline">status: {ebook.status}</Badge>
            {ebook.cover_approved && <Badge className="bg-green-500/10 text-green-700 border-green-500/30">approved</Badge>}
            {!ebook.cover_approved && ebook.cover_url && <Badge variant="outline">awaiting approval</Badge>}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-4" /></Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
        {/* Preview */}
        <div className="space-y-3">
          <Card>
            <CardContent className="p-3">
              {ebook.cover_url ? (
                <img src={ebook.cover_url} alt="Cover preview" className="w-full aspect-[2/3] object-contain bg-muted border-2 border-foreground/10" />
              ) : (
                <div className="w-full aspect-[2/3] grid place-items-center bg-muted border-2 border-foreground/10 text-muted-foreground text-sm">
                  No cover yet
                </div>
              )}
            </CardContent>
          </Card>
          {ebook.cover_bg_url && (
            <details>
              <summary className="text-xs cursor-pointer text-muted-foreground">View raw background (no text)</summary>
              <img src={ebook.cover_bg_url} alt="Background only" className="w-full aspect-[2/3] object-contain mt-2 border-2 border-foreground/10" />
            </details>
          )}
        </div>

        {/* Controls + QC */}
        <div className="space-y-4">
          {/* Actions */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Generate / Regenerate</p>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" disabled={!!busy} onClick={() => invoke("Full regenerate", { ebook_id: ebook.id, mode: "full" })}>
                  {busy === "Full regenerate" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {ebook.cover_url ? "Regenerate Cover (full)" : "Generate Cover"}
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy || !spec?.title_text}
                  onClick={() => invoke("Regenerate background", { ebook_id: ebook.id, mode: "background" })}>
                  {busy === "Regenerate background" ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
                  Regenerate Background
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy || !spec?.title_text}
                  onClick={() => invoke("Regenerate strategy", { ebook_id: ebook.id, mode: "spec" })}>
                  Regenerate Strategy + Background
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Overlay editor */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Edit Overlays</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="title">Title <span className="text-xs text-muted-foreground">({titleText.length}/60)</span></Label>
                  <Input id="title" maxLength={60} value={titleText} onChange={(e) => setTitleText(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="subtitle">Subtitle <span className="text-xs text-muted-foreground">({subtitleText.length}/120)</span></Label>
                  <Input id="subtitle" maxLength={120} value={subtitleText} onChange={(e) => setSubtitleText(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="badge">Badge <span className="text-xs text-muted-foreground">({badgeText.length}/28)</span></Label>
                  <Input id="badge" maxLength={28} value={badgeText} onChange={(e) => setBadgeText(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="brand">Brand</Label>
                  <Input id="brand" maxLength={28} value={brandText} onChange={(e) => setBrandText(e.target.value)} />
                </div>
              </div>
              <Button size="sm" disabled={!!busy || !ebook.cover_bg_url}
                onClick={() => invoke("Apply overlay edits", {
                  ebook_id: ebook.id, mode: "overlay",
                  spec_overrides: { title_text: titleText, subtitle_text: subtitleText, badge_text: badgeText, brand_text: brandText },
                })}>
                {busy === "Apply overlay edits" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Apply Overlay Edits
              </Button>
              <p className="text-xs text-muted-foreground">
                Overlay edits keep the existing background image and recompose the SVG text layer with your new values. Saves an image-generation cost.
              </p>
            </CardContent>
          </Card>

          {/* QC */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Cover QC</p>
                <Badge variant="outline" className={passed ? "bg-green-500/10 text-green-700 border-green-500/30" : "bg-red-500/10 text-red-700 border-red-500/30"}>
                  {ebook.cover_url ? (passed ? "PASS" : "FAIL") : "NOT RUN"}
                </Badge>
              </div>
              {ebook.cover_url && (
                <>
                  <div className="flex gap-2 flex-wrap">
                    <ScoreBadge label="Conversion" value={qc.conversion_score} />
                    <ScoreBadge label="Cover Score" value={score} />
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    {checks.map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2">
                        {v ? <CheckCircle2 className="size-3.5 text-green-600" /> : <XCircle className="size-3.5 text-red-600" />}
                        <span className={v ? "" : "text-red-700"}>{k}</span>
                      </div>
                    ))}
                  </div>
                  {Array.isArray(qc.issues) && qc.issues.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Issues ({qc.issues.length})</summary>
                      <ul className="list-disc pl-5 mt-1 space-y-0.5">{qc.issues.map((i: string, idx: number) => <li key={idx}>{i}</li>)}</ul>
                    </details>
                  )}
                  {Array.isArray(qc.improvements) && qc.improvements.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Suggested improvements ({qc.improvements.length})</summary>
                      <ul className="list-disc pl-5 mt-1 space-y-0.5">{qc.improvements.map((i: string, idx: number) => <li key={idx}>{i}</li>)}</ul>
                    </details>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Strategy reveal */}
          {spec?.cover_strategy && (
            <details>
              <summary className="text-xs cursor-pointer text-muted-foreground">View cover strategy + palette</summary>
              <Card className="mt-2">
                <CardContent className="p-3 text-xs space-y-2">
                  <p><strong>Strategy:</strong> {spec.cover_strategy}</p>
                  <p><strong>Sales angle:</strong> {spec.visual_sales_angle}</p>
                  <p><strong>Why this cover sells:</strong> {spec.why_this_cover_sells}</p>
                  <p><strong>Typography:</strong> {spec.typography_style}</p>
                  <p><strong>Layout:</strong> {spec.layout_direction}</p>
                  <div className="flex gap-1 items-center">
                    <strong>Palette:</strong>
                    {(spec.color_palette ?? []).map((c: string, i: number) => (
                      <span key={i} className="inline-flex items-center gap-1">
                        <span className="inline-block size-4 border" style={{ background: c }} />
                        <code>{c}</code>
                      </span>
                    ))}
                  </div>
                  <p><strong>Background prompt:</strong> <em>{spec.background_image_prompt_no_text}</em></p>
                </CardContent>
              </Card>
            </details>
          )}

          {/* Approve */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Approval</p>
              <p className="text-xs text-muted-foreground">
                Publishing to Shopify is blocked until the cover is approved <em>and</em> the cover score is ≥ 85.
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button
                  disabled={!passed || busy === "Approve"}
                  onClick={async () => {
                    setBusy("Approve");
                    const { error } = await supabase.from("ebooks").update({ cover_approved: true }).eq("id", ebook.id);
                    setBusy(null);
                    if (error) toast({ title: "Approve failed", description: error.message, variant: "destructive" });
                    else { toast({ title: "Cover approved" }); load(); }
                  }}>
                  <CheckCircle2 className="size-4" /> Approve Cover
                </Button>
                {ebook.cover_approved && (
                  <Button variant="outline" disabled={busy === "Unapprove"}
                    onClick={async () => {
                      setBusy("Unapprove");
                      await supabase.from("ebooks").update({ cover_approved: false }).eq("id", ebook.id);
                      setBusy(null); load();
                    }}>Unapprove</Button>
                )}
              </div>
              <div className="text-sm pt-2 space-x-4">
                <Link to={`/admin/ebook/${ebook.id}/writing`} className="underline text-muted-foreground">← Writing</Link>
                <Link to={`/admin/ebook/${ebook.id}/pdf`} className="underline text-muted-foreground">PDF Layout →</Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
