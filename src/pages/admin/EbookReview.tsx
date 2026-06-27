import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";
import { downloadAdminPdf } from "@/lib/pdf";
import { PdfWizard } from "@/components/admin/PdfWizard";
import { FinalApproval } from "@/components/admin/FinalApproval";


interface Chapter { title: string; content: string }
interface CoverSpec {
  title_text?: string; subtitle_text?: string; badge_text?: string; brand_text?: string;
  layout_direction?: string; color_palette?: string[]; cover_strategy?: string;
  visual_sales_angle?: string; why_this_cover_sells?: string;
  background_image_prompt_no_text?: string;
}
interface CoverQC {
  title_readable?: boolean; subtitle_readable?: boolean; brand_visible?: boolean;
  matches_topic?: boolean; looks_premium?: boolean; works_as_thumbnail?: boolean;
  no_misleading_claim?: boolean; no_clutter?: boolean;
  conversion_score?: number; issues?: string[]; improvements?: string[];
}
interface InteriorVisuals {
  framework_diagrams?: { visual_name: string; chapter: string; type: string; nodes: string[] }[];
  worksheets_and_templates?: { asset_name: string; chapter: string }[];
  recommended_visual_count?: number;
}
interface Ebook {
  id: string; title: string; subtitle: string | null; target_buyer: string | null;
  hook: string | null; toc: { title: string }[]; chapters: Chapter[];
  bonuses: Record<string, unknown>; product_description: string | null;
  seo_title: string | null; seo_meta: string | null; tags: string[];
  cover_prompt: string | null; cover_url: string | null; cover_bg_url: string | null;
  cover_spec: CoverSpec | null; cover_qc: CoverQC | null; cover_score: number | null;
  cover_approved: boolean; interior_visuals: InteriorVisuals | null;
  pdf_url: string | null;
  word_count: number; qc: Record<string, unknown>; price: number; vendor: string;
  product_type: string; shopify_product_id: string | null; status: string;
  cost_usd: number; updated_at: string;
}

