import { corsHeaders, admin, requireAdmin } from "../_shared/ai.ts";

function filenameFromTitle(title: string | null | undefined) {
  const base = (title ?? "ebook")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "ebook";
  return `${base}.pdf`;
}

function pathFromPdfUrl(pdfUrl: string | null | undefined) {
  if (!pdfUrl) return null;
  try {
    const url = new URL(pdfUrl);
    const marker = "/storage/v1/object/sign/ebook-pdfs/";
    const altMarker = "/storage/v1/object/authenticated/ebook-pdfs/";
    const publicMarker = "/storage/v1/object/public/ebook-pdfs/";
    const pathname = url.pathname;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex >= 0) return decodeURIComponent(pathname.slice(markerIndex + marker.length));
    const altIndex = pathname.indexOf(altMarker);
    if (altIndex >= 0) return decodeURIComponent(pathname.slice(altIndex + altMarker.length));
    const publicIndex = pathname.indexOf(publicMarker);
    if (publicIndex >= 0) return decodeURIComponent(pathname.slice(publicIndex + publicMarker.length));
  } catch {
    return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id } = await req.json();
    if (!ebook_id) throw new Error("ebook_id required");

    // Look up the book in either ebooks (adult) or ebooks_kids (kids/coloring)
    let e: { title: string | null; pdf_url: string | null } | null = null;
    const { data: adult } = await db
      .from("ebooks")
      .select("title,pdf_url")
      .eq("id", ebook_id)
      .maybeSingle();
    if (adult) e = adult as any;
    if (!e) {
      const { data: kids } = await db
        .from("ebooks_kids")
        .select("title,pdf_url")
        .eq("id", ebook_id)
        .maybeSingle();
      if (kids) e = kids as any;
    }
    if (!e) throw new Error("Book not found in ebooks or ebooks_kids");
    if (!e.pdf_url) {
      throw new Error("PDF has not been built yet for this book (pdf_url is empty). Run the PDF build step before downloading.");
    }

    const path = pathFromPdfUrl(e.pdf_url) ?? `${ebook_id}/${filenameFromTitle(e.title)}`;
    const { data: file, error: downloadError } = await db.storage.from("ebook-pdfs").download(path);
    if (downloadError) throw downloadError;
    if (!file) throw new Error("PDF file not found in storage at path: " + path);

    return new Response(await file.arrayBuffer(), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `inline; filename="${filenameFromTitle(e.title)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});