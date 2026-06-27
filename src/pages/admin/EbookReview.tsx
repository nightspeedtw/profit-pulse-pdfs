import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";

interface Chapter { title: string; content: string }
interface Ebook {
  id: string; title: string; subtitle: string | null; target_buyer: string | null;
  hook: string | null; toc: { title: string }[]; chapters: Chapter[];
  bonuses: Record<string, unknown>; product_description: string | null;
  seo_title: string | null; seo_meta: string | null; tags: string[];
  cover_prompt: string | null; cover_url: string | null; pdf_url: string | null;
  word_count: number; qc: Record<string, unknown>; price: number; vendor: string;
  product_type: string; shopify_product_id: string | null; status: string;
  cost_usd: number;
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
      toast.success(`${fn} done`);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : `${fn} failed`);
    } finally { setBusy(null); }
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

      <Card className="border-2 border-foreground">
        <CardHeader><CardTitle>Cover & PDF</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {e.cover_url ? <img src={e.cover_url} alt="Cover" className="max-w-xs border-2 border-foreground" /> : <p className="text-sm text-muted-foreground">No cover yet.</p>}
          {e.pdf_url && <a href={e.pdf_url} target="_blank" rel="noreferrer" className="text-sm underline">Open PDF</a>}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 border-2 border-foreground bg-card p-4 flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy === "save"}>{busy === "save" && <Loader2 className="size-4 animate-spin" />} Save edits</Button>
        <Button variant="outline" onClick={() => run("qc-check")} disabled={!!busy}>Run QC</Button>
        <Button variant="outline" onClick={() => run("generate-cover")} disabled={!!busy || e.status === "qc_failed"}>Generate cover</Button>
        <Button variant="outline" onClick={() => run("build-pdf")} disabled={!!busy}>Build PDF</Button>
        <Button variant="outline" onClick={() => run("push-to-shopify")} disabled={!!busy || e.status === "qc_failed"}>Push to Shopify draft</Button>
      </div>
    </div>
  );
}
