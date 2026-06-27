import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";

type Ebook = { id: string; title: string; status: string; word_count: number; price: number; updated_at: string };

const lanes: { key: string; label: string }[] = [
  { key: "outline", label: "Outline" },
  { key: "writing", label: "Writing" },
  { key: "ready_for_qc", label: "Ready QC" },
  { key: "qc_failed", label: "QC failed" },
  { key: "approved", label: "Approved" },
  { key: "uploaded", label: "Uploaded" },
  { key: "published", label: "Published" },
  { key: "failed", label: "Failed" },
];

const statusMatchesLane = (status: string, lane: string) => {
  if (lane === "writing") return status === "writing" || status.startsWith("writing:") || status === "marketing";
  return status === lane;
};

export default function Pipeline() {
  const [items, setItems] = useState<Ebook[]>([]);

  useEffect(() => {
    supabase.from("ebooks").select("id,title,status,word_count,price,updated_at").order("updated_at", { ascending: false }).limit(200)
      .then(({ data }) => setItems((data ?? []) as Ebook[]));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono uppercase tracking-widest text-xs">[ Pipeline ]</p>
        <h1 className="font-display text-4xl uppercase">Ebook pipeline</h1>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        {lanes.map((l) => {
          const rows = items.filter((i) => statusMatchesLane(i.status, l.key));
          return (
            <div key={l.key} className="border-2 border-foreground bg-card min-h-[200px]">
              <div className="p-2 border-b-2 border-foreground bg-highlight">
                <p className="font-mono text-xs uppercase">{l.label}</p>
                <p className="text-xs text-muted-foreground">{rows.length}</p>
              </div>
              <div className="p-2 space-y-2">
                {rows.map((r) => (
                  <Link to={`/admin/ebook/${r.id}`} key={r.id}>
                    <Card className="border-2 border-foreground/30 hover:border-foreground transition-colors">
                      <CardContent className="p-3 space-y-1">
                        <p className="text-sm font-medium line-clamp-2">{r.title}</p>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{r.word_count} w</span>
                          <Badge variant="outline">${r.price}</Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
