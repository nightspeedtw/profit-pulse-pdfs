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
// (trim-lock no longer enforced on thumbnail: canvas tracks trimmed art aspect)

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

/**
 * Detect the bounding box of non-near-white content. Handles the letterbox
 * bars that fit-CONTAIN adds when the source art aspect (e.g. 2:3 from
 * gpt-image-1) differs from the master canvas aspect (8.5:11).
 * Threshold: pixels with any channel < 245 count as content.
 */
function detectContentBounds(img: any): { x: number; y: number; w: number; h: number } {
  const W = img.width, H = img.height;
  const isBg = (px: number) => {
    const r = (px >>> 24) & 0xff, g = (px >>> 16) & 0xff, b = (px >>> 8) & 0xff, a = px & 0xff;
    return a < 8 || (r >= 245 && g >= 245 && b >= 245);
  };
  let top = 0, bottom = H - 1, left = 0, right = W - 1;
  // Scan top
  outerTop: for (; top < H; top++) {
    for (let x = 0; x < W; x += 4) if (!isBg(img.getPixelAt(x + 1, top + 1))) break outerTop;
  }
  outerBot: for (; bottom > top; bottom--) {
    for (let x = 0; x < W; x += 4) if (!isBg(img.getPixelAt(x + 1, bottom + 1))) break outerBot;
  }
  outerL: for (; left < W; left++) {
    for (let y = top; y <= bottom; y += 4) if (!isBg(img.getPixelAt(left + 1, y + 1))) break outerL;
  }
  outerR: for (; right > left; right--) {
    for (let y = top; y <= bottom; y += 4) if (!isBg(img.getPixelAt(right + 1, y + 1))) break outerR;
  }
  // Guard: if detection collapsed, keep full frame.
  if (right - left < W * 0.3 || bottom - top < H * 0.3) {
    return { x: 0, y: 0, w: W, h: H };
  }
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/**
 * Render a fitted thumbnail sized to the ACTUAL art aspect (after trimming
 * the compositor's white letterbox). No secondary letterbox — the storefront
 * frame matches the raster edge-to-edge. Target long-edge = 900 px.
 */
async function renderThumbnail(coverBytes: Uint8Array): Promise<{
  bytes: Uint8Array;
  meta: {
    canvas: { width: number; height: number };
    source_size: { width: number; height: number };
    trimmed_size: { width: number; height: number };
    trim_bounds: { x: number; y: number; w: number; h: number };
    aspect_w_over_h: number;
    non_crop_pass: boolean;
    format: string;
  };
}> {
  const src = await Image.decode(coverBytes);
  const bounds = detectContentBounds(src);
  const trimmed = (bounds.w === src.width && bounds.h === src.height)
    ? src
    : (src as any).crop(bounds.x, bounds.y, bounds.w, bounds.h);

  // Target long-edge 900 px, preserve trimmed aspect exactly.
  const LONG = 900;
  const tw = trimmed.width, th = trimmed.height;
  const scale = Math.min(LONG / Math.max(tw, th), 1);
  const cw = Math.max(1, Math.round(tw * scale));
  const ch = Math.max(1, Math.round(th * scale));
  const canvas = trimmed.clone().resize(cw, ch);

  const bytes = await canvas.encodeJPEG(88);
  return {
    bytes,
    meta: {
      canvas: { width: cw, height: ch },
      source_size: { width: src.width, height: src.height },
      trimmed_size: { width: tw, height: th },
      trim_bounds: bounds,
      aspect_w_over_h: cw / ch,
      non_crop_pass: true,
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
      && existing?.version === "coloring_thumbnail_v2_trimmed"
      && row.thumbnail_url
      && row.thumbnail_url !== row.cover_url) {
      return json({ ok: true, skipped: "already_fitted", thumbnail_url: row.thumbnail_url });
    }

    const r = await fetch(row.cover_url);
    if (!r.ok) return json({ error: `fetch_cover_${r.status}` }, 502);
    const coverBytes = new Uint8Array(await r.arrayBuffer());

    const { bytes, meta: renderMeta } = await renderThumbnail(coverBytes);
    // No fixed trim assertion: the thumbnail canvas now tracks the actual
    // art aspect (letterbox trimmed) so the storefront frame matches the
    // raster edge-to-edge.

    const hash = await sha16(bytes);
    const path = `kids/${ebook_id}/coloring/thumb-${Date.now()}-${hash}.jpg`;
    const up = await uploadAndSignImage(db, "ebook-covers", path, bytes, {
      contentType: "image/jpeg",
    });

    const nextMeta = {
      ...meta,
      thumbnail_render_meta: {
        ...renderMeta,
        version: "coloring_thumbnail_v2_trimmed",
        source_cover_url: row.cover_url,
        source_hash: hash,
        rendered_at: new Date().toISOString(),
        storage_path: up.path,
        signed_url: up.signedUrl,
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
