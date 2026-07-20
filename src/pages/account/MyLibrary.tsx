import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAccountAuth } from "@/hooks/useAccountAuth";
import { toast } from "sonner";
import { Download, LayoutGrid, List, Loader2 } from "lucide-react";

type Grant = {
  id: string;
  kind: "adult" | "kids";
  title: string;
  cover: string | null;
  purchased_at: string;
  expires_at: string;
  downloads_left: number;
};

export default function MyLibrary() {
  const { user } = useAccountAuth();
  const [q, setQ] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    enabled: !!user,
    queryKey: ["acct-library", user?.id],
    queryFn: async (): Promise<Grant[]> => {
      const [{ data: adult }, { data: kids }] = await Promise.all([
        supabase.from("download_grants")
          .select("id, created_at, expires_at, download_count, max_downloads, ebooks(title, cover_url)")
          .or(`buyer_user_id.eq.${user!.id},buyer_email.eq.${user!.email}`)
          .order("created_at", { ascending: false }),
        supabase.from("kids_download_grants")
          .select("id, created_at, expires_at, download_count, max_downloads, ebooks_kids(title, cover_url)")
          .eq("email", user!.email!)
          .order("created_at", { ascending: false }),
      ]);
      const rows: Grant[] = [];
      for (const g of (adult ?? []) as any[]) {
        rows.push({
          id: g.id, kind: "adult",
          title: g.ebooks?.title ?? "Untitled",
          cover: g.ebooks?.cover_url ?? null,
          purchased_at: g.created_at,
          expires_at: g.expires_at,
          downloads_left: Math.max(0, (g.max_downloads ?? 0) - (g.download_count ?? 0)),
        });
      }
      for (const g of (kids ?? []) as any[]) {
        rows.push({
          id: g.id, kind: "kids",
          title: g.ebooks_kids?.title ?? "Untitled",
          cover: g.ebooks_kids?.cover_url ?? null,
          purchased_at: g.created_at,
          expires_at: g.expires_at,
          downloads_left: Math.max(0, (g.max_downloads ?? 0) - (g.download_count ?? 0)),
        });
      }
      return rows;
    },
  });

  const filtered = useMemo(
    () => (data ?? []).filter((r) => r.title.toLowerCase().includes(q.toLowerCase())),
    [data, q]
  );

  const download = async (g: Grant) => {
    setDownloading(g.id);
    try {
      const { data, error } = await supabase.functions.invoke("account-signed-download", {
        body: { grant_id: g.id, kind: g.kind === "kids" ? "kids" : "adult" },
      });
      if (error) throw error;
      if ((data as any)?.url) window.location.href = (data as any).url;
      else throw new Error((data as any)?.error ?? "Download failed");
    } catch (e: any) {
      toast.error(e.message ?? "Download failed");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Library</h1>
          <p className="text-sm text-muted-foreground">Re-download any book you own.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input placeholder="Search titles…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-64" />
          <Button variant={view === "grid" ? "default" : "outline"} size="icon" onClick={() => setView("grid")}><LayoutGrid className="h-4 w-4" /></Button>
          <Button variant={view === "list" ? "default" : "outline"} size="icon" onClick={() => setView("list")}><List className="h-4 w-4" /></Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">
          {q ? "No matches." : "Your library is empty. Purchases will appear here."}
        </CardContent></Card>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((g) => (
            <Card key={g.id} className="overflow-hidden">
              <div className="aspect-[3/4] bg-muted overflow-hidden">
                {g.cover ? <img src={g.cover} alt={g.title} loading="lazy" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No cover</div>}
              </div>
              <CardContent className="p-3 space-y-2">
                <p className="text-sm font-medium line-clamp-2">{g.title}</p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">{g.kind === "kids" ? "Kids" : "Ebook"}</Badge>
                  <span>{g.downloads_left} left</span>
                </div>
                <Button className="w-full" size="sm" disabled={g.downloads_left <= 0 || downloading === g.id} onClick={() => download(g)}>
                  {downloading === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Download className="h-4 w-4 mr-2" />Download</>}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card><CardContent className="p-0">
          <ul className="divide-y">
            {filtered.map((g) => (
              <li key={g.id} className="flex items-center gap-4 p-3">
                <div className="w-12 h-16 bg-muted overflow-hidden rounded flex-shrink-0">
                  {g.cover && <img src={g.cover} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{g.title}</p>
                  <p className="text-xs text-muted-foreground">Purchased {new Date(g.purchased_at).toLocaleDateString()} · {g.downloads_left} downloads left</p>
                </div>
                <Button size="sm" variant="outline" disabled={g.downloads_left <= 0 || downloading === g.id} onClick={() => download(g)}>
                  {downloading === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Download"}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent></Card>
      )}
    </div>
  );
}
