import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAccountAuth } from "@/hooks/useAccountAuth";

export default function AccountOverview() {
  const { user } = useAccountAuth();
  const verified = !!user?.email_confirmed_at;

  const { data: recentOrders } = useQuery({
    enabled: !!user,
    queryKey: ["acct-overview-orders", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, created_at, amount_total, currency, status")
        .or(`buyer_user_id.eq.${user!.id},buyer_email.eq.${user!.email}`)
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const { data: libraryCount } = useQuery({
    enabled: !!user,
    queryKey: ["acct-overview-lib-count", user?.id],
    queryFn: async () => {
      const { count } = await supabase
        .from("download_grants")
        .select("id", { count: "exact", head: true })
        .or(`buyer_user_id.eq.${user!.id},buyer_email.eq.${user!.email}`);
      return count ?? 0;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
          Welcome back{user?.user_metadata?.full_name ? `, ${user.user_metadata.full_name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Your library, orders, and downloads in one place.</p>
      </div>

      {!verified && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Verify your email</AlertTitle>
          <AlertDescription>
            Some actions like invoices, wallet changes, and payouts require a verified email.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Library items" value={libraryCount ?? 0} to="/account/library" />
        <Stat label="Recent orders" value={recentOrders?.length ?? 0} to="/account/orders" />
        <Stat label="Notifications" value="—" to="/account/notifications" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent orders</CardTitle>
          <Button asChild variant="ghost" size="sm"><Link to="/account/orders">View all</Link></Button>
        </CardHeader>
        <CardContent>
          {!recentOrders?.length ? (
            <p className="text-sm text-muted-foreground">You have no orders yet.</p>
          ) : (
            <ul className="divide-y">
              {recentOrders.map((o) => (
                <li key={o.id} className="py-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-mono truncate">{o.id.slice(0, 8)}</p>
                    <p className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm">{(o.amount_total / 100).toFixed(2)} {o.currency.toUpperCase()}</span>
                    <Badge variant={o.status === "paid" ? "default" : "secondary"}>{o.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, to }: { label: string; value: React.ReactNode; to: string }) {
  return (
    <Link to={to}>
      <Card className="hover:border-primary/50 transition-colors">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-semibold mt-1">{value}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
