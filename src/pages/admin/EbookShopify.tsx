// Milestone 7 — Shopify Draft Upload dashboard.
// Upload the ebook (PDF + cover + product copy) as a DRAFT product to
// Shopify. Shows shopify_sync_logs with retry count, file upload status,
// error messages, and the resulting product ID + admin link.
// Auto-publishing is NOT performed in this milestone.
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Upload, ExternalLink, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

type Ebook = any;
type SyncLog = any;

export default function EbookShopify() {
  const { id } = useParams();
  const [ebook, setEbook] = useState<Ebook | null>(null);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!id) return;
    const [{ data: e }, { data: l }] = await Promise.all([
      supabase.from("ebooks").select("*").eq("id", id).maybeSingle(),
      supabase.from("shopify_sync_logs").select("*").eq("ebook_id", id)
        .order("created_at", { ascending: false }).limit(20),
    ]);
    setEbook(e); setLogs(l ?? []);
  }
  useEffect(() => { load(); }, [id]);

  async function upload() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-draft-upload", {
        body: { ebook_id: id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({
        title: "Draft uploaded",
        description: `Product ${data.product_id} · PDF: ${data.pdf_file_status}`,
      });
      load();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message ?? String(e), variant: "destructive" });
    } finally { setBusy(false); }
  }

  if (!ebook) return <div className="p-6"><Loader2 className="animate-spin" /></div>;

  const ready = !!ebook.pdf_url && !!ebook.cover_url;
  const readinessChecks: [string, boolean][] = [
    ["PDF rendered", !!ebook.pdf_url],
    ["Cover image present", !!ebook.cover_url],
    ["Cover approved", !!ebook.cover_approved],
    ["PDF approved", !!ebook.pdf_approved],
    ["Product description", !!ebook.product_description],
    ["SEO title", !!ebook.seo_title],
    ["SEO meta", !!ebook.seo_meta],
    ["Price set", Number(ebook.price ?? 0) > 0],
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs">[ Shopify Draft Upload ]</p>
          <h1 className="font-display text-3xl uppercase leading-tight">{ebook.title}</h1>
          <div className="flex gap-2 mt-3 flex-wrap">
            <Badge variant="outline">shopify_status: {ebook.shopify_status ?? "—"}</Badge>
            {ebook.shopify_product_id && <Badge variant="outline">product_id: {ebook.shopify_product_id}</Badge>}
            {ebook.shopify_handle && <Badge variant="outline">/{ebook.shopify_handle}</Badge>}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-4" /></Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Readiness</p>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {readinessChecks.map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                {v ? <CheckCircle2 className="size-3.5 text-green-600" /> : <XCircle className="size-3.5 text-red-600" />}
                <span className={v ? "" : "text-red-700"}>{k}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap pt-2">
            <Button disabled={busy || !ready} onClick={upload}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {ebook.shopify_product_id ? "Re-upload Draft" : "Upload as Draft"}
            </Button>
            {ebook.shopify_product_id && (
              <Button asChild variant="outline">
                <a href={`https://admin.shopify.com/store/${(import.meta as any).env.VITE_SHOPIFY_STORE ?? "store"}/products/${ebook.shopify_product_id}`}
                  target="_blank" rel="noreferrer">
                  Open in Shopify Admin <ExternalLink className="size-3" />
                </a>
              </Button>
            )}
            <Link to={`/admin/ebook/${id}/pdf`} className="text-sm underline text-muted-foreground self-center">← PDF</Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Uploads PDF + cover + product copy as a <strong>draft</strong> product. Publishing is intentionally manual until Milestone 8.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Sync logs</p>
          {logs.length === 0 && <p className="text-xs text-muted-foreground">No sync attempts yet.</p>}
          <div className="space-y-2">
            {logs.map((l) => {
              const status = l.status as string;
              const cls = status === "ok"
                ? "bg-green-500/10 text-green-700 border-green-500/30"
                : status === "partial"
                  ? "bg-yellow-500/10 text-yellow-700 border-yellow-500/30"
                  : status === "failed"
                    ? "bg-red-500/10 text-red-700 border-red-500/30"
                    : "bg-muted text-muted-foreground";
              return (
                <details key={l.id} className="border border-foreground/10 rounded">
                  <summary className="px-3 py-2 cursor-pointer flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <Badge variant="outline" className={cls}>{status}</Badge>
                      <span className="font-mono text-xs">{l.action}</span>
                      {l.file_upload_status && <span className="text-xs text-muted-foreground">file: {l.file_upload_status}</span>}
                      {l.retry_count > 0 && <span className="text-xs text-muted-foreground">retry #{l.retry_count}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</span>
                  </summary>
                  <div className="px-3 py-2 text-xs space-y-2 border-t border-foreground/10">
                    {l.shopify_product_id && <div><strong>Product ID:</strong> {l.shopify_product_id}</div>}
                    {l.error && (
                      <div className="flex items-start gap-2 text-red-700">
                        <AlertTriangle className="size-3.5 mt-0.5" />
                        <span>{l.error}</span>
                      </div>
                    )}
                    <details><summary className="cursor-pointer text-muted-foreground">request_payload</summary>
                      <pre className="text-[10px] overflow-auto max-h-40 bg-muted p-2 mt-1">{JSON.stringify(l.request_payload, null, 2)}</pre>
                    </details>
                    <details><summary className="cursor-pointer text-muted-foreground">response_payload</summary>
                      <pre className="text-[10px] overflow-auto max-h-40 bg-muted p-2 mt-1">{JSON.stringify(l.response_payload, null, 2)}</pre>
                    </details>
                  </div>
                </details>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
