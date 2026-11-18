import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCartStore } from "@/stores/cartStore";
import { CheckCircle2, Loader2, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Grant {
  token: string;
  ebook_id: string;
  expires_at: string;
  ebooks: { title: string; cover_url: string | null } | null;
}

// GA4 purchase (owner 2026-11-18: KPI = PDF purchases + revenue). Sent once per Stripe session after the
// server returned the paid order; amount_total is in minor units. Goes to the gtag queue and the GTM
// dataLayer (GA4 dedupes purchase events by transaction_id).
function sendPurchase(
  sessionId: string,
  order: { amount_total?: number | null; currency?: string | null } | null | undefined,
  grants: Grant[],
) {
  try {
    const key = `ga4-purchase:${sessionId}`;
    if (window.localStorage.getItem(key)) return;
    const value = Math.round(Number(order?.amount_total ?? 0)) / 100;
    const currency = String(order?.currency || "usd").toUpperCase();
    const items = grants.map((g) => ({ item_id: g.ebook_id, item_name: g.ebooks?.title ?? g.ebook_id, quantity: 1 }));
    const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({ ecommerce: null });
    w.dataLayer.push({ event: "purchase", ecommerce: { transaction_id: sessionId, value, currency, items } });
    w.gtag?.("event", "purchase", { transaction_id: sessionId, value, currency, items });
    window.localStorage.setItem(key, "1");
  } catch {
    /* analytics must never break the download page */
  }
}

export default function CheckoutReturn() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const [status, setStatus] = useState<"loading" | "ready" | "pending" | "error">("loading");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [email, setEmail] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const clearCart = useCartStore((s) => s.clearCart);

  useEffect(() => {
    if (!sessionId) {
      setStatus("error");
      setError("Missing session id");
      return;
    }
    let cancelled = false;
    let tries = 0;
    const poll = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("get-order-by-session", {
          body: { session_id: sessionId },
        });
        if (error) throw new Error(error.message);
        if (cancelled) return;
        if (data?.status === "ready") {
          sendPurchase(sessionId, data.order, data.grants ?? []);
          setGrants(data.grants ?? []);
          setEmail(data.order?.buyer_email ?? "");
          setStatus("ready");
          clearCart();
          return;
        }
        tries++;
        if (tries > 30) {
          setStatus("pending");
          return;
        }
        setTimeout(poll, 2000);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setStatus("error");
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [sessionId, clearCart]);

  const download = async (token: string) => {
    const { data, error } = await supabase.functions.invoke("download-ebook", { body: { token } });
    if (error || !data?.url) {
      alert(error?.message || data?.error || "Download failed");
      return;
    }
    window.open(data.url, "_blank");
  };

  return (
    <div className="container py-16 max-w-2xl">
      {status === "loading" && (
        <div className="text-center py-20">
          <Loader2 className="h-10 w-10 animate-spin mx-auto mb-4" />
          <p className="font-mono uppercase text-sm">Confirming your order…</p>
        </div>
      )}
      {status === "error" && (
        <div className="border-2 border-destructive bg-destructive/10 p-6 text-center">
          <h1 className="font-display text-2xl uppercase mb-2">Something went wrong</h1>
          <p className="text-sm">{error}</p>
        </div>
      )}
      {status === "pending" && (
        <div className="border-2 border-foreground p-6 text-center">
          <h1 className="font-display text-2xl uppercase mb-2">Payment received</h1>
          <p className="text-muted-foreground text-sm">
            We're preparing your downloads. Refresh in a moment or check your email — the download links will be sent to you shortly.
          </p>
        </div>
      )}
      {status === "ready" && (
        <div className="space-y-6">
          <div className="border-2 border-foreground bg-highlight p-6 flex items-start gap-4">
            <CheckCircle2 className="h-8 w-8 shrink-0" />
            <div>
              <h1 className="font-display text-3xl uppercase">Thank you!</h1>
              <p className="text-sm mt-1">
                Your order is confirmed{email ? ` for ${email}` : ""}. Download your PDFs below — links stay valid for 7 days.
              </p>
            </div>
          </div>
          <div className="space-y-3">
            {grants.map((g) => (
              <div key={g.token} className="border-2 border-foreground bg-card p-4 flex items-center gap-4">
                <div className="w-16 h-16 bg-white border-2 border-foreground overflow-hidden flex items-center justify-center shrink-0">
                  {g.ebooks?.cover_url ? (
                    // SQUARE-FIRST: coloring covers must display complete; object-contain is safe for all book types.
                    <img src={g.ebooks.cover_url} alt={g.ebooks.title} className="w-full h-full object-contain" />
                  ) : (
                    <FileText className="h-6 w-6" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display uppercase truncate">{g.ebooks?.title ?? "Ebook"}</h3>
                  <p className="text-xs text-muted-foreground">Expires {new Date(g.expires_at).toLocaleDateString()}</p>
                </div>
                <Button onClick={() => download(g.token)} className="gap-2">
                  <Download className="h-4 w-4" /> Download
                </Button>
              </div>
            ))}
          </div>
          <div className="text-center pt-4">
            <Link to="/library" className="text-sm underline">Continue browsing</Link>
          </div>
        </div>
      )}
    </div>
  );
}
