// canva-connect-export — export the currently linked Canva design back into
// storage and record the URLs on ebooks_kids.metadata.canva. Does NOT
// overwrite canonical pdf_url / cover_url — owner promotes manually.
// Body: { ebook_id: string, formats?: ("pdf"|"png")[] }
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { assertAdmin, canvaFetch, pollJob, sbAdmin } from "../_shared/canva.ts";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    assertAdmin(req);
    const { ebook_id, formats } = await req.json();
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);
    const wanted: string[] = Array.isArray(formats) && formats.length ? formats : ["pdf"];
    const sb = sbAdmin();
    const { data: book, error } = await sb
      .from("ebooks_kids")
      .select("id, metadata")
      .eq("id", ebook_id)
      .single();
    if (error) throw error;
    const design_id = book?.metadata?.canva?.design_id;
    if (!design_id) return json({ error: "no_linked_canva_design" }, 422);

    const outputs: any = { ...(book.metadata?.canva ?? {}) };

    for (const fmt of wanted) {
      const spec = fmt === "png"
        ? { type: "png" }
        : { type: "pdf", size: "letter", export_quality: "regular" };
      const createRes = await canvaFetch(sb, "/exports", {
        method: "POST",
        body: JSON.stringify({ design_id, format: spec }),
      });
      const createTxt = await createRes.text();
      if (!createRes.ok) return json({ error: "canva_export_create_failed", format: fmt, status: createRes.status, body: createTxt }, createRes.status);
      const created = JSON.parse(createTxt);
      const jobId = created?.job?.id ?? created?.id;
      if (!jobId) return json({ error: "canva_export_no_job_id", body: created }, 500);
      const done = await pollJob(sb, `/exports/${jobId}`, { timeoutMs: 180_000 });
      const urls: string[] = (done?.job?.urls ?? done?.urls ?? []) as string[];
      if (!urls.length) return json({ error: "canva_export_no_urls", body: done }, 500);

      if (fmt === "pdf") {
        const key = `canva/${ebook_id}.pdf`;
        const bytes = new Uint8Array(await (await fetch(urls[0])).arrayBuffer());
        const { error: upErr } = await sb.storage
          .from("ebook-pdfs")
          .upload(key, bytes, { contentType: "application/pdf", upsert: true });
        if (upErr) throw upErr;
        const { data: signed } = await sb.storage.from("ebook-pdfs").createSignedUrl(key, 60 * 60 * 24 * 7);
        outputs.exported_pdf_url = signed?.signedUrl ?? null;
        outputs.exported_pdf_storage_path = `ebook-pdfs/${key}`;
      } else if (fmt === "png") {
        const pageUrls: string[] = [];
        for (let i = 0; i < urls.length; i++) {
          const key = `canva/${ebook_id}-p${i + 1}.png`;
          const bytes = new Uint8Array(await (await fetch(urls[i])).arrayBuffer());
          const { error: upErr } = await sb.storage
            .from("ebook-covers")
            .upload(key, bytes, { contentType: "image/png", upsert: true });
          if (upErr) throw upErr;
          const { data: signed } = await sb.storage.from("ebook-covers").createSignedUrl(key, 60 * 60 * 24 * 7);
          if (signed?.signedUrl) pageUrls.push(signed.signedUrl);
        }
        outputs.exported_page_urls = pageUrls;
      }
    }

    outputs.last_export_at = new Date().toISOString();
    outputs.status = "exported";

    const nextMeta = {
      ...(book.metadata ?? {}),
      canva: outputs,
    };
    const { error: upErr } = await sb
      .from("ebooks_kids")
      .update({ metadata: nextMeta })
      .eq("id", ebook_id);
    if (upErr) throw upErr;
    return json({ ok: true, canva: outputs });
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
