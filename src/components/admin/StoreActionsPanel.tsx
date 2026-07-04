// Store actions panel — plugged into the existing Ebook detail page (EbookReview).
// Every button targets exactly one concern: thumbnail, listing copy, price,
// PDF re-render, final QC, publish/unpublish. Never lowers QC gates.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, ImageIcon, Sparkles, DollarSign, FileText, ShieldCheck, Rocket, EyeOff, Flag, XCircle } from "lucide-react";

type Props = {
  ebookId: string;
  pdfUrl?: string | null;
  coverUrl?: string | null;
  thumbnailUrl?: string | null;
  price?: number | null;
  finalQualityScore?: number | null;
  listingStatus?: string | null;
  hasCopy?: boolean;
  hasPriceOverride?: boolean;
  onChanged?: () => void;
};

export function StoreActionsPanel(p: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const canPublish = !!(p.pdfUrl && (p.coverUrl || p.thumbnailUrl) && p.price && (p.finalQualityScore ?? 0) >= 80 && p.hasCopy);
  const publishBlockers: string[] = [];
  if (!p.pdfUrl) publishBlockers.push("PDF missing");
  if (!p.coverUrl && !p.thumbnailUrl) publishBlockers.push("Thumbnail missing");
  if (!p.price) publishBlockers.push("Price missing");
  if ((p.finalQualityScore ?? 0) < 80) publishBlockers.push(`QC ${p.finalQualityScore ?? 0} < 80`);
  if (!p.hasCopy) publishBlockers.push("Listing copy missing");

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try { await fn(); toast.success("Done"); p.onChanged?.(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  const invoke = (fn: string, body: unknown = {}) =>
    supabase.functions.invoke(fn, { body: { ebook_id: p.ebookId, ...(body as object) } })
      .then((r) => { if (r.error) throw r.error; return r.data; });

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Store actions</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Btn label="Regenerate thumbnail" icon={<ImageIcon className="size-4" />} k="thumb" busy={busy}
             onClick={() => run("thumb", async () => { await invoke("generate-cover", { mode: "thumbnail", force: true }); })} />
        <Btn label="Regenerate listing copy" icon={<Sparkles className="size-4" />} k="copy" busy={busy}
             onClick={() => run("copy", async () => { await invoke("generate-selling-copy"); })} />
        <Btn label="Recalculate price" icon={<DollarSign className="size-4" />} k="price" busy={busy}
             onClick={() => run("price", async () => {
               if (p.hasPriceOverride && !confirm("Admin price override is active. Overwrite with recalculated price?")) return;
               await invoke("compute-pricing");
             })} />
        <Btn label="Re-render PDF" icon={<FileText className="size-4" />} k="pdf" busy={busy}
             onClick={() => run("pdf", async () => { await invoke("render-pdf", { preserve: true }); })} />
        <Btn label="Run final QC" icon={<ShieldCheck className="size-4" />} k="qc" busy={busy}
             onClick={() => run("qc", async () => { await invoke("final-manuscript-qc"); })} />
        <Btn label="Mark needs review" icon={<Flag className="size-4" />} k="needs" busy={busy} variant="outline"
             onClick={() => run("needs", async () => {
               const { error } = await supabase.from("ebooks").update({ autopilot_state: "needs_review" as any }).eq("id", p.ebookId);
               if (error) throw error;
             })} />
        <div className="md:col-span-2 border-t pt-2 mt-1">
          {publishBlockers.length > 0 && (
            <div className="text-xs text-orange-700 mb-2">Blockers: {publishBlockers.join(" · ")}</div>
          )}
          <div className="flex gap-2">
            {p.listingStatus === "listed"
              ? <Button variant="outline" className="flex-1" disabled={busy === "unpub"}
                        onClick={() => run("unpub", async () => {
                          const { error } = await supabase.from("ebooks").update({ listing_status: "draft" as any, listed_at: null as any }).eq("id", p.ebookId);
                          if (error) throw error;
                        })}>
                  {busy === "unpub" ? <Loader2 className="size-4 animate-spin" /> : <EyeOff className="size-4" />} Unpublish from Store
                </Button>
              : <Button className="flex-1" disabled={!canPublish || busy === "pub"}
                        onClick={() => run("pub", async () => { await invoke("auto-list-ebook"); })}>
                  {busy === "pub" ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />} Publish to Store
                </Button>}
            <Button variant="outline" disabled={busy === "reject"}
                    onClick={() => run("reject", async () => {
                      if (!confirm("Reject this ebook?")) throw new Error("cancelled");
                      const { error } = await supabase.from("ebooks").update({ autopilot_state: "rejected" as any, listing_status: "draft" as any }).eq("id", p.ebookId);
                      if (error) throw error;
                    })}>
              <XCircle className="size-4" /> Reject
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Btn({ label, icon, k, busy, onClick, variant }: { label: string; icon: React.ReactNode; k: string; busy: string | null; onClick: () => void; variant?: "outline" }) {
  return (
    <Button variant={variant ?? "outline"} onClick={onClick} disabled={busy === k} className="justify-start">
      {busy === k ? <Loader2 className="size-4 animate-spin" /> : icon} {label}
    </Button>
  );
}
