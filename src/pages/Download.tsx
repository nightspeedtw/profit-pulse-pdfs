import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Download, AlertTriangle, CheckCircle2 } from "lucide-react";

interface DownloadItem {
  ebook_id: string;
  title: string;
  download_url: string | null;
  expires_at: string | null;
  error?: string;
}

export default function DownloadPage() {
  const [params, setParams] = useSearchParams();
  const [order, setOrder] = useState(params.get("order") ?? "");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<DownloadItem[] | null>(null);
  const [orderName, setOrderName] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Download your PDF — SecretPDF";
  }, []);

  async function lookup(e?: React.FormEvent) {
    e?.preventDefault();
    if (!order.trim() || !email.trim()) {
      setErr("Enter your order number and the email used at checkout.");
      return;
    }
    setBusy(true);
    setErr(null);
    setItems(null);
    setOrderName(null);
    try {
      const { data, error } = await supabase.functions.invoke("customer-download-pdf", {
        body: { order: order.trim(), email: email.trim() },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "Could not find that order.");
      setItems(data.items ?? []);
      setOrderName(data.order ?? null);
      setParams({ order: order.trim(), email: email.trim() }, { replace: true });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // Auto-run when both ?order and ?email are present on first load.
  useEffect(() => {
    const o = params.get("order");
    const em = params.get("email");
    if (o && em && !items && !busy) {
      void lookup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <section className="border-b-2 border-foreground bg-highlight">
        <div className="container py-16">
          <p className="font-mono uppercase tracking-widest text-xs mb-3">[ Downloads ]</p>
          <h1 className="font-display text-5xl lg:text-6xl uppercase leading-[0.95]">
            Get your <span className="bg-foreground text-background px-2">PDF</span>.
          </h1>
          <p className="mt-4 max-w-2xl text-lg">
            Enter the order number from your receipt and the email you used at checkout.
            Your download links are valid for 24 hours.
          </p>
        </div>
      </section>

      <section className="container py-12 max-w-2xl">
        <Card className="border-2 border-foreground">
          <CardHeader>
            <CardTitle>Find my purchase</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={lookup} className="space-y-4">
              <div>
                <Label htmlFor="order">Order number</Label>
                <Input
                  id="order"
                  placeholder="e.g. 1001 or #1001"
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="email">Email used at checkout</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : <Download className="size-4 mr-2" />}
                Get download links
              </Button>
            </form>

            {err && (
              <div className="mt-5 flex items-start gap-2 border-2 border-destructive bg-destructive/10 p-3 text-sm">
                <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                <span>{err}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {items && (
          <Card className="border-2 border-foreground mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-green-600" />
                {orderName ? `Order ${orderName}` : "Your downloads"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No matching ebooks were found on this order yet. If you just purchased,
                  please wait a minute and try again.
                </p>
              )}
              {items.map((it) => (
                <div
                  key={it.ebook_id}
                  className="flex items-center justify-between gap-3 border-2 border-foreground/15 p-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{it.title}</div>
                    {it.error && (
                      <div className="text-xs text-destructive mt-1">{it.error}</div>
                    )}
                    {it.expires_at && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Link expires {new Date(it.expires_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                  {it.download_url ? (
                    <Button asChild size="sm">
                      <a href={it.download_url} target="_blank" rel="noreferrer">
                        <Download className="size-4 mr-2" /> Download PDF
                      </a>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled>
                      Unavailable
                    </Button>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-2">
                Trouble downloading? Reply to your order confirmation email and we'll resend the file.
              </p>
            </CardContent>
          </Card>
        )}
      </section>
    </>
  );
}
