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
                <div className="w-14 h-20 bg-secondary border-2 border-foreground overflow-hidden flex items-center justify-center shrink-0">
                  {g.ebooks?.cover_url ? (
                    <img src={g.ebooks.cover_url} alt={g.ebooks.title} className="w-full h-full object-cover" />
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
