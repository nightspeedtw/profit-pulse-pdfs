// One-shot: re-fit an existing raw cover art through the CURRENT compositor
// (fit-CONTAIN, letterbox — round_3 CLASS cover-pdf-embed-crop-v1), upload a
// fresh cover-final, swap cover_url + thumbnail_url, and chain thumbnail +
// assemble + publish. Uses the pending raw at metadata.coloring_cover.
// split_v1.generated_pending_path so we do NOT regen the art.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { fitCoverArtToPortraitCanvas, COLORING_COVER_WIDTH, COLORING_COVER_HEIGHT } from "../_shared/coloring/coloring-cover-compositor.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function fireAndForget(path: string, body: unknown) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (_) {}
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { ebook_id, raw_path } = await req.json();
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: row, error } = await db.from("ebooks_kids").select("id, metadata").eq("id", ebook_id).maybeSingle();
    if (error || !row) return json({ error: `not_found:${error?.message ?? ""}` }, 404);
    const meta: any = row.metadata ?? {};
    const pendingPath: string | undefined =
      raw_path ?? meta?.coloring_cover?.split_v1?.generated_pending_path ?? meta?.coloring_cover?.storage_path;
    if (!pendingPath) return json({ error: "no_pending_or_final_path" }, 400);

    const dl = await db.storage.from("ebook-covers").download(pendingPath);
    if (dl.error || !dl.data) return json({ error: `download:${dl.error?.message}` }, 500);
    const rawBytes = new Uint8Array(await dl.data.arrayBuffer());

    const finalBytes = await fitCoverArtToPortraitCanvas(rawBytes, COLORING_COVER_WIDTH, COLORING_COVER_HEIGHT);
    const version = `${Date.now()}`;
    const finalPath = `kids/${ebook_id}/coloring/cover-final-refit-${version}.png`;
    const up = await db.storage.from("ebook-covers").upload(finalPath, finalBytes, { contentType: "image/png", upsert: false });
    if (up.error) return json({ error: `upload:${up.error.message}` }, 500);
    const signed = await db.storage.from("ebook-covers").createSignedUrl(finalPath, 60 * 60 * 24 * 365);
    if (signed.error || !signed.data?.signedUrl) return json({ error: `sign:${signed.error?.message}` }, 500);

    const cc = meta.coloring_cover ?? {};
    cc.url = signed.data.signedUrl;
    cc.storage_path = finalPath;
    cc.final_composed_url = signed.data.signedUrl;
    cc.final_composed_storage_path = finalPath;
    cc.art_only_url = signed.data.signedUrl;
    cc.art_only_storage_path = finalPath;
    cc.refit_at = new Date().toISOString();
    cc.refit_reason = "cover-pdf-embed-crop-v1: fit-CONTAIN letterbox re-render";

    await db.from("ebooks_kids").update({
      cover_url: signed.data.signedUrl,
      thumbnail_url: signed.data.signedUrl,
      metadata: { ...meta, coloring_cover: cc, awaiting: "cover_pdf_publish" },
    }).eq("id", ebook_id);

    await fireAndForget("coloring-book-thumbnail", { ebook_id, force: true });
    await fireAndForget("coloring-book-assemble", { ebook_id, force: true });

    return json({ ok: true, ebook_id, cover_url: signed.data.signedUrl, final_bytes: finalBytes.length, chained: "thumbnail+assemble" });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
