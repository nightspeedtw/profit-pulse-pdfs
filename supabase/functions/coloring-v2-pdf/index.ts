// coloring-v2-pdf — assembles 8.5x8.5in square PDF: cover + interiors.
// @ts-nocheck
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { advance, corsHeaders, db, fetchBook, fireStage, json, recordError, uploadAsset } from "../_shared/coloring-v2/state.ts";

declare const Deno: any;

const PT_PER_IN = 72;
const TRIM_PT = 8.5 * PT_PER_IN; // 612

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const { book_id } = await req.json().catch(() => ({}));
  if (!book_id) return json({ error: "book_id required" }, 400);
  try {
    const book = await fetchBook(book_id);
    if (book.stage !== "pdf") return json({ ok: true, skipped: true, stage: book.stage });

    // Cover asset
    const { data: coverAsset, error: coverErr } = await db().from("coloring_v2_assets")
      .select("storage_path").eq("id", book.approved_cover_asset_id).single();
    if (coverErr) throw coverErr;

    // Interior assets — pick latest per page_number, cap to page_count
    const { data: allInteriors, error: intErr } = await db().from("coloring_v2_assets")
      .select("storage_path, page_number, created_at").eq("book_id", book_id).eq("kind", "interior")
      .order("created_at", { ascending: false });
    if (intErr) throw intErr;
    const byPage = new Map<number, { storage_path: string; page_number: number }>();
    for (const r of (allInteriors ?? [])) if (!byPage.has(r.page_number)) byPage.set(r.page_number, r);
    const interiors = Array.from(byPage.values()).sort((a, b) => a.page_number - b.page_number);
    const missing: number[] = [];
    for (let p = 1; p <= book.page_count; p++) if (!byPage.has(p)) missing.push(p);
    if (missing.length) throw new Error(`pdf: missing pages ${missing.join(",")}`);

    const pdf = await PDFDocument.create();
    pdf.setTitle(book.title ?? "Coloring Book");
    pdf.setAuthor("SecretPDF");
    pdf.setCreator("SecretPDF Coloring Lane V2");

    // helper
    async function downloadImage(path: string): Promise<Uint8Array> {
      const { data, error } = await db().storage.from("coloring-v2").download(path);
      if (error) throw error;
      return new Uint8Array(await data.arrayBuffer());
    }

    async function addImagePage(path: string) {
      const bytes = await downloadImage(path);
      const img = path.toLowerCase().endsWith(".png")
        ? await pdf.embedPng(bytes)
        : await pdf.embedJpg(bytes);
      const page = pdf.addPage([TRIM_PT, TRIM_PT]);
      page.drawImage(img, { x: 0, y: 0, width: TRIM_PT, height: TRIM_PT });
    }

    // Cover
    await addImagePage(coverAsset.storage_path);
    // Interiors
    for (const it of interiors) await addImagePage(it.storage_path);

    const pdfBytes = await pdf.save();

    const asset = await uploadAsset(book_id, "pdf", pdfBytes, "pdf",
      { pages: 1 + interiors.length, size_bytes: pdfBytes.byteLength });

    await db().from("coloring_v2_pdf_artifacts").insert({
      book_id, storage_path: asset.storage_path, sha256: asset.sha256,
      page_count: 1 + interiors.length, size_bytes: pdfBytes.byteLength, is_final: true,
    });

    await db().from("coloring_v2_books").update({
      final_pdf_asset_id: asset.id, final_pdf_sha256: asset.sha256,
    }).eq("id", book_id);

    await advance(book_id, "pdf", "publish");
    await fireStage("coloring-v2-publish", { book_id });
    return json({ ok: true, pdf_asset: asset.id, pages: 1 + interiors.length, next: "publish" });
  } catch (e: any) {
    await recordError(book_id, "pdf", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
