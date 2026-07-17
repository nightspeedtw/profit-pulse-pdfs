// canva-connect-promote — copy the exported Canva PDF back into canonical
// pdf_url so it becomes the sellable artifact. Explicit owner action.
// Body: { ebook_id: string }
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { assertAdmin, sbAdmin } from "../_shared/canva.ts";

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
      .select("id, metadata, pdf_url")
      .eq("id", ebook_id)
      .single();
    if (error) throw error;
    const exported = book?.metadata?.canva?.exported_pdf_storage_path;
    if (!exported) return json({ error: "no_canva_export_to_promote" }, 422);
    const nextMeta = {
      ...(book.metadata ?? {}),
      canva: { ...(book.metadata?.canva ?? {}), promoted_at: new Date().toISOString() },
      pre_canva_pdf_url: book.pdf_url ?? null,
    };
    const { error: upErr } = await sb
      .from("ebooks_kids")
      .update({ pdf_url: exported, metadata: nextMeta })
      .eq("id", ebook_id);
    if (upErr) throw upErr;
    return json({ ok: true, pdf_url: exported });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "unauthorized" ? 401 : 500;
    return json({ error: msg }, status);
  }
});

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
