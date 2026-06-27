import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, XCircle, Loader2, ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type ShopifyEvent = {
  at: string;
  kind: "queued" | "success" | "failed";
  action: "push" | "publish";
  message?: string;
  error?: string;
  meta?: Record<string, unknown>;
};

interface Props {
  ebookId: string;
  status: string | null;          // shopify_status: queued | draft | publishing | published | failed
  events: ShopifyEvent[];
  lastError: string | null;
  productId: string | null;
  handle: string | null;
  onChanged: () => void;
}

const STORE_DOMAIN = "digital-wealth-hub-49qgj.myshopify.com";

function statusMeta(s: string | null) {
  switch (s) {
    case "queued":     return { label: "Queued",     tone: "bg-blue-100 text-blue-800",   icon: Loader2,      spin: true };
    case "publishing": return { label: "Publishing", tone: "bg-blue-100 text-blue-800",   icon: Loader2,      spin: true };
    case "draft":      return { label: "Draft up",   tone: "bg-amber-100 text-amber-800", icon: CheckCircle2, spin: false };
    case "published":  return { label: "Published",  tone: "bg-green-100 text-green-800", icon: CheckCircle2, spin: false };
    case "failed":     return { label: "Failed",     tone: "bg-red-100 text-red-800",     icon: XCircle,      spin: false };
    default:           return { label: s ?? "Not pushed", tone: "bg-muted text-foreground", icon: CheckCircle2, spin: false };
  }
}

export default function ShopifyStatus({ ebookId, status, events, lastError, productId, handle, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Poll while in-flight
  const inflight = status === "queued" || status === "publishing";
  useEffect(() => {
    if (!inflight) return;
    const t = setInterval(onChanged, 3000);
    return () => clearInterval(t);
  }, [inflight, onChanged]);

  // Toast on terminal status transitions
  const latest = events[events.length - 1];
  useEffect(() => {
    if (!latest) return;
    const key = `shopify-toast-${ebookId}-${latest.at}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    if (latest.kind === "success") {
      toast.success(`Shopify ${latest.action}: ${latest.message ?? "ok"}`);
    } else if (latest.kind === "failed") {
      toast.error(`Shopify ${latest.action} failed: ${latest.error ?? "unknown"}`);
    }
  }, [latest?.at, latest?.kind, latest?.action, latest?.error, latest?.message, ebookId]);

  const run = async (fn: "push-to-shopify" | "shopify-publish") => {
    setBusy(fn);
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body: { ebook_id: ebookId } });
      if (error || data?.error) throw new Error(error?.message || data?.error || "Failed");
      onChanged();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed");
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const meta = statusMeta(status);
  const Icon = meta.icon;
  const sorted = [...events].slice().reverse();
  const adminUrl = productId ? `https://${STORE_DOMAIN}/admin/products/${productId}` : null;

  return (
    <Card className="border-2 border-foreground">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <span>Shopify status</span>
          <Badge className={`${meta.tone} border-0`}>
            <Icon className={`size-3 mr-1 ${meta.spin ? "animate-spin" : ""}`} />
            {meta.label}
          </Badge>
          {adminUrl && (
            <a href={adminUrl} target="_blank" rel="noreferrer" className="ml-auto text-xs font-mono uppercase hover:underline flex items-center gap-1">
              Open in Shopify <ExternalLink className="size-3" />
            </a>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {lastError && (
          <div className="rounded border border-red-300 bg-red-50 p-3">
            <div className="font-mono uppercase text-xs font-bold text-red-700 mb-1">Last error</div>
            <pre className="text-xs text-red-900 whitespace-pre-wrap break-words">{lastError}</pre>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" disabled={!!busy || inflight} onClick={() => run("push-to-shopify")}>
            {busy === "push-to-shopify" ? <Loader2 className="size-3 animate-spin mr-1" /> : <RefreshCw className="size-3 mr-1" />}
            {productId ? "Re-push draft" : "Push to Shopify draft"}
          </Button>
          {productId && (
            <Button size="sm" disabled={!!busy || inflight} onClick={() => run("shopify-publish")}>
              {busy === "shopify-publish" ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
              Publish to live store
            </Button>
          )}
        </div>

        {sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground">No Shopify events yet.</p>
        ) : (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between font-mono uppercase text-xs">
                <span>Event timeline ({sorted.length})</span>
                <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1.5 pt-2 max-h-72 overflow-auto">
              {sorted.map((ev, i) => {
                const m = statusMeta(ev.kind === "success" ? (ev.action === "publish" ? "published" : "draft") : ev.kind);
                const EvIcon = ev.kind === "success" ? CheckCircle2 : ev.kind === "failed" ? XCircle : Loader2;
                const color = ev.kind === "success" ? "text-green-700" : ev.kind === "failed" ? "text-red-700" : "text-blue-700";
                return (
                  <div key={`${ev.at}-${i}`} className="flex items-start gap-2 border border-foreground/10 rounded p-2 bg-muted/30">
                    <EvIcon className={`size-4 mt-0.5 shrink-0 ${color} ${ev.kind === "queued" ? "animate-spin" : ""}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <span className="font-mono uppercase font-bold">{ev.action}</span>
                        <Badge variant="outline" className="text-[10px] py-0">{ev.kind}</Badge>
                        <span className="text-muted-foreground ml-auto">{new Date(ev.at).toLocaleString()}</span>
                      </div>
                      {ev.message && <p className="text-xs mt-1">{ev.message}</p>}
                      {ev.error && <p className="text-xs mt-1 text-red-700 break-words">{ev.error}</p>}
                    </div>
                  </div>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        )}

        {handle && (
          <p className="text-[11px] font-mono text-muted-foreground">
            handle: <span className="text-foreground">{handle}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
