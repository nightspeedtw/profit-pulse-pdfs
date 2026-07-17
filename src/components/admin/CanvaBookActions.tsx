import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Palette, ExternalLink, Download, ArrowUpCircle, Loader2 } from "lucide-react";

interface Props {
  ebookId: string;
  hasPdf: boolean;
  compact?: boolean;
}

interface CanvaMeta {
  design_id?: string;
  edit_url?: string;
  last_import_at?: string;
  last_export_at?: string;
  exported_pdf_url?: string;
  exported_page_urls?: string[];
  promoted_at?: string;
  status?: string;
}

const passcode = () =>
  typeof window !== "undefined" && localStorage.getItem("admin_passcode_ok") === "1" ? "453451" : "";

export function CanvaBookActions({ ebookId, hasPdf, compact }: Props) {
  const [meta, setMeta] = useState<CanvaMeta | null>(null);
  const [busy, setBusy] = useState<null | "import" | "export" | "promote">(null);
  const [connected, setConnected] = useState<boolean | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("ebooks_kids")
      .select("metadata")
      .eq("id", ebookId)
      .maybeSingle();
    const m = (data?.metadata as any)?.canva ?? null;
    setMeta(m);
  };

  const loadConnected = async () => {
    try {
      const r = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/canva-connect-oauth/status?passcode=${passcode()}`,
        { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } },
      );
      const j = await r.json();
      setConnected(!!j?.connected);
    } catch {
      setConnected(false);
    }
  };

  useEffect(() => {
    load();
    loadConnected();
  }, [ebookId]);

  const call = async (fn: "canva-connect-import" | "canva-connect-export" | "canva-connect-promote", key: typeof busy) => {
    setBusy(key);
    try {
      const { data, error } = await supabase.functions.invoke(fn, {
        body: { ebook_id: ebookId, ...(fn === "canva-connect-export" ? { formats: ["pdf"] } : {}) },
        headers: { "x-admin-passcode": passcode() },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: `${fn.replace("canva-connect-", "Canva ")} ok` });
      if (fn === "canva-connect-import" && (data as any)?.edit_url) {
        window.open((data as any).edit_url, "_blank", "noopener");
      }
      await load();
    } catch (e) {
      toast({ title: `${fn} failed`, description: String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (connected === false) {
    return (
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Palette className="size-3" /> Canva not connected —{" "}
        <a href="/admin/settings#canva" className="underline">connect</a>
      </div>
    );
  }

  const canImport = hasPdf && !busy;
  const hasDesign = !!meta?.design_id;
  const hasExport = !!meta?.exported_pdf_url;

  return (
    <div className={`flex gap-1 flex-wrap ${compact ? "text-[11px]" : ""}`}>
      {!hasDesign && (
        <Button size="sm" variant="outline" onClick={() => call("canva-connect-import", "import")} disabled={!canImport}>
          {busy === "import" ? <Loader2 className="size-3 animate-spin" /> : <Palette className="size-3" />}
          Edit in Canva
        </Button>
      )}
      {hasDesign && meta?.edit_url && (
        <a href={meta.edit_url} target="_blank" rel="noopener">
          <Button size="sm" variant="outline">
            <ExternalLink className="size-3" /> Open Canva
          </Button>
        </a>
      )}
      {hasDesign && (
        <Button size="sm" variant="outline" onClick={() => call("canva-connect-export", "export")} disabled={!!busy}>
          {busy === "export" ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
          Pull PDF
        </Button>
      )}
      {hasExport && !meta?.promoted_at && (
        <Button size="sm" onClick={() => call("canva-connect-promote", "promote")} disabled={!!busy}>
          {busy === "promote" ? <Loader2 className="size-3 animate-spin" /> : <ArrowUpCircle className="size-3" />}
          Use as book PDF
        </Button>
      )}
      {meta?.promoted_at && <Badge variant="outline" className="text-[10px]">Canva PDF live</Badge>}
    </div>
  );
}
