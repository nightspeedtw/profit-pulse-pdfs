import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAccountAuth } from "@/hooks/useAccountAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";

interface Holding {
  book_id: string;
  book_kind: string;
  shares: number;
  avg_cost_cents: number;
}
interface Summary {
  book_id: string;
  book_kind: string;
  accrued_cents: number;
  paid_cents: number;
}

function usd(cents: number) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

export default function AccountRoyalties() {
  const { user } = useAccountAuth();
  const [loading, setLoading] = useState(true);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [summary, setSummary] = useState<Record<string, Summary>>({});
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: h }, { data: s }, { data: ps }] = await Promise.all([
        supabase.from("roy_holdings").select("book_id,book_kind,shares,avg_cost_cents").eq("user_id", user.id),
        supabase.from("roy_accrual_summary").select("book_id,book_kind,accrued_cents,paid_cents").eq("user_id", user.id),
        supabase.from("platform_settings").select("royalty_live").limit(1).maybeSingle(),
      ]);
      setHoldings((h ?? []) as Holding[]);
      const map: Record<string, Summary> = {};
      for (const row of (s ?? []) as Summary[]) map[`${row.book_id}:${row.book_kind}`] = row;
      setSummary(map);
      setLive(!!(ps as any)?.royalty_live);
      setLoading(false);
    })();
  }, [user]);

  if (loading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <TrendingUp className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">My Royalties</h1>
        <Badge variant={live ? "default" : "secondary"}>{live ? "Live" : "Preview"}</Badge>
      </div>

      {!live && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-4 text-sm text-amber-900">
            Royalty participation is in preview. Accruals are paused until launch. You can view any pilot allocations below.
          </CardContent>
        </Card>
      )}

      {holdings.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <p className="text-lg font-medium mb-2">No royalty holdings yet</p>
            <p className="text-sm">Royalty participation opens soon. When available, purchased shares will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Holdings</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-4">Book</th>
                    <th className="py-2 pr-4">Kind</th>
                    <th className="py-2 pr-4 text-right">Shares</th>
                    <th className="py-2 pr-4 text-right">Avg Cost</th>
                    <th className="py-2 pr-4 text-right">Accrued</th>
                    <th className="py-2 pr-4 text-right">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => {
                    const s = summary[`${h.book_id}:${h.book_kind}`];
                    return (
                      <tr key={`${h.book_id}:${h.book_kind}`} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono text-xs truncate max-w-[220px]">{h.book_id}</td>
                        <td className="py-2 pr-4"><Badge variant="outline">{h.book_kind}</Badge></td>
                        <td className="py-2 pr-4 text-right">{h.shares.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right">{usd(h.avg_cost_cents)}</td>
                        <td className="py-2 pr-4 text-right font-medium text-emerald-700">{usd(s?.accrued_cents ?? 0)}</td>
                        <td className="py-2 pr-4 text-right text-muted-foreground">{usd(s?.paid_cents ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
