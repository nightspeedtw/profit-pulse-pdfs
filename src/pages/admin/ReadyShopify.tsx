import { useCallback, useEffect, useState } from "react";
import { Rocket, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fetchAdminData } from "@/lib/adminData";
import { ReadyShopifyCard, type ReadyEbook } from "@/components/admin/ReadyShopifyCard";

type Filter = "all" | "ready" | "blocked" | "uploaded";

interface LiveQueueResp {
  ready_to_publish: ReadyEbook[];
}

export default function ReadyShopify() {
  const [items, setItems] = useState<ReadyEbook[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const d = await fetchAdminData<LiveQueueResp>("live_queue");
      setItems(d.ready_to_publish ?? []);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = (items ?? []).filter((e) => {
    const uploaded = !!e.shopify_product_id;
    const hasPackage = !!(e.shopify_title && e.body_html && e.price);
    const ready = hasPackage && e.qc?.ready_for_shopify === true && !uploaded;
    if (filter === "uploaded") return uploaded;
    if (filter === "ready") return ready;
    if (filter === "blocked") return !uploaded && !ready;
    return true;
  });

  const counts = {
    all: items?.length ?? 0,
    ready: (items ?? []).filter((e) => e.shopify_title && e.body_html && e.price && e.qc?.ready_for_shopify && !e.shopify_product_id).length,
    blocked: (items ?? []).filter((e) => !e.shopify_product_id && !(e.shopify_title && e.body_html && e.price && e.qc?.ready_for_shopify)).length,
    uploaded: (items ?? []).filter((e) => !!e.shopify_product_id).length,
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl uppercase flex items-center gap-2">
            <Rocket className="h-7 w-7" /> Ready to List
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Finished ebooks packaged as premium store listings — thumbnail, price, hook, description.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
        </Button>
      </header>

      <div className="flex flex-wrap gap-2">
        {(["all", "ready", "blocked", "uploaded"] as Filter[]).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
            className="capitalize"
          >
            {f} <Badge variant="secondary" className="ml-2">{counts[f]}</Badge>
          </Button>
        ))}
      </div>

      {err && (
        <div className="border-2 border-destructive p-3 text-sm text-destructive">{err}</div>
      )}

      {items == null ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="border-2 border-dashed border-muted-foreground/30 p-10 text-center text-muted-foreground">
          {filter === "all"
            ? "No ebooks have finished production yet."
            : `No ebooks match "${filter}".`}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((e) => (
            <ReadyShopifyCard key={e.id} ebook={e} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
