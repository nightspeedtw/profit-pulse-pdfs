import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { Loader2, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OrderRow {
  id: string;
  amount_total: number;
  currency: string;
  paid_at: string | null;
  status: string;
}
interface GrantRow {
  token: string;
  ebook_id: string;
  expires_at: string;
  download_count: number;
  max_downloads: number;
  ebooks: { title: string; cover_url: string | null } | null;
}

export default function Library() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setSignedIn(false);
        setLoading(false);
        return;
      }
      setSignedIn(true);
      const [{ data: o }, { data: g }] = await Promise.all([
        supabase.from("orders").select("id, amount_total, currency, paid_at, status").order("created_at", { ascending: false }),
        supabase.from("download_grants").select("token, ebook_id, expires_at, download_count, max_downloads, ebooks:ebook_id(title, cover_url)"),
      ]);
      setOrders((o as OrderRow[]) ?? []);
      setGrants((g as unknown as GrantRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const download = async (token: string) => {
    const { data, error } = await supabase.functions.invoke("download-ebook", { body: { token } });
    if (error || !data?.url) {
      alert(error?.message || data?.error || "Download failed");
      return;
    }
    window.open(data.url, "_blank");
  };

  if (loading) {
    return (
      <div className="container py-24 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container py-12 max-w-4xl">
      <h1 className="font-display text-4xl uppercase mb-6">Your Library</h1>
      {!signedIn ? (
        <div className="border-2 border-dashed border-foreground p-8 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            Sign in to see your past orders. If you bought as a guest, use the download link from your receipt email
            or the <Link to="/download" className="underline">download page</Link>.
          </p>
        </div>
      ) : grants.length === 0 ? (
        <div className="border-2 border-dashed border-foreground p-8 text-center">
          <p className="text-sm text-muted-foreground">No purchases yet. <Link to="/library" className="underline">Browse the library</Link>.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grants.map((g) => {
            const remaining = g.max_downloads - g.download_count;
            const expired = new Date(g.expires_at) < new Date();
            return (
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
                  <p className="text-xs text-muted-foreground">
                    {expired ? "Expired" : `Expires ${new Date(g.expires_at).toLocaleDateString()}`} · {remaining} download{remaining === 1 ? "" : "s"} left
                  </p>
                </div>
                <Button onClick={() => download(g.token)} disabled={expired || remaining <= 0} className="gap-2">
                  <Download className="h-4 w-4" /> Download
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {orders.length > 0 && (
        <div className="mt-10">
          <h2 className="font-display text-xl uppercase mb-3">Order history</h2>
          <div className="border-2 border-foreground divide-y-2 divide-foreground/10">
            {orders.map((o) => (
              <div key={o.id} className="flex justify-between p-3 text-sm">
                <span className="font-mono">{o.paid_at ? new Date(o.paid_at).toLocaleString() : "—"}</span>
                <span className="font-display">{o.currency.toUpperCase()} ${(o.amount_total / 100).toFixed(2)}</span>
                <span className="uppercase text-xs">{o.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
