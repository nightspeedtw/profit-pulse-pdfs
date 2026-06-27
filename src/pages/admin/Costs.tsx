import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Row { id: string; step: string; model: string; input_tokens: number; output_tokens: number; cost_usd: number; created_at: string; ebook_id: string | null }

export default function Costs() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    supabase.from("cost_log").select("*").order("created_at", { ascending: false }).limit(200)
      .then(({ data }) => setRows((data ?? []) as Row[]));
  }, []);
  const total = rows.reduce((s, r) => s + Number(r.cost_usd), 0);
  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <p className="font-mono uppercase tracking-widest text-xs">[ Costs ]</p>
        <h1 className="font-display text-4xl uppercase">AI cost log</h1>
      </div>
      <Card className="border-2 border-foreground">
        <CardHeader><CardTitle>Last 200 calls — ${total.toFixed(4)} total</CardTitle></CardHeader>
        <CardContent>
          <div className="text-xs font-mono">
            <div className="grid grid-cols-12 gap-2 border-b pb-2 mb-2 font-bold">
              <div className="col-span-3">Time</div><div className="col-span-2">Step</div><div className="col-span-3">Model</div>
              <div className="col-span-2">Tokens (in/out)</div><div className="col-span-2 text-right">USD</div>
            </div>
            {rows.map((r) => (
              <div key={r.id} className="grid grid-cols-12 gap-2 py-1 border-b border-foreground/10">
                <div className="col-span-3">{new Date(r.created_at).toLocaleString()}</div>
                <div className="col-span-2">{r.step}</div>
                <div className="col-span-3 truncate">{r.model}</div>
                <div className="col-span-2">{r.input_tokens}/{r.output_tokens}</div>
                <div className="col-span-2 text-right">${Number(r.cost_usd).toFixed(6)}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
