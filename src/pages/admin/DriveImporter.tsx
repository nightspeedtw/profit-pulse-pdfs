import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, RefreshCw, ExternalLink } from "lucide-react";

type Config = {
  root_folder_id: string;
  enabled: boolean;
  default_price_cents: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
};

type Product = {
  id: string;
  title: string;
  category: string;
  status: string;
  price_cents: number;
  drive_parent_folder_name: string | null;
  pdf_url: string | null;
  created_at: string;
};

export default function DriveImporter() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from("drive_import_config").select("*").eq("id", true).maybeSingle(),
      supabase
        .from("drive_products")
        .select("id,title,category,status,price_cents,drive_parent_folder_name,pdf_url,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    setCfg(c as Config | null);
    setProducts((p as Product[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function runSync() {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("drive-importer", { body: {} });
      if (error) throw error;
      toast.success(
        `Synced: ${data.imported} new, ${data.updated} updated, ${data.skipped} skipped, ${data.errors?.length || 0} errors`,
      );
      await load();
    } catch (e) {
      toast.error(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl uppercase">Google Drive Importer</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Auto-sells PDFs from your Drive folder. Runs hourly + manual trigger.
          </p>
        </div>
        <Button onClick={runSync} disabled={syncing}>
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Sync Now
        </Button>
      </div>

      {cfg && (
        <div className="border-2 border-foreground p-4 bg-card space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-muted-foreground text-xs uppercase">Folder</div>
              <a
                href={`https://drive.google.com/drive/folders/${cfg.root_folder_id}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs underline flex items-center gap-1"
              >
                {cfg.root_folder_id.slice(0, 16)}… <ExternalLink className="size-3" />
              </a>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase">Enabled</div>
              <div className="font-bold">{cfg.enabled ? "YES" : "NO"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase">Default Price</div>
              <div className="font-bold">${(cfg.default_price_cents / 100).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase">Last Sync</div>
              <div className="text-xs">
                {cfg.last_sync_at ? new Date(cfg.last_sync_at).toLocaleString() : "never"}{" "}
                {cfg.last_sync_status && (
                  <span
                    className={
                      cfg.last_sync_status === "ok"
                        ? "text-green-600"
                        : cfg.last_sync_status === "error"
                        ? "text-red-600"
                        : "text-yellow-600"
                    }
                  >
                    ({cfg.last_sync_status})
                  </span>
                )}
              </div>
            </div>
          </div>
          {cfg.last_sync_message && (
            <div className="text-xs text-muted-foreground font-mono border-t pt-2 truncate">
              {cfg.last_sync_message}
            </div>
          )}
        </div>
      )}

      <div className="border-2 border-foreground">
        <div className="p-3 border-b-2 border-foreground bg-card font-mono uppercase text-xs">
          Products ({products.length})
        </div>
        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : products.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No products yet. Click "Sync Now" to import PDFs from Drive.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b-2 border-foreground bg-muted/30">
              <tr className="text-left">
                <th className="p-2">Title</th>
                <th className="p-2">Category</th>
                <th className="p-2">Folder</th>
                <th className="p-2">Price</th>
                <th className="p-2">Status</th>
                <th className="p-2">PDF</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b hover:bg-muted/20">
                  <td className="p-2 font-medium">{p.title}</td>
                  <td className="p-2">
                    <span className="text-xs font-mono uppercase">{p.category}</span>
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">{p.drive_parent_folder_name}</td>
                  <td className="p-2">${(p.price_cents / 100).toFixed(2)}</td>
                  <td className="p-2">
                    <span
                      className={`text-xs font-mono uppercase ${
                        p.status === "live" ? "text-green-600" : "text-muted-foreground"
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="p-2">
                    {p.pdf_url && (
                      <a href={p.pdf_url} target="_blank" rel="noreferrer" className="underline text-xs">
                        open
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
