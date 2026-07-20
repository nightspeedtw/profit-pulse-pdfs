import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAccountAuth } from "@/hooks/useAccountAuth";

export default function Notifications() {
  const { user } = useAccountAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    enabled: !!user,
    queryKey: ["acct-notifs", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("acct_notifications")
        .select("*").eq("user_id", user!.id)
        .order("created_at", { ascending: false }).limit(100);
      return data ?? [];
    },
  });

  const markAllRead = async () => {
    await supabase.from("acct_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user!.id).is("read_at", null);
    qc.invalidateQueries({ queryKey: ["acct-notifs", user?.id] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">Purchases, downloads, and account events.</p>
        </div>
        {data?.some((n) => !n.read_at) && (
          <Button variant="outline" size="sm" onClick={markAllRead}>Mark all read</Button>
        )}
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : !data?.length ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No notifications.</CardContent></Card>
        ) : (
          <Card><CardContent className="p-0">
            <ul className="divide-y">
              {data.map((n) => (
                <li key={n.id} className={`p-4 ${!n.read_at ? "bg-primary/5" : ""}`}>
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body && <p className="text-sm text-muted-foreground mt-1">{n.body}</p>}
                  <p className="text-xs text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          </CardContent></Card>
        )}
    </div>
  );
}
