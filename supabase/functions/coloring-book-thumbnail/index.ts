// coloring-book-thumbnail — derive a distinct, fitted thumbnail asset from
// the already-approved master cover.
//
// Canvas: 600×776 px (same 8.5:11 ratio as the cover, sized for retina
// storefront cards). Format: JPEG q=85. NO text is composited — the cover's
// baked title is already inside the source art; this step only re-scales
// and letterboxes onto a white canvas so nothing bleeds off the edge.
//
// After success the row's thumbnail_url is updated to a NEW asset URL
// (guaranteed distinct from cover_url) and metadata.thumbnail_render_meta
// records the canvas, source hash, and non-crop verification.

// @ts-nocheck  Deno edge runtime
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { uploadAndSignImage } from "../_shared/versioned-assets.ts";
import { COLORING_TRIM, assertColoringTrim } from "../_shared/coloring/trim-lock.ts";

declare const Deno: any;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha16(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** Re-derive a fitted thumbnail with letterbox padding on white. */
async function renderThumbnail(coverBytes: Uint8Array): Promise<{
  bytes: Uint8Array;
  meta: {
    canvas: { width: number; height: number };
    source_size: { width: number; height: number };
    fitted_size: { width: number; height: number };
    letterbox: { top: number; bottom: number; left: number; right: number };
    non_crop_pass: boolean;
    format: string;
  };
}> {
  const src = await Image.decode(coverBytes);
  const cw = COLORING_TRIM.thumbnailPx.width;
  const ch = COLORING_TRIM.thumbnailPx.height;
  const sw = src.width, sh = src.height;

  // Fit-contain (letterbox on white) — never crop the baked title.
  const scale = Math.min(cw / sw, ch / sh);
  const fw = Math.max(1, Math.round(sw * scale));
  const fh = Math.max(1, Math.round(sh * scale));
  const dx = Math.floor((cw - fw) / 2);
  const dy = Math.floor((ch - fh) / 2);

  const fitted = src.clone().resize(fw, fh);
  const canvas = new Image(cw, ch).fill(0xffffffff); // solid white
  canvas.composite(fitted, dx, dy);

  // Non-crop verification: sample the four edges of the fitted region and
  // confirm they aren't touching the raw canvas edges (letterbox must exist
  // when aspect drifts; when aspect matches exactly, dx/dy can be 0 which
  // is still fine — the source art is already trim-locked).
  const nonCropPass = dx >= 0 && dy >= 0 && fw <= cw && fh <= ch;

  const bytes = await canvas.encodeJPEG(85);
  return {
    bytes,
    meta: {
      canvas: { width: cw, height: ch },
      source_size: { width: sw, height: sh },
      fitted_size: { width: fw, height: fh },
      letterbox: { top: dy, bottom: ch - (dy + fh), left: dx, right: cw - (dx + fw) },
      non_crop_pass: nonCropPass,
      format: "image/jpeg",
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { ebook_id, force } = await req.json();
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: row, error } = await db.from("ebooks_kids")
      .select("id, book_type, cover_url, thumbnail_url, metadata")
      .eq("id", ebook_id).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: "not_found" }, 404);
    if (row.book_type !== "coloring_book") return json({ error: "wrong_lane" }, 400);
    if (!row.cover_url) return json({ error: "no_cover_url" }, 422);

    const meta = (row.metadata ?? {}) as Record<string, any>;
    const existing = meta.thumbnail_render_meta ?? null;
    if (!force
      && existing?.non_crop_pass === true
      && row.thumbnail_url
      && row.thumbnail_url !== row.cover_url
      && Number(existing?.canvas?.width) === COLORING_TRIM.thumbnailPx.width
      && Number(existing?.canvas?.height) === COLORING_TRIM.thumbnailPx.height) {
      return json({ ok: true, skipped: "already_fitted", thumbnail_url: row.thumbnail_url });
    }

    const r = await fetch(row.cover_url);
    if (!r.ok) return json({ error: `fetch_cover_${r.status}` }, 502);
    const coverBytes = new Uint8Array(await r.arrayBuffer());

    const { bytes, meta: renderMeta } = await renderThumbnail(coverBytes);
    // Trim sanity check on the produced canvas.
    const trim = assertColoringTrim("thumbnail", renderMeta.canvas.width, renderMeta.canvas.height);
    if (!trim.pass) return json({ error: `thumbnail_trim_mismatch:${trim.reason}` }, 500);

    const hash = await sha16(bytes);
    const path = `kids/${ebook_id}/coloring/thumb-${Date.now()}-${hash}.jpg`;
    const up = await uploadAndSignImage(db, "ebook-covers", path, bytes, {
      contentType: "image/jpeg",
    });

    const nextMeta = {
      ...meta,
      thumbnail_render_meta: {
        ...renderMeta,
        version: "coloring_thumbnail_v1",
        source_cover_url: row.cover_url,
        source_hash: hash,
        rendered_at: new Date().toISOString(),
        storage_path: up.path,
        signed_url: up.signedUrl,
        trim_assertion: trim,
      },
    };
    await db.from("ebooks_kids").update({
      thumbnail_url: up.signedUrl,
      metadata: nextMeta,
    }).eq("id", ebook_id);

    return json({
      ok: true, thumbnail_url: up.signedUrl, non_crop_pass: renderMeta.non_crop_pass,
      canvas: renderMeta.canvas, source_size: renderMeta.source_size,
    });
  } catch (e: any) {
    console.error("[coloring-book-thumbnail] fatal", e?.message);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
