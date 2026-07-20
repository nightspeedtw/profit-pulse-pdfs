import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAccountAuth } from "@/hooks/useAccountAuth";

export default function Orders() {
  const { user } = useAccountAuth();
  const { data, isLoading } = useQuery({
    enabled: !!user,
    queryKey: ["acct-orders", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("orders")
        .select("id, created_at, amount_total, currency, status, paid_at")
        .or(`buyer_user_id.eq.${user!.id},buyer_email.eq.${user!.email}`)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Orders & Purchases</h1>
        <p className="text-sm text-muted-foreground">Every purchase associated with your account.</p>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
      : !data?.length ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No orders yet.</CardContent></Card>
      ) : (
        <Card><CardContent className="p-0">
          <ul className="divide-y">
            {data.map((o) => (
              <li key={o.id}>
                <Link to={`/account/orders/${o.id}`} className="flex items-center justify-between p-4 hover:bg-muted/50">
                  <div className="min-w-0">
                    <p className="text-sm font-mono">#{o.id.slice(0, 8)}</p>
                    <p className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium">{(o.amount_total / 100).toFixed(2)} {o.currency.toUpperCase()}</span>
                    <Badge variant={o.status === "paid" ? "default" : "secondary"}>{o.status}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent></Card>
      )}
    </div>
  );
}
