import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Palette, Plug, PlugZap } from "lucide-react";

const passcode = () =>
  typeof window !== "undefined" && localStorage.getItem("admin_passcode_ok") === "1" ? "453451" : "";

interface Status { connected: boolean; expires_at?: string; connected_at?: string; scope?: string }

export function CanvaConnectionCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/canva-connect-oauth/status?passcode=${passcode()}`,
        { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } },
      );
      setStatus(await r.json());
    } catch (e) {
      toast({ title: "Canva status load failed", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const startUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/canva-connect-oauth/start?passcode=${passcode()}`;

  const disconnect = async () => {
    try {
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/canva-connect-oauth/disconnect?passcode=${passcode()}`,
        { method: "GET", headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } },
      );
      toast({ title: "Canva disconnected" });
      load();
    } catch (e) {
      toast({ title: "Disconnect failed", description: String(e), variant: "destructive" });
    }
  };

  return (
    <Card id="canva" className="p-4 border-2 border-foreground">
      <div className="flex items-center gap-2 mb-3">
        <Palette className="size-5" />
        <h2 className="font-display uppercase text-lg">Canva Round-Trip</h2>
        {status?.connected ? (
          <Badge className="bg-emerald-600">connected</Badge>
        ) : (
          <Badge variant="outline">not connected</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        One shared admin Canva account. Import a generated coloring-book PDF into Canva, edit,
        then pull the exported PDF back into the book. Requires <code>CANVA_CLIENT_ID</code> and{" "}
        <code>CANVA_CLIENT_SECRET</code> secrets, and this redirect URI registered in your Canva app:
      </p>
      <pre className="text-[11px] bg-muted p-2 border border-foreground/20 mb-3 overflow-x-auto">
        {import.meta.env.VITE_SUPABASE_URL}/functions/v1/canva-connect-oauth/callback
      </pre>
      {status?.connected && (
        <p className="text-xs mb-3">
          Connected {status.connected_at?.slice(0, 19) ?? ""} · token expires {status.expires_at?.slice(0, 19) ?? ""}
        </p>
      )}
      <div className="flex gap-2 flex-wrap">
        <a href={startUrl} target="_blank" rel="noopener">
          <Button variant={status?.connected ? "outline" : "default"} disabled={loading}>
            <PlugZap className="size-4" /> {status?.connected ? "Reconnect Canva" : "Connect Canva"}
          </Button>
        </a>
        {status?.connected && (
          <Button variant="outline" onClick={disconnect}>
            <Plug className="size-4" /> Disconnect
          </Button>
        )}
      </div>
    </Card>
  );
}
