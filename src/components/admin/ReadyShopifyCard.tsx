import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Rocket, Loader2, Download, ExternalLink, Sparkles, Wand2, ChevronDown, ChevronUp,
  CheckCircle2, AlertTriangle, ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { downloadAdminPdf } from "@/lib/pdf";
import { QcGateCard, type QcGateReport, type ReRenderInfo } from "./QcGateCard";

export interface ReadyEbook {
  id: string;
  title: string | null;
  subtitle?: string | null;
  cover_url: string | null;
  thumbnail_url: string | null;
  pdf_url: string | null;
  final_quality_score: number | null;
  word_count: number | null;
  qc?: QcGateReport | null;
  re_render?: ReRenderInfo | null;

  shopify_title: string | null;
  shopify_subtitle: string | null;
  short_hook: string | null;
  body_html: string | null;
  benefit_bullets: string[] | null;
  whats_inside: string[] | null;
  who_its_for: string[] | null;
  who_its_not_for: string[] | null;

  price: number | null;
  compare_at_price: number | null;
  launch_price: number | null;
  price_tier: string | null;

  seo_title: string | null;
  meta_description: string | null;
  url_slug: string | null;
  tags: string[] | null;

  pricing_confidence_score: number | null;
  product_page_qc_score: number | null;
  thumbnail_qc_score: number | null;

  shopify_status: string | null;
  shopify_product_id: string | null;
  shopify_draft_url: string | null;
}

interface Props {
  ebook: ReadyEbook;
  onChanged: () => void;
}

