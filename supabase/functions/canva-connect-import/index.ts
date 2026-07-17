// canva-connect-import — take a Lovable-generated PDF and import it into
// Canva as an editable design. Persists design_id + edit_url into
// ebooks_kids.metadata.canva.
// Body: { ebook_id: string }
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { assertAdmin, canvaFetch, pollJob, sbAdmin } from "../_shared/canva.ts";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    assertAdmin(req);
    const { ebook_id } = await req.json();
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);
    const sb = sbAdmin();
    const { data: book, error } = await sb
      .from("ebooks_kids")
      .select("id, title, pdf_url, metadata")
      .eq("id", ebook_id)
      .single();
    if (error) throw error;
    if (!book.pdf_url) return json({ error: "book_has_no_pdf" }, 422);

    // Ensure a public/signed URL Canva can fetch. If pdf_url is a storage
    // path, sign it via storage; if it's already https, pass through.
    let sourceUrl = book.pdf_url as string;
    if (!/^https?:\/\//i.test(sourceUrl)) {
      const parts = sourceUrl.split("/");
      const bucket = parts.shift()!;
      const key = parts.join("/");
      const { data: signed, error: sErr } = await sb.storage
        .from(bucket)
        .createSignedUrl(key, 60 * 60);
      if (sErr) throw sErr;
      sourceUrl = signed.signedUrl;
    }

    const title = (book.title || "Coloring Book").slice(0, 100);
    const createRes = await canvaFetch(sb, "/url-imports", {
      method: "POST",
      body: JSON.stringify({
        title,
        url: sourceUrl,
        mime_type: "application/pdf",
      }),
    });
    const createTxt = await createRes.text();
    if (!createRes.ok) return json({ error: "canva_import_create_failed", status: createRes.status, body: createTxt }, createRes.status);
    const created = JSON.parse(createTxt);
    const jobId = created?.job?.id ?? created?.id;
    if (!jobId) return json({ error: "canva_import_no_job_id", body: created }, 500);

    const done = await pollJob(sb, `/url-imports/${jobId}`);
    const design = done?.job?.result?.designs?.[0] ?? done?.result?.designs?.[0];
    const design_id = design?.id;
    if (!design_id) return json({ error: "canva_import_no_design", body: done }, 500);
    const edit_url = design?.urls?.edit_url ?? `https://www.canva.com/design/${design_id}/edit`;
    const view_url = design?.urls?.view_url ?? `https://www.canva.com/design/${design_id}/view`;

    const nextMeta = {
      ...(book.metadata ?? {}),
      canva: {
        ...(book.metadata?.canva ?? {}),
        design_id,
        edit_url,
        view_url,
        last_import_at: new Date().toISOString(),
        imported_from_pdf_url: book.pdf_url,
        status: "imported",
      },
    };
    const { error: upErr } = await sb
      .from("ebooks_kids")
      .update({ metadata: nextMeta })
      .eq("id", ebook_id);
    if (upErr) throw upErr;

    return json({ ok: true, design_id, edit_url, view_url });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "unauthorized" ? 401 : msg === "canva_not_connected" ? 428 : 500;
    return json({ error: msg }, status);
  }
});

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
