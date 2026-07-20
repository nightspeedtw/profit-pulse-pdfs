// coloring-v2-pdf — assembles 8.5x8.5in square PDF: cover + matter + interiors + certificate.
// Matter pages design v2 (owner order 2026-07-20 — matter_pages_design_v2).
// @ts-nocheck
import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1";
import { advance, corsHeaders, db, fetchBook, fireStage, json, recordError, uploadAsset } from "../_shared/coloring-v2/state.ts";
import {
  resolveMatterStyle,
  drawColoringTitlePage,
  drawColoringCopyrightPage,
  drawColoringHowToPage,
  drawColoringCertificatePage,
  defaultCopyrightText,
} from "../_shared/coloring/matter-pages.ts";

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

    async function embedAny(bytes: Uint8Array, path: string) {
      const lower = path.toLowerCase();
      if (lower.endsWith(".png")) return await pdf.embedPng(bytes);
      return await pdf.embedJpg(bytes);
    }

    async function addFullBleedImagePage(path: string) {
      const bytes = await downloadImage(path);
      const img = await embedAny(bytes, path);
      const page = pdf.addPage([TRIM_PT, TRIM_PT]);
      page.drawImage(img, { x: 0, y: 0, width: TRIM_PT, height: TRIM_PT });
    }

    // Fonts + matter styling
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const ageMin = Number(book.age_min ?? 4);
    const ageMax = Number(book.age_max ?? Math.max(6, ageMin + 2));
    const style = resolveMatterStyle(ageMin, ageMax);
    const ageBadge = `Ages ${ageMin}-${ageMax}`;
    const subtitle = book.subtitle || `${interiors.length} Coloring Pages · ${ageBadge}`;
    const brand = "A SecretPDF Kids coloring book";

    // Grayscale vignettes reused from first 2 interior pages (0 extra AI cost).
    const vignettes: any[] = [];
    for (const src of interiors.slice(0, 2)) {
      try {
        const bytes = await downloadImage(src.storage_path);
        const img = await embedAny(bytes, src.storage_path);
        if (img) vignettes.push(img);
      } catch { /* best-effort */ }
    }

    // 1) Full-bleed cover
    await addFullBleedImagePage(coverAsset.storage_path);

    // 2) Title page (matter_pages_design_v2)
    {
      const p = pdf.addPage([TRIM_PT, TRIM_PT]);
      drawColoringTitlePage(
        { page: p, pageW: TRIM_PT, pageH: TRIM_PT, style, font: helv, fontBold: helvBold, vignettes },
        { title: book.title ?? "Coloring Book", subtitle, brand },
      );
    }
    // 3) Copyright page
    {
      const p = pdf.addPage([TRIM_PT, TRIM_PT]);
      drawColoringCopyrightPage(
        { page: p, pageW: TRIM_PT, pageH: TRIM_PT, style, font: helv, fontBold: helvBold, vignettes },
        { legalText: defaultCopyrightText() },
      );
    }
    // 4) How-to page
    {
      const p = pdf.addPage([TRIM_PT, TRIM_PT]);
      drawColoringHowToPage(
        { page: p, pageW: TRIM_PT, pageH: TRIM_PT, style, font: helv, fontBold: helvBold, vignettes },
        { totalPages: interiors.length },
      );
    }

    // 5) Interior coloring pages (full-bleed)
    for (const it of interiors) await addFullBleedImagePage(it.storage_path);

    // 6) Certificate back page
    {
      const p = pdf.addPage([TRIM_PT, TRIM_PT]);
      drawColoringCertificatePage(
        { page: p, pageW: TRIM_PT, pageH: TRIM_PT, style, font: helv, fontBold: helvBold, vignettes },
        { title: book.title ?? "Coloring Book", totalPages: interiors.length, ageBadge },
      );
    }

    const pdfBytes = await pdf.save();
    const totalPageCount = pdf.getPageCount();

    const asset = await uploadAsset(book_id, "pdf", pdfBytes, "pdf",
      { pages: totalPageCount, size_bytes: pdfBytes.byteLength, matter_version: "matter_pages_design_v2" });

    await db().from("coloring_v2_pdf_artifacts").insert({
      book_id, storage_path: asset.storage_path, sha256: asset.sha256,
      page_count: totalPageCount, size_bytes: pdfBytes.byteLength, is_final: true,
    });

    await db().from("coloring_v2_books").update({
      final_pdf_asset_id: asset.id, final_pdf_sha256: asset.sha256,
    }).eq("id", book_id);

    await advance(book_id, "pdf", "publish");
    await fireStage("coloring-v2-publish", { book_id });
    return json({ ok: true, pdf_asset: asset.id, pages: totalPageCount, next: "publish", matter_version: "matter_pages_design_v2" });
  } catch (e: any) {
    await recordError(book_id, "pdf", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
