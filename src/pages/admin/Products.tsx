// Products — Shopify drafts + published catalogue.
// 5 max actions per row: Preview PDF · Open Shopify Draft · Publish · Regenerate Cover · Regenerate PDF.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, ExternalLink, Rocket, ImageIcon, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { downloadAdminPdf } from "@/lib/pdf";
import { FEATURES } from "@/config/features";

type Product = {
  id: string; title: string; price: number | null;
  cover_url: string | null; pdf_url: string | null;
  shopify_status: string | null; shopify_product_id: string | null;
  final_quality_score: number | null;
  pdf_status: string | null;
};

type FilterKey = "all" | "draft" | "published";

export default function Products() {
  const [items, setItems] = useState<Product[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [storeDomain, setStoreDomain] = useState<string>("digital-wealth-hub-49qgj");

  async function load() {
    const { data } = await supabase.from("ebooks")
      .select("id,title,price,cover_url,pdf_url,shopify_status,shopify_product_id,final_quality_score,pdf_status")
      .in("shopify_status", ["draft", "published", "active"])
      .order("updated_at", { ascending: false }).limit(100);
    setItems((data ?? []) as Product[]);
  }
  useEffect(() => {
    load();
    // best-effort: read the configured Shopify store from generation_settings/metadata if present
    supabase.from("generation_settings").select("*").eq("id", 1).maybeSingle().then(({ data }) => {
      const meta = (data as { shopify_store_domain?: string } | null) ?? null;
      if (meta?.shopify_store_domain) setStoreDomain(meta.shopify_store_domain);
    });
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((p) => {
      if (filter === "draft" && p.shopify_status !== "draft") return false;
      if (filter === "published" && p.shopify_status !== "published" && p.shopify_status !== "active") return false;
      if (term && !(p.title ?? "").toLowerCase().includes(term)) return false;
      return true;
    });
  }, [items, filter, search]);

  async function previewPdf(p: Product) {
    setBusy(p.id);
    try { await downloadAdminPdf(p.id, p.title); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Download failed"); }
    finally { setBusy(null); }
  }

  async function regenerateCover(p: Product) {
    setBusy(p.id);
    try {
      const { error } = await supabase.functions.invoke("generate-cover", { body: { ebook_id: p.id } });
      if (error) throw error;
      toast.success("Cover regeneration queued");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(null); }
  }

  async function regeneratePdf(p: Product) {
    setBusy(p.id);
    try {
      const fn = FEATURES.LEGACY_PIPELINE ? "build-pdf" : "render-pdf";
      const { error } = await supabase.functions.invoke(fn, { body: { ebook_id: p.id, force: true } });
      if (error) throw error;
      toast.success("PDF rebuild queued");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(null); }
  }

  async function publish(p: Product) {
    if (!p.shopify_product_id) {
      toast.error("Not uploaded to Shopify yet. Open the job and run Shopify upload first.");
      return;
    }
    if (!confirm(`Publish "${p.title}" to Shopify?`)) return;
    setBusy(p.id);
    try {
      const { error } = await supabase.functions.invoke("shopify-publish", { body: { ebook_id: p.id } });
      if (error) throw error;
      toast.success("Published to Shopify");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">[ Products ]</p>
          <h1 className="font-display text-4xl uppercase">Shopify catalogue</h1>
        </div>
        <div className="flex gap-2 items-center">
          <Input placeholder="Search by title…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
          <Select value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({items.length})</SelectItem>
              <SelectItem value="draft">Drafts ({items.filter((i) => i.shopify_status === "draft").length})</SelectItem>
              <SelectItem value="published">Published ({items.filter((i) => i.shopify_status === "published" || i.shopify_status === "active").length})</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.length === 0 && (
          <Card className="border-2 border-foreground col-span-full">
            <CardContent className="p-10 text-center text-muted-foreground text-sm">
              No products yet. Completed ebooks upload here once Shopify draft creation succeeds.
            </CardContent>
          </Card>
        )}
        {filtered.map((p) => {
          const ready = (p.final_quality_score ?? 0) >= 90 && (p.pdf_status === "pdf_ready" || p.pdf_status === "ready");
          const draftUrl = p.shopify_product_id ? `https://admin.shopify.com/store/${storeDomain}/products/${p.shopify_product_id}` : null;
          return (
            <Card key={p.id} className="border-2 border-foreground flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-start gap-3">
                  <div className="w-16 h-20 border border-foreground/20 bg-muted overflow-hidden flex-shrink-0">
                    {p.cover_url
                      ? <img src={p.cover_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full grid place-items-center text-muted-foreground"><ImageIcon className="size-5" /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link to={`/admin/ebook/${p.id}`} className="font-medium hover:underline line-clamp-2">{p.title || "Untitled"}</Link>
                    <div className="mt-1 flex items-center gap-2 flex-wrap text-xs">
                      <StatusBadge kind={p.shopify_status === "published" || p.shopify_status === "active" ? "published" : "draft_uploaded"} />
                      <span className="font-mono">QC {p.final_quality_score ?? "—"}</span>
                      <span className="font-mono">${(p.price ?? 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 mt-auto space-y-2">
                <div className="text-xs text-muted-foreground">
                  {ready
                    ? <span className="text-emerald-700 font-bold">✓ Ready to publish</span>
                    : <span>Publish-ready when QC ≥ 85 and PDF ready.</span>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" disabled={!p.pdf_url || busy === p.id} onClick={() => previewPdf(p)}>
                    {busy === p.id ? <Loader2 className="size-3 animate-spin mr-1" /> : <FileText className="size-3 mr-1" />} Preview PDF
                  </Button>
                  <Button size="sm" variant="outline" asChild disabled={!draftUrl}>
                    {draftUrl
                      ? <a href={draftUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-3 mr-1" /> Shopify Draft</a>
                      : <span><ExternalLink className="size-3 mr-1" /> Shopify Draft</span>}
                  </Button>
                  <Button size="sm" disabled={!ready || busy === p.id || p.shopify_status === "published"} onClick={() => publish(p)}>
                    <Rocket className="size-3 mr-1" /> {p.shopify_status === "published" ? "Published" : "Publish"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === p.id} onClick={() => regenerateCover(p)} title="Regenerate cover">
                    <ImageIcon className="size-3 mr-1" /> Cover
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === p.id} onClick={() => regeneratePdf(p)} title="Regenerate PDF" className="col-span-2">
                    <RefreshCw className="size-3 mr-1" /> Regenerate PDF
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
