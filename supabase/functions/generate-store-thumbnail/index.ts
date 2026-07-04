// Generate a real premium storefront thumbnail with EXACT title/subtitle text
// baked into the image (fonts embedded into resvg). Uploads to `ebook-covers`
// storage, updates `store_thumbnail_url` + `store_thumbnail_qc` on the ebook,
// and leaves cover_url / pdf_url / manuscript / price / copy fully untouched.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/stripe.ts";
import { buildStoreThumbnailSVG, rasterizeThumbnail, qcThumbnail } from "../_shared/store-thumbnail.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SIGNED_TTL = 60 * 60 * 24 * 365; // 1 year

async function log(ebookId: string, step: string, status: string, payload: unknown) {
  try {
    await supabase.from("pipeline_step_logs").insert({
      ebook_id: ebookId, step, status, payload: payload as any,
    });
  } catch (_) { /* best-effort */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const ebookId: string = body.ebook_id;
    const force: boolean = body.force === true;
    if (!ebookId) throw new Error("ebook_id is required");

    const { data: e, error } = await supabase
      .from("ebooks")
      .select("id, title, subtitle, category_slug, category_id, price, store_thumbnail_url")
      .eq("id", ebookId)
      .maybeSingle();
    if (error) throw error;
    if (!e) throw new Error("Ebook not found");
    if (!e.title) throw new Error("Ebook has no title");
    if (e.store_thumbnail_url && !force) {
      return new Response(JSON.stringify({ ok: true, ebook_id: ebookId, url: e.store_thumbnail_url, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch category slug fallback via category name if slug missing
    let categorySlug = e.category_slug;
    if (!categorySlug && e.category_id) {
      const { data: cat } = await supabase.from("categories").select("slug").eq("id", e.category_id).maybeSingle();
      categorySlug = cat?.slug ?? null;
    }

    await log(ebookId, "store_thumbnail.render", "started", { categorySlug });

    let bytes: Uint8Array | null = null;
    let svg = "";
    let qc: ReturnType<typeof qcThumbnail> | null = null;
    let attempts = 0;
    const MAX = 3;

    while (attempts < MAX) {
      attempts++;
      svg = buildStoreThumbnailSVG({
        title: e.title,
        subtitle: e.subtitle,
        categorySlug,
        price: e.price,
      });
      try {
        bytes = await rasterizeThumbnail(svg, 1200);
      } catch (err) {
        await log(ebookId, "store_thumbnail.render", "error", { attempt: attempts, error: (err as Error).message });
        continue;
      }
      qc = qcThumbnail({ bytes, svg, title: e.title });
      if (qc.passed) break;
      await log(ebookId, "store_thumbnail.qc", "retry", { attempt: attempts, reasons: qc.reasons });
    }

    if (!bytes || !qc) throw new Error("Rasterization failed after retries");

    // Even if QC didn't fully pass, keep the previous thumbnail and mark for review.
    if (!qc.passed && e.store_thumbnail_url) {
      await supabase.from("ebooks").update({
        thumbnail_needs_review: true,
        store_thumbnail_qc: qc as any,
      }).eq("id", ebookId);
      await log(ebookId, "store_thumbnail.qc", "failed_kept_previous", qc);
      return new Response(JSON.stringify({ ok: false, ebook_id: ebookId, qc, kept_previous: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // Upload
    const path = `${ebookId}/store_thumbnail.png`;
    const { error: upErr } = await supabase.storage.from("ebook-covers")
      .upload(path, bytes, { contentType: "image/png", upsert: true });
    if (upErr) throw upErr;
    const { data: signed, error: signErr } = await supabase.storage.from("ebook-covers")
      .createSignedUrl(path, SIGNED_TTL);
    if (signErr) throw signErr;

    const url = signed.signedUrl;

    const { error: updErr } = await supabase.from("ebooks").update({
      store_thumbnail_url: url,
      store_thumbnail_qc: qc as any,
      store_thumbnail_generated_at: new Date().toISOString(),
      thumbnail_needs_review: !qc.passed,
      updated_at: new Date().toISOString(),
    }).eq("id", ebookId);
    if (updErr) throw updErr;

    await log(ebookId, "store_thumbnail.render", "completed", { url, qc, attempts });

    return new Response(JSON.stringify({ ok: true, ebook_id: ebookId, url, qc, attempts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("generate-store-thumbnail error:", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