export function ReadyShopifyCard({ ebook, onChanged }: Props) {
  const [busy, setBusy] = useState<null | "upload" | "package" | "thumb" | "download">(null);
  const [expanded, setExpanded] = useState(false);

  const hasPackage = !!(ebook.shopify_title && ebook.body_html && ebook.price);
  const uploaded = !!ebook.shopify_product_id;
  const price = ebook.price != null ? Number(ebook.price) : null;
  const compare = ebook.compare_at_price != null ? Number(ebook.compare_at_price) : null;

  const gates = ebook.qc;
  const gatesReady = gates?.ready_for_shopify === true;
  const thumbOk = (ebook.thumbnail_qc_score ?? 0) >= 90 || gates?.cover_thumb?.pass === true;
  const priceOk = (ebook.pricing_confidence_score ?? 0) >= 85;
  const copyOk = (ebook.product_page_qc_score ?? 0) >= 90;

  const canUpload = !!ebook.pdf_url && hasPackage && gatesReady && thumbOk && !uploaded;

  const blockers: string[] = [];
  if (!ebook.pdf_url) blockers.push("PDF missing");
  if (!hasPackage) blockers.push("Product copy not generated");
  if (!thumbOk) blockers.push("Thumbnail QC < 90");
  if (!priceOk && hasPackage) blockers.push("Pricing confidence < 85");
  if (!copyOk && hasPackage) blockers.push("Product page QC < 90");
  if (gates && !gatesReady) {
    for (const g of gates.blocking_gates ?? []) blockers.push(`Gate: ${g}`);
  }

  const runPackage = async () => {
    setBusy("package");
    try {
      const { data, error } = await supabase.functions.invoke("generate-shopify-package", {
        body: { ebook_id: ebook.id },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success("Product copy + pricing generated");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(null);
    }
  };

  const runThumbnail = async () => {
    setBusy("thumb");
    try {
      const { data, error } = await supabase.functions.invoke("generate-cover", {
        body: { ebook_id: ebook.id, mode: "overlay" },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success("Premium thumbnail regenerating");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Thumbnail regeneration failed");
    } finally {
      setBusy(null);
    }
  };

  const runUpload = async () => {
    setBusy("upload");
    try {
      const { data, error } = await supabase.functions.invoke("shopify-draft-upload", {
        body: { ebook_id: ebook.id },
      });
      if (error) throw error;
      const payload = data as { error?: string; shopify_draft_url?: string };
      if (payload?.error) throw new Error(payload.error);
      toast.success("Shopify draft created");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Shopify upload failed");
    } finally {
      setBusy(null);
    }
  };

  const runDownload = async () => {
    setBusy("download");
    try {
      await downloadAdminPdf(ebook.id, ebook.title ?? undefined);
      toast.success("PDF downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(null);
    }
  };

  const thumbSrc = ebook.thumbnail_url ?? ebook.cover_url ?? null;

  return (
    <Card className="border-2 border-foreground overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col lg:flex-row">
          <div className="lg:w-56 bg-muted flex items-center justify-center p-4 shrink-0">
            {thumbSrc ? (
              <img
                src={thumbSrc}
                alt={ebook.title ?? "thumbnail"}
                className="w-full max-w-[200px] aspect-[3/4] object-cover rounded shadow-lg"
              />
            ) : (
              <div className="w-full max-w-[200px] aspect-[3/4] rounded border-2 border-dashed border-muted-foreground/40 flex flex-col items-center justify-center text-muted-foreground text-xs gap-1">
                <ImageIcon className="h-6 w-6" />
                No thumbnail
              </div>
            )}
          </div>

          <div className="flex-1 p-5 space-y-4 min-w-0">
            <div className="flex flex-wrap items-start gap-2 justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  {uploaded ? (
                    <Badge className="bg-blue-600 text-white gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Draft on Shopify
                    </Badge>
                  ) : gatesReady && hasPackage ? (
                    <Badge className="bg-emerald-600 text-white gap-1">
                      <Rocket className="h-3 w-3" /> Ready to upload
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 border-amber-500 text-amber-700">
                      <AlertTriangle className="h-3 w-3" /> Needs packaging
                    </Badge>
                  )}
                  {ebook.price_tier && (
                    <Badge variant="secondary" className="uppercase text-[10px]">{ebook.price_tier}</Badge>
                  )}
                </div>
                <h3 className="font-display text-lg leading-tight truncate">
                  {ebook.shopify_title || ebook.title || "Untitled"}
                </h3>
                {(ebook.shopify_subtitle || ebook.subtitle) && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {ebook.shopify_subtitle || ebook.subtitle}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                {price != null ? (
                  <div className="flex items-baseline gap-2 justify-end">
                    {compare && compare > price && (
                      <span className="text-sm text-muted-foreground line-through">${compare.toFixed(2)}</span>
                    )}
                    <span className="text-2xl font-bold">${price.toFixed(2)}</span>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">no price yet</span>
                )}
                <div className="text-[11px] text-muted-foreground mt-1 space-x-2">
                  {ebook.pricing_confidence_score != null && <span>Price {ebook.pricing_confidence_score}%</span>}
                  {ebook.product_page_qc_score != null && <span>Page QC {ebook.product_page_qc_score}</span>}
                  {ebook.thumbnail_qc_score != null && <span>Thumb {ebook.thumbnail_qc_score}</span>}
                </div>
              </div>
            </div>

            {ebook.short_hook && (
              <p className="text-sm leading-relaxed text-foreground/90 border-l-2 border-foreground/30 pl-3">
                {ebook.short_hook}
              </p>
            )}

            {ebook.qc && (
              <QcGateCard qc={ebook.qc} reRender={ebook.re_render ?? null} ebookId={ebook.id} />
            )}

            {blockers.length > 0 && !uploaded && (
              <div className="rounded border border-amber-500/60 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-800 dark:text-amber-200">
                <div className="font-semibold mb-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Blocking:
                </div>
                <ul className="list-disc list-inside space-y-0.5">
                  {blockers.map((b) => <li key={b}>{b}</li>)}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {!hasPackage ? (
                <Button size="sm" onClick={runPackage} disabled={busy !== null}>
                  {busy === "package" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Generate Shopify Package
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    onClick={runUpload}
                    disabled={!canUpload || busy !== null}
                    title={canUpload ? "Create Shopify draft" : blockers.join(" · ")}
                  >
                    {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                    {uploaded ? "Re-upload" : "Add to Shopify"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={runPackage} disabled={busy !== null}>
                    {busy === "package" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                    Regenerate Copy
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" onClick={runThumbnail} disabled={busy !== null}>
                {busy === "thumb" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                Regenerate Thumbnail
              </Button>
              <Button size="sm" variant="ghost" onClick={runDownload} disabled={busy !== null || !ebook.pdf_url}>
                {busy === "download" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                PDF
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link to={`/admin/ebook/${ebook.id}/shopify`}>
                  <ExternalLink className="h-4 w-4" /> Detail
                </Link>
              </Button>
              {ebook.shopify_draft_url && (
                <Button size="sm" variant="ghost" asChild>
                  <a href={ebook.shopify_draft_url} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" /> Open in Shopify
                  </a>
                </Button>
              )}
              {hasPackage && (
                <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  Product copy
                </Button>
              )}
            </div>

            {expanded && hasPackage && (
              <div className="grid md:grid-cols-2 gap-4 text-sm border-t pt-4">
                <Section title="Benefits" items={ebook.benefit_bullets} />
                <Section title="What's Inside" items={ebook.whats_inside} />
                <Section title="Who it's for" items={ebook.who_its_for} />
                <Section title="Not for" items={ebook.who_its_not_for} />
                <div className="md:col-span-2 space-y-1">
                  <div className="text-xs uppercase font-mono text-muted-foreground">SEO</div>
                  <div><span className="text-muted-foreground text-xs">Title:</span> {ebook.seo_title ?? "—"}</div>
                  <div><span className="text-muted-foreground text-xs">Meta:</span> {ebook.meta_description ?? "—"}</div>
                  <div><span className="text-muted-foreground text-xs">Slug:</span> <code className="text-xs">{ebook.url_slug ?? "—"}</code></div>
                  {ebook.tags && ebook.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {ebook.tags.map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
                    </div>
                  )}
                </div>
                {ebook.body_html && (
                  <div className="md:col-span-2 space-y-1">
                    <div className="text-xs uppercase font-mono text-muted-foreground">Description</div>
                    <div
                      className="prose prose-sm max-w-none dark:prose-invert"
                      dangerouslySetInnerHTML={{ __html: ebook.body_html }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Section({ title, items }: { title: string; items: string[] | null }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="text-xs uppercase font-mono text-muted-foreground mb-1">{title}</div>
      <ul className="list-disc list-inside space-y-0.5">
        {items.map((v, i) => <li key={i}>{v}</li>)}
      </ul>
    </div>
  );
}
