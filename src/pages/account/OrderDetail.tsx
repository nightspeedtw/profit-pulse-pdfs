import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAccountAuth } from "@/hooks/useAccountAuth";

export default function OrderDetail() {
  const { id } = useParams();
  const { user } = useAccountAuth();
  const { data } = useQuery({
    enabled: !!id && !!user,
    queryKey: ["acct-order", id],
    queryFn: async () => {
      const { data: order } = await supabase.from("orders").select("*").eq("id", id!).maybeSingle();
      if (!order) return null;
      const isOwner = (order.buyer_user_id && order.buyer_user_id === user!.id) ||
                      order.buyer_email?.toLowerCase() === user!.email?.toLowerCase();
      if (!isOwner) return null;
      const { data: items } = await supabase.from("order_items").select("*").eq("order_id", id!);
      return { order, items: items ?? [] };
    },
  });

  if (!data) return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm"><Link to="/account/orders"><ChevronLeft className="h-4 w-4 mr-1" />Back</Link></Button>
      <p className="text-sm text-muted-foreground">Order not found.</p>
    </div>
  );

  const { order, items } = data;
  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm"><Link to="/account/orders"><ChevronLeft className="h-4 w-4 mr-1" />Back to orders</Link></Button>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold font-mono">#{order.id.slice(0, 8)}</h1>
          <p className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString()}</p>
        </div>
        <Badge variant={order.status === "paid" ? "default" : "secondary"}>{order.status}</Badge>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {items.map((it: any) => (
              <li key={it.id} className="p-4 flex items-center gap-4">
                {it.cover_snapshot && <img src={it.cover_snapshot} alt="" className="w-12 h-16 object-cover rounded" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{it.title_snapshot}</p>
                </div>
                <span className="text-sm">{(it.unit_price / 100).toFixed(2)} {it.currency.toUpperCase()}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-lg font-semibold">{(order.amount_total / 100).toFixed(2)} {order.currency.toUpperCase()}</span>
        </CardContent>
      </Card>
    </div>
  );
}
