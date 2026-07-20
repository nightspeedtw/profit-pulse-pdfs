// coloring-v2-publish — copies final PDF + cover into the storefront buckets,
// signs long-lived URLs, inserts a live sellable row into ebooks_kids.
// @ts-nocheck
import { advance, corsHeaders, db, fetchBook, json, recordError } from "../_shared/coloring-v2/state.ts";
import { getAgeProfile } from "../_shared/coloring-v2/age-matrix.ts";

declare const Deno: any;

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const { book_id } = await req.json().catch(() => ({}));
  if (!book_id) return json({ error: "book_id required" }, 400);
  try {
    const book = await fetchBook(book_id);
    if (book.stage !== "publish") return json({ ok: true, skipped: true, stage: book.stage });

    const c = db();
    // Load cover + pdf source paths from V2 bucket
    const { data: coverAsset } = await c.from("coloring_v2_assets")
      .select("storage_path, mime").eq("id", book.approved_cover_asset_id).single();
    const { data: pdfAsset } = await c.from("coloring_v2_assets")
      .select("storage_path, mime").eq("id", book.final_pdf_asset_id).single();
    if (!coverAsset || !pdfAsset) throw new Error("missing_cover_or_pdf_asset");

    // Copy into storefront buckets
    const coverSrc = await c.storage.from("coloring-v2").download(coverAsset.storage_path);
    if (coverSrc.error) throw coverSrc.error;
    const pdfSrc = await c.storage.from("coloring-v2").download(pdfAsset.storage_path);
    if (pdfSrc.error) throw pdfSrc.error;

    const slug = (book.title ?? "coloring-book").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const coverPath = `v2/${slug}-${book_id.slice(0, 8)}.jpg`;
    const pdfPath = `v2/${slug}-${book_id.slice(0, 8)}.pdf`;

    const upCover = await c.storage.from("ebook-covers").upload(coverPath,
      new Uint8Array(await coverSrc.data.arrayBuffer()),
      { contentType: "image/jpeg", upsert: true });
    if (upCover.error) throw upCover.error;
    const upPdf = await c.storage.from("ebook-pdfs").upload(pdfPath,
      new Uint8Array(await pdfSrc.data.arrayBuffer()),
      { contentType: "application/pdf", upsert: true });
    if (upPdf.error) throw upPdf.error;

    const { data: coverUrl } = await c.storage.from("ebook-covers").createSignedUrl(coverPath, TEN_YEARS);
    const { data: pdfUrl } = await c.storage.from("ebook-pdfs").createSignedUrl(pdfPath, TEN_YEARS);
    if (!coverUrl?.signedUrl || !pdfUrl?.signedUrl) throw new Error("sign_failed");

    const prof = getAgeProfile(book.age_band);
    const { data: conceptAsset } = await c.from("coloring_v2_assets")
      .select("meta").eq("book_id", book_id).eq("kind", "concept").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const concept = conceptAsset?.meta ?? {};

    // Price ladder: 32-page premium coloring at $14.99, 16-page at $9.99
    const priceCents = book.page_count >= 32 ? 1499 : 999;

    // Description
    const descHtml = `<h2>${escapeHtml(book.title ?? "Coloring Book")}</h2>
<p>${escapeHtml(concept.parent_hook ?? `A premium coloring book for ${prof.label}.`)}</p>
<ul>
  <li>${book.page_count} intricate coloring pages</li>
  <li>Age band: ${prof.label}</li>
  <li>Trim size: 8.5" × 8.5" square</li>
  <li>Instant digital download (PDF)</li>
</ul>`;

    // Age id/theme slug — best-effort lookups (skip if not found)
    const { data: ageRow } = await c.from("kids_age_groups").select("id").ilike("label", `%${prof.label}%`).maybeSingle();

    // Bridge invariant (2026-07-20 "coloring_v2_storefront_bridge_idempotent"):
    // exactly ONE ebooks_kids row per coloring_v2_books.id. Keyed on the
    // dedicated `coloring_v2_book_id` column (partial UNIQUE index enforces
    // it). Republishes (cover regen, matter refresh) atomic-swap the SAME
    // row — never a sibling insert.
    const bridge = {
      coloring_v2_book_id: book_id,
      title: book.title ?? "Coloring Book",
      subtitle: book.subtitle ?? null,
      description: concept.parent_hook ?? null,
      status: "live",
      listing_status: "live",
      pipeline_status: "completed",
      sellable: true,
      book_type: "coloring_book",
      age_band: book.age_band,
      age_group_id: ageRow?.id ?? null,
      cover_url: coverUrl.signedUrl,
      pdf_url: pdfUrl.signedUrl,
      thumbnail_url: coverUrl.signedUrl,
      page_count: book.page_count + 1,
      price_cents: priceCents,
      customer_product_description_html: descHtml,
      sales_copy_sanitized_at: new Date().toISOString(),
      overall_qc_score: book.overall_qc_score ?? 92,
      qc_scores: { overall: book.overall_qc_score ?? 92, coloring_v2_book_id: book_id },
      metadata: { coloring_v2_book_id: book_id, source: "coloring_v2" },
    } as any;

    const { data: created, error } = await c
      .from("ebooks_kids")
      .upsert(bridge, { onConflict: "coloring_v2_book_id" })
      .select("id")
      .single();
    if (error) throw error;

    await advance(book_id, "publish", "publish", {
      publish_status: "live", sellability_status: "sellable",
    });
    await c.from("coloring_v2_books").update({
      publish_status: "live", sellability_status: "sellable",
      time_completed_at: new Date().toISOString(),
    }).eq("id", book_id);

    return json({ ok: true, ebooks_kids_id: created.id, cover_url: coverUrl.signedUrl, pdf_url: pdfUrl.signedUrl });
  } catch (e: any) {
    await recordError(book_id, "publish", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
