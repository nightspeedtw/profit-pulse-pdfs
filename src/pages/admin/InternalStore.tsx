// Internal Store — Track 6 admin list.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Rocket, EyeOff, ExternalLink, ImageIcon, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { findProfile } from "@/lib/styleProfiles";

type Row = {
  id: string;
  title: string;
  short_hook: string | null;
  selling_hook: string | null;
  product_description: string | null;
  price: number | null;
  cover_url: string | null;
  thumbnail_url: string | null;
  store_thumbnail_url: string | null;
  store_thumbnail_qc: any;
  thumbnail_needs_review: boolean | null;
  category_slug: string | null;
  listing_status: string | null;
  autopilot_state: string | null;
  final_quality_score: number | null;
  cover_score: number | null;
  pdf_url: string | null;
  created_at: string;
  updated_at: string;
};

type Filter = "all" | "store_ready" | "published" | "needs_qc" | "draft" | "paused" | "rejected";

const mapStatus = (r: Row): { key: Filter; label: string; tone: string } => {
  if (r.listing_status === "listed") return { key: "published", label: "Published", tone: "bg-green-100 text-green-800" };
  if (r.autopilot_state === "rejected") return { key: "rejected", label: "Rejected", tone: "bg-red-100 text-red-800" };
  if (r.autopilot_state === "paused") return { key: "paused", label: "Paused", tone: "bg-gray-200 text-gray-700" };
  if ((r.final_quality_score ?? 0) >= 80 && r.pdf_url && (r.thumbnail_url || r.cover_url) && r.price) {
    return { key: "store_ready", label: "Store Ready", tone: "bg-blue-100 text-blue-800" };
  }
  if (r.autopilot_state === "needs_review" || r.autopilot_state === "awaiting_cover_approval" || r.autopilot_state === "awaiting_pdf_approval") {
    return { key: "needs_qc", label: "Needs QC", tone: "bg-orange-100 text-orange-800" };
  }
  return { key: "draft", label: "Draft", tone: "bg-gray-100 text-gray-700" };
};

export default function InternalStore() {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.from("ebooks")
      .select("id,title,short_hook,selling_hook,product_description,price,cover_url,thumbnail_url,store_thumbnail_url,store_thumbnail_qc,thumbnail_needs_review,category_slug,listing_status,autopilot_state,final_quality_score,cover_score,pdf_url,created_at,updated_at")
      .order("updated_at", { ascending: false }).limit(200);
    if (error) { toast.error(error.message); return; }
    setRows((data ?? []) as Row[]);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (term && !(r.title ?? "").toLowerCase().includes(term)) return false;
      if (filter !== "all" && mapStatus(r).key !== filter) return false;
      return true;
    });
  }, [rows, search, filter]);

  async function publish(r: Row) {
    setBusy(r.id);
    try {
      const canPublish = r.pdf_url && (r.cover_url || r.thumbnail_url) && r.price && (r.final_quality_score ?? 0) >= 80;
      if (!canPublish) throw new Error("Missing PDF, thumbnail, price, or QC score below 80.");
      const { error } = await supabase.functions.invoke("auto-list-ebook", { body: { ebook_id: r.id } });
      if (error) throw error;
      toast.success("Published to Store");
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }
  async function unpublish(r: Row) {
    setBusy(r.id);
    try {
      const { error } = await supabase.from("ebooks").update({ listing_status: "draft" as any, listed_at: null as any }).eq("id", r.id);
      if (error) throw error;
      toast.success("Unpublished");
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function regenThumbnail(r: Row) {
    setBusy(r.id);
    try {
      const { data, error } = await supabase.functions.invoke("generate-store-thumbnail", { body: { ebook_id: r.id, force: true } });
      if (error) throw error;
      const qc = (data as any)?.qc;
      toast.success(`Thumbnail regenerated (QC ${qc?.score ?? "—"})`);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl uppercase">Internal Store</h1>
          <p className="text-sm text-muted-foreground mt-1">Our own catalog.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-4" /> Refresh</Button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Search title…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="needs_qc">Needs QC</SelectItem>
            <SelectItem value="store_ready">Store Ready</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-sm text-muted-foreground">{filtered.length} products</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((r) => {
          const st = mapStatus(r);
          const profile = findProfile(r.category_slug);
          const img = r.store_thumbnail_url || r.thumbnail_url || r.cover_url;
          const canPublish = !!(r.pdf_url && (r.cover_url || r.thumbnail_url) && r.price && (r.final_quality_score ?? 0) >= 80);
          const thumbQc = r.store_thumbnail_qc?.score;
          return (
            <Card key={r.id} className="overflow-hidden">
              <div className="aspect-[3/4] bg-muted flex items-center justify-center overflow-hidden border-b">
                {img ? <img src={img} alt={r.title} className="w-full h-full object-cover" loading="lazy" />
                     : <ImageIcon className="size-8 text-muted-foreground" />}
              </div>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  {profile && <Badge variant="outline" className="text-[10px]">{profile.display_name}</Badge>}
                  <Badge className={st.tone}>{st.label}</Badge>
                </div>
                <div className="font-medium text-sm line-clamp-2 min-h-[2.5rem]">{r.title}</div>
                {r.short_hook && <div className="text-xs text-muted-foreground line-clamp-2">{r.short_hook}</div>}
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold">{r.price != null ? `$${Number(r.price).toFixed(2)}` : "—"}</span>
                  <span className="text-muted-foreground">
                    QC {r.final_quality_score ?? "—"} · Thumb {thumbQc ?? "—"}
                    {r.thumbnail_needs_review ? " ⚠" : ""}
                  </span>
                </div>
                <div className="flex gap-1 pt-2">
                  <Button asChild size="sm" variant="outline" className="flex-1">
                    <Link to={`/admin/ebook/${r.id}`}><ExternalLink className="size-3" /> Detail</Link>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => regenThumbnail(r)} disabled={busy === r.id} title="Regenerate store thumbnail">
                    {busy === r.id ? <Loader2 className="size-3 animate-spin" /> : <ImagePlus className="size-3" />}
                  </Button>
                  {r.listing_status === "listed"
                    ? <Button size="sm" variant="outline" onClick={() => unpublish(r)} disabled={busy === r.id}>
                        {busy === r.id ? <Loader2 className="size-3 animate-spin" /> : <EyeOff className="size-3" />} Unpublish
                      </Button>
                    : <Button size="sm" onClick={() => publish(r)} disabled={!canPublish || busy === r.id} title={!canPublish ? "Missing PDF / thumbnail / price / QC" : ""}>
                        {busy === r.id ? <Loader2 className="size-3 animate-spin" /> : <Rocket className="size-3" />} Publish
                      </Button>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
