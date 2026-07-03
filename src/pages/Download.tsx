import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSearchParams } from "react-router-dom";
import { Download, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function DownloadPage() {
  const [params] = useSearchParams();
  const initial = params.get("token") ?? "";
  const [token, setToken] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<{ url: string; title?: string; remaining?: number } | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const { data, error } = await supabase.functions.invoke("download-ebook", { body: { token: token.trim() } });
      if (error || !data?.url) throw new Error(error?.message || data?.error || "Download failed");
      setOk({ url: data.url, title: data.title, remaining: data.remaining });
      window.open(data.url, "_blank");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container py-16 max-w-xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-12 w-12 border-2 border-foreground flex items-center justify-center">
          <FileText className="h-6 w-6" />
        </div>
        <h1 className="font-display text-3xl uppercase">Download</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Paste your download token from your receipt email, or click the link in that email.
      </p>
      <form onSubmit={submit} className="space-y-3 border-2 border-foreground p-6">
        <Input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Download token"
          className="border-2 border-foreground rounded-none h-12"
        />
        <Button type="submit" disabled={!token.trim() || busy} className="w-full h-12">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Download className="h-4 w-4 mr-2" /> Get PDF</>}
        </Button>
      </form>
      {err && <div className="mt-4 border-2 border-destructive bg-destructive/10 p-4 text-sm">{err}</div>}
      {ok && (
        <div className="mt-4 border-2 border-foreground bg-highlight p-4 text-sm">
          {ok.title && <div className="font-display uppercase mb-1">{ok.title}</div>}
          {typeof ok.remaining === "number" && <div className="text-xs text-muted-foreground">Downloads remaining: {ok.remaining}</div>}
          <a href={ok.url} target="_blank" rel="noreferrer" className="underline text-sm mt-2 inline-block">Open PDF</a>
        </div>
      )}
    </div>
  );
}
