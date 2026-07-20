import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAccountAuth } from "@/hooks/useAccountAuth";

export default function Downloads() {
  const { user } = useAccountAuth();
  const { data, isLoading } = useQuery({
    enabled: !!user,
    queryKey: ["acct-downloads", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("acct_download_events")
        .select("id, created_at, product_kind, outcome, storage_path")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Download history</h1>
        <p className="text-sm text-muted-foreground">Every signed download issued to your account.</p>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : !data?.length ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No downloads yet.</CardContent></Card>
        ) : (
          <Card><CardContent className="p-0">
            <ul className="divide-y text-sm">
              {data.map((e) => (
                <li key={e.id} className="p-3 flex items-center justify-between">
                  <div>
                    <p>{e.product_kind ?? "asset"}</p>
                    <p className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{e.outcome}</span>
                </li>
              ))}
            </ul>
          </CardContent></Card>
        )}
    </div>
  );
}