export default function EbookReview() {
  const { id } = useParams<{ id: string }>();
  const [e, setE] = useState<Ebook | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    const { data } = await supabase.from("ebooks").select("*").eq("id", id).single();
    if (data) setE(data as unknown as Ebook);
  };
  useEffect(() => { load(); }, [id]);

  // Poll while generation is in progress
  const isGenerating = !!e && (
    e.status === "outline" || e.status === "writing" || e.status?.startsWith("writing:") ||
    e.status === "marketing" || e.status === "cover" || e.status === "visuals" || e.status === "building_pdf"
  );
  useEffect(() => {
    if (!isGenerating) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [isGenerating]);

  // Parse progress: status "writing:3/10" → { done: 3, total: 10 }
  const progress = (() => {
    if (!e) return null;
    const m = /^writing:(\d+)\/(\d+)$/.exec(e.status ?? "");
    if (m) {
      const done = Number(m[1]); const tot = Number(m[2]);
      return { done, tot, pct: Math.round((done / tot) * 100), label: `Writing chapter ${done} of ${tot}` };
    }
    if (e.status === "outline") return { done: 0, tot: 1, pct: 5, label: "Designing outline…" };
    if (e.status === "writing") return { done: 0, tot: 1, pct: 10, label: "Starting chapters…" };
    if (e.status === "marketing") return { done: 1, tot: 1, pct: 95, label: "Writing marketing copy & SEO…" };
    if (e.status === "cover") return { done: 1, tot: 1, pct: 80, label: "Generating cover…" };
    if (e.status === "visuals") return { done: 1, tot: 1, pct: 85, label: "Generating interior visuals…" };
    if (e.status === "building_pdf") return { done: 1, tot: 1, pct: 90, label: "Building PDF…" };
    return null;
  })();



  const save = async () => {
    if (!e) return;
    setBusy("save");
    const { error } = await supabase.from("ebooks").update({
      title: e.title, subtitle: e.subtitle, price: e.price, tags: e.tags,
      product_description: e.product_description, seo_title: e.seo_title, seo_meta: e.seo_meta,
      chapters: e.chapters as unknown as never, bonuses: e.bonuses as unknown as never,
    }).eq("id", e.id);
    setBusy(null);
    if (error) toast.error(error.message); else toast.success("Saved");
  };

  const run = async (fn: string) => {
    if (!e) return;
    setBusy(fn);
    try {
      const { error } = await supabase.functions.invoke(fn, { body: { ebook_id: e.id } });
      if (error) throw error;
      toast.success(fn === "resume-generation" || fn === "generate-cover" ? `${fn} started — working in background.` : `${fn} done`);
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : `${fn} failed`);
    } finally { setBusy(null); }
  };

  const openPdf = async () => {
    if (!e) return;
    setBusy("open-pdf");
    try {
      await downloadAdminPdf(e.id, e.title);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Download PDF failed");
    } finally {
      setBusy(null);
    }
  };

  if (!e) return <div>Loading…</div>;

  return (
    <div className="space-y-6 max-w-5xl">
      <Link to="/admin/pipeline" className="text-sm flex items-center gap-1 text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to pipeline
      </Link>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Badge>{e.status}</Badge>
          <h1 className="font-display text-3xl uppercase mt-2">{e.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {e.word_count} words · cost ${Number(e.cost_usd).toFixed(4)}
          </p>
        </div>
      </div>

      {progress && (() => {
        const ageMs = e.updated_at ? Date.now() - new Date(e.updated_at).getTime() : 0;
        const isStuck = isGenerating && ageMs > 2 * 60 * 1000;
        return (
          <Card className={`border-2 ${isStuck ? "border-destructive" : "border-foreground"} bg-muted/40`}>
            <CardContent className="py-4 space-y-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  {isStuck ? <span className="text-destructive">⚠ Stuck</span> : <Loader2 className="size-4 animate-spin" />}
                  {progress.label}
                </div>
                <span className="font-mono text-xs">{progress.pct}%</span>
              </div>
              <Progress value={progress.pct} className="h-2" />
              {isStuck ? (
                <div className="space-y-2">
                  <p className="text-xs text-destructive">
                    No updates for {Math.round(ageMs / 60000)} min. The background worker likely shut down. Click Resume to pick up from chapter {(e.chapters?.length ?? 0) + 1}.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => run("resume-generation")} disabled={!!busy}>
                      {busy === "resume-generation" && <Loader2 className="size-4 animate-spin mr-1" />} Resume generation
                    </Button>
                    <Button size="sm" variant="outline" onClick={async () => {
                      await supabase.from("ebooks").update({ status: "qc_failed" }).eq("id", e.id);
                      load();
                    }} disabled={!!busy}>Mark failed</Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Each chapter takes ~10–20 seconds. Total ~3–5 minutes for 10 chapters. This page auto-refreshes.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })()}



      <div className="grid md:grid-cols-2 gap-4">
        <Card className="border-2 border-foreground">
          <CardHeader><CardTitle>Basics</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>Title</Label><Input value={e.title} onChange={(v) => setE({ ...e, title: v.target.value })} /></div>
            <div><Label>Subtitle</Label><Input value={e.subtitle ?? ""} onChange={(v) => setE({ ...e, subtitle: v.target.value })} /></div>
            <div><Label>Price USD</Label><Input type="number" step="0.01" value={e.price} onChange={(v) => setE({ ...e, price: Number(v.target.value) })} /></div>
            <div><Label>Tags (comma-separated)</Label><Input value={e.tags.join(", ")} onChange={(v) => setE({ ...e, tags: v.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></div>
          </CardContent>
        </Card>
        <Card className="border-2 border-foreground">
          <CardHeader><CardTitle>SEO & marketing</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>SEO title</Label><Input value={e.seo_title ?? ""} onChange={(v) => setE({ ...e, seo_title: v.target.value })} /></div>
            <div><Label>Meta description</Label><Textarea value={e.seo_meta ?? ""} onChange={(v) => setE({ ...e, seo_meta: v.target.value })} /></div>
            <div><Label>Product description</Label><Textarea rows={10} value={e.product_description ?? ""} onChange={(v) => setE({ ...e, product_description: v.target.value })} /></div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-2 border-foreground">
        <CardHeader><CardTitle>Quality control</CardTitle></CardHeader>
        <CardContent>
          <pre className="text-xs bg-muted p-3 overflow-auto">{JSON.stringify(e.qc, null, 2)}</pre>
        </CardContent>
      </Card>

      <Card className="border-2 border-foreground">
        <CardHeader><CardTitle>Chapters</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(e.chapters ?? []).map((ch, i) => (
            <details key={i} className="border-2 border-foreground/20 p-3">
              <summary className="cursor-pointer font-medium">{i + 1}. {ch.title}</summary>
              <Textarea rows={12} className="mt-2" value={ch.content} onChange={(v) => {
                const next = [...e.chapters]; next[i] = { ...ch, content: v.target.value }; setE({ ...e, chapters: next });
              }} />
            </details>
          ))}
          {(!e.chapters || e.chapters.length === 0) && (
            <p className="text-sm text-muted-foreground">No chapters yet. Run generate-content.</p>
          )}
        </CardContent>
      </Card>

      <PdfWizard ebook={e} busy={busy} onRun={run} />



      <Card className="border-2 border-foreground">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>Cover & PDF</span>
            <div className="flex items-center gap-2">
              {typeof e.cover_score === "number" && (
                <Badge variant={e.cover_score >= 85 ? "default" : "destructive"}>Cover score: {e.cover_score}</Badge>
              )}
              {e.cover_approved && <Badge>Approved</Badge>}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              {e.cover_url ? (
                <img src={e.cover_url} alt="Cover" className="w-full max-w-xs border-2 border-foreground" />
              ) : (
                <p className="text-sm text-muted-foreground">No cover yet.</p>
              )}
              {e.cover_bg_url && (
                <p className="text-xs text-muted-foreground mt-2">
                  <a href={e.cover_bg_url} target="_blank" rel="noreferrer" className="underline">Background (no text)</a>
                </p>
              )}
              {typeof e.qc?.cover_error === "string" && e.qc.cover_error && (
                <p className="text-sm text-destructive mt-2">Cover error: {e.qc.cover_error}</p>
              )}
            </div>
            <div className="space-y-2">
              <div>
                <Label>Title overlay</Label>
                <Input
                  value={e.cover_spec?.title_text ?? e.title}
                  onChange={(v) => setE({ ...e, cover_spec: { ...(e.cover_spec ?? {}), title_text: v.target.value } })}
                />
              </div>
              <div>
                <Label>Subtitle overlay</Label>
                <Input
                  value={e.cover_spec?.subtitle_text ?? e.subtitle ?? ""}
                  onChange={(v) => setE({ ...e, cover_spec: { ...(e.cover_spec ?? {}), subtitle_text: v.target.value } })}
                />
              </div>
              <div>
                <Label>Badge (optional)</Label>
                <Input
                  value={e.cover_spec?.badge_text ?? ""}
                  onChange={(v) => setE({ ...e, cover_spec: { ...(e.cover_spec ?? {}), badge_text: v.target.value } })}
                />
              </div>
              <div>
                <Label>Brand</Label>
                <Input
                  value={e.cover_spec?.brand_text ?? "SECRET PDF"}
                  onChange={(v) => setE({ ...e, cover_spec: { ...(e.cover_spec ?? {}), brand_text: v.target.value } })}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={async () => {
                  setBusy("save-cover-spec");
                  const { error } = await supabase.from("ebooks").update({
                    cover_spec: e.cover_spec as unknown as never,
                  }).eq("id", e.id);
                  setBusy(null);
                  if (error) toast.error(error.message); else toast.success("Overlay saved — regenerate cover to rerender.");
                }} disabled={!!busy}>Save overlay</Button>
                <Button size="sm" variant="outline" onClick={async () => {
                  setBusy("approve-cover");
                  const { error } = await supabase.from("ebooks").update({ cover_approved: true }).eq("id", e.id);
                  setBusy(null);
                  if (error) toast.error(error.message); else { toast.success("Cover approved"); load(); }
                }} disabled={!!busy || !e.cover_url}>Approve cover</Button>
              </div>
            </div>
          </div>
          {e.cover_qc && (
            <div className="text-xs space-y-1">
              <div className="flex flex-wrap gap-1">
                {([
                  ["title_readable", "Title"],
                  ["subtitle_readable", "Subtitle"],
                  ["brand_visible", "Brand"],
                  ["matches_topic", "On topic"],
                  ["looks_premium", "Premium"],
                  ["works_as_thumbnail", "Thumbnail"],
                  ["no_misleading_claim", "Safe"],
                  ["no_clutter", "Clean"],
                ] as const).map(([k, label]) => (
                  <Badge key={k} variant={e.cover_qc?.[k] ? "default" : "destructive"}>{label}: {e.cover_qc?.[k] ? "✓" : "✗"}</Badge>
                ))}
              </div>
              {(e.cover_qc.issues ?? []).length > 0 && (
                <p className="text-destructive">Issues: {(e.cover_qc.issues ?? []).join("; ")}</p>
              )}
            </div>
          )}
          {e.pdf_url && <Button type="button" variant="link" className="h-auto p-0 text-sm underline" onClick={openPdf} disabled={!!busy}>{busy === "open-pdf" ? "Downloading…" : "Download PDF"}</Button>}
        </CardContent>
      </Card>

      <Card className="border-2 border-foreground">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>Interior visuals</span>
            <Badge variant="outline">
              {(e.interior_visuals?.framework_diagrams?.length ?? 0)} diagrams ·
              {" "}{(e.interior_visuals?.worksheets_and_templates?.length ?? 0)} worksheets
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!e.interior_visuals && <p className="text-sm text-muted-foreground">None yet. Generate to add diagrams + worksheets to the PDF.</p>}
          {e.interior_visuals?.framework_diagrams?.map((d, i) => (
            <div key={`d-${i}`} className="text-sm border-l-2 border-foreground/40 pl-2">
              <span className="font-medium">{d.visual_name}</span>
              <span className="text-muted-foreground"> · {d.chapter} · {d.type} · {d.nodes?.length ?? 0} nodes</span>
            </div>
          ))}
          {e.interior_visuals?.worksheets_and_templates?.map((w, i) => (
            <div key={`w-${i}`} className="text-sm border-l-2 border-accent/60 pl-2">
              <span className="font-medium">{w.asset_name}</span>
              <span className="text-muted-foreground"> · {w.chapter}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 border-2 border-foreground bg-card p-4 flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy === "save"}>{busy === "save" && <Loader2 className="size-4 animate-spin" />} Save edits</Button>
        <Button variant="outline" onClick={() => run("qc-check")} disabled={!!busy}>Run QC</Button>
        <Button variant="outline" onClick={() => run("qc-fix")} disabled={!!busy}>Auto-fix QC</Button>
        <Button variant="outline" onClick={() => run("generate-cover")} disabled={!!busy}>{busy === "generate-cover" && <Loader2 className="size-4 animate-spin mr-1" />}Regenerate cover</Button>
        <Button variant="outline" onClick={() => run("generate-interior-visuals")} disabled={!!busy}>{busy === "generate-interior-visuals" && <Loader2 className="size-4 animate-spin mr-1" />}Generate visuals</Button>
        <Button variant="outline" onClick={() => run("build-pdf")} disabled={!!busy}>Build PDF</Button>
        <Button variant="outline" onClick={() => run("push-to-shopify")} disabled={!!busy || e.status === "qc_failed"}>Push to Shopify draft</Button>
      </div>
    </div>
  );
}
