// AI Providers card — shows which billing routes are wired and the
// last-7-days spend split so we can see direct-API savings vs Gateway.
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Zap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Provider = { present: boolean; ping: { ok: boolean; note?: string }; secret_name: string };
type Data = {
  providers: { gemini_direct: Provider; fal_direct: Provider; lovable_gateway: Provider };
  spend_7d: { google_direct: number; fal_direct: number; gateway: number; unknown: number; total: number };
  as_of: string;
};

function Dot({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />;
}

function usd(n: number) { return `$${n.toFixed(2)}`; }

export function AiProvidersCard() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: d, error } = await supabase.functions.invoke("admin-ai-providers", { body: {} });
      if (error) throw error;
      if (d?.ok) setData(d as Data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const rows = data ? [
    { label: "Google (direct)", key: "google_direct" as const, prov: data.providers.gemini_direct, spend: data.spend_7d.google_direct },
    { label: "Fal.ai (direct)", key: "fal_direct" as const, prov: data.providers.fal_direct, spend: data.spend_7d.fal_direct },
    { label: "Lovable Gateway", key: "gateway" as const, prov: data.providers.lovable_gateway, spend: data.spend_7d.gateway },
  ] : [];

  const savingsPct = data && data.spend_7d.total > 0
    ? Math.round(((data.spend_7d.google_direct + data.spend_7d.fal_direct) / data.spend_7d.total) * 100)
    : 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Zap className="h-4 w-4" /> AI Providers
          </div>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {!data ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (
          <>
            <div className="space-y-1.5">
              {rows.map((r) => (
                <div key={r.key} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Dot ok={r.prov.present && r.prov.ping.ok} />
                    <span className="font-medium">{r.label}</span>
                    <span className="text-muted-foreground">
                      {r.prov.present
                        ? (r.prov.ping.ok ? "ready" : `key set · ping ${r.prov.ping.note ?? "failed"}`)
                        : "not set"}
                    </span>
                  </div>
                  <div className="tabular-nums text-muted-foreground">{usd(r.spend)}</div>
                </div>
              ))}
            </div>
            <div className="border-t pt-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">7d total AI spend</span>
              <span className="tabular-nums font-medium">{usd(data.spend_7d.total)}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {savingsPct > 0
                ? <>Direct-API served <b>{savingsPct}%</b> of AI spend this week (bypassing gateway markup).</>
                : <>All AI spend is routed via Lovable Gateway. Add <code>GEMINI_API_KEY</code> and <code>FAL_API_KEY</code> in Project Settings → Secrets to enable direct-API routing (~30–50% cheaper).</>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
