// generate-sample-pdf — creates or returns a cached 5-page free-sample PDF
// for a coloring book. Fully automatic: derives preview pages from the
// book's metadata.preview_page_urls (first 5 interior pages). No admin work.
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

declare const Deno: any;

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (x: any, s = 200) =>
  new Response(JSON.stringify(x), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

async function fetchImage(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}

async function embedImage(pdf: PDFDocument, bytes: Uint8Array) {
  // Try JPG first, then PNG.
  try {
    return await pdf.embedJpg(bytes);
  } catch {
    try {
      return await pdf.embedPng(bytes);
    } catch {
      return null;
    }
  }
}

function hashUrls(urls: string[]): string {
  let h = 0;
  for (const s of urls) {
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
  }
  return String(h);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const bookId = String(body?.book_id ?? "").trim();
    const force = body?.force === true;
    if (!bookId) return j({ error: "book_id required" }, 400);

    const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

    const { data: book, error: bookErr } = await db
      .from("ebooks_kids")
      .select("id, title, slug, metadata, price, listing_status")
      .eq("id", bookId)
      .maybeSingle();
    if (bookErr) return j({ error: bookErr.message }, 500);
    if (!book) return j({ error: "book_not_found" }, 404);

    const meta = (book.metadata as any) ?? {};
    const previewUrls: string[] = Array.isArray(meta.preview_page_urls)
      ? meta.preview_page_urls.filter((s: any) => typeof s === "string" && s.length > 0).slice(0, 5)
      : [];

    if (previewUrls.length === 0) {
      return j({ error: "no_preview_pages_available" }, 422);
    }

    const contentHash = hashUrls(previewUrls);
    const cached = meta.sample_pdf_url as string | undefined;
    const cachedHash = meta.sample_pdf_source_hash as string | undefined;
    if (!force && cached && cachedHash === contentHash) {
      return j({ ok: true, sample_pdf_url: cached, cached: true });
    }

    // Build the PDF (US Letter — 612×792 pt).
    const pdf = await PDFDocument.create();
    pdf.setTitle(`Free Sample — ${book.title ?? "Coloring Book"}`);
    pdf.setAuthor("SecretPDF Kids");
    pdf.setSubject("5-page free coloring sample");
    pdf.setKeywords(["coloring", "sample", "kids", "printable"]);

    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    const fontLight = await pdf.embedFont(StandardFonts.Helvetica);
    const pageW = 612;
    const pageH = 792;

    // Cover page
    {
      const p = pdf.addPage([pageW, pageH]);
      p.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: rgb(1, 1, 1) });
      p.drawText("FREE SAMPLE", {
        x: 60, y: pageH - 120, size: 34, font, color: rgb(0.05, 0.05, 0.1),
      });
      const title = String(book.title ?? "Coloring Book").slice(0, 60);
      p.drawText(title, {
        x: 60, y: pageH - 170, size: 22, font, color: rgb(0.1, 0.1, 0.2),
      });
      p.drawText("5 printable pages from SecretPDF Kids", {
        x: 60, y: pageH - 210, size: 13, font: fontLight, color: rgb(0.35, 0.35, 0.4),
      });
      p.drawRectangle({
        x: 60, y: 200, width: pageW - 120, height: 240,
        borderColor: rgb(0.1, 0.1, 0.2), borderWidth: 2, color: rgb(0.98, 0.96, 0.92),
      });
      p.drawText("The full book is 82 pages — printable at home,", {
        x: 80, y: 380, size: 14, font: fontLight, color: rgb(0.1, 0.1, 0.2),
      });
      p.drawText("A4 + US Letter, instant download.", {
        x: 80, y: 358, size: 14, font: fontLight, color: rgb(0.1, 0.1, 0.2),
      });
      const priceLabel = book.price ? `Get the full book — $${Number(book.price).toFixed(2)}` : "Get the full book";
      p.drawText(priceLabel, {
        x: 80, y: 300, size: 18, font, color: rgb(0.05, 0.05, 0.1),
      });
      const slug = book.slug ? `secretpdf.co/kids/coloring/${book.slug}` : "secretpdf.co";
      p.drawText(slug, {
        x: 80, y: 268, size: 11, font: fontLight, color: rgb(0.35, 0.35, 0.4),
      });
      p.drawText("Personal use only. © SecretPDF Kids.", {
        x: 60, y: 40, size: 9, font: fontLight, color: rgb(0.5, 0.5, 0.55),
      });
    }

    // Interior sample pages
    let embedded = 0;
    for (let i = 0; i < previewUrls.length; i++) {
      const bytes = await fetchImage(previewUrls[i]);
      if (!bytes) continue;
      const img = await embedImage(pdf, bytes);
      if (!img) continue;
      const p = pdf.addPage([pageW, pageH]);
      p.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: rgb(1, 1, 1) });
      // Fit image into 540×680 area centered, preserve aspect.
      const maxW = 540, maxH = 680;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (pageW - w) / 2;
      const y = (pageH - h) / 2 + 20;
      p.drawImage(img, { x, y, width: w, height: h });
      // Footer stamp
      p.drawText(`Sample page ${i + 1} of 5 — SecretPDF Kids`, {
        x: 60, y: 30, size: 9, font: fontLight, color: rgb(0.5, 0.5, 0.55),
      });
      p.drawText("Get the full 82-page book at secretpdf.co", {
        x: pageW - 260, y: 30, size: 9, font: fontLight, color: rgb(0.5, 0.5, 0.55),
      });
      embedded++;
    }

    if (embedded === 0) {
      return j({ error: "no_embeddable_pages" }, 422);
    }

    const pdfBytes = await pdf.save();

    // Upload to storage
    const path = `samples/${bookId}.pdf`;
    const { error: upErr } = await db.storage.from("ebook-pdfs").upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upErr) return j({ error: `upload_failed: ${upErr.message}` }, 500);

    // Signed URL (30 days)
    const { data: signed, error: signErr } = await db.storage
      .from("ebook-pdfs")
      .createSignedUrl(path, 60 * 60 * 24 * 30);
    if (signErr || !signed?.signedUrl) {
      return j({ error: `sign_failed: ${signErr?.message ?? "unknown"}` }, 500);
    }

    // Cache into metadata (atomic patch)
    await db.rpc("atomic_patch_ebooks_kids_meta", {
      p_id: bookId,
      p_patch: {
        sample_pdf_url: signed.signedUrl,
        sample_pdf_source_hash: contentHash,
        sample_pdf_built_at: new Date().toISOString(),
        sample_pdf_page_count: embedded,
      },
    });

    return j({
      ok: true,
      sample_pdf_url: signed.signedUrl,
      pages_embedded: embedded,
      cached: false,
    });
  } catch (e: any) {
    return j({ error: e?.message ?? String(e) }, 500);
  }
});
