// Generate a premium storefront thumbnail as a photoreal 3D book mockup using
// the Lovable AI Gateway (Gemini 3.1 Flash Image) with the approved flat cover
// as the reference. Falls back to the deterministic SVG mockup only if the AI
// call fails or the ebook has no cover_url.
//
// This function NEVER touches cover_url, pdf_url, manuscript, price, or copy.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/stripe.ts";
import { buildStoreThumbnailSVG, rasterizeThumbnail, qcThumbnail } from "../_shared/store-thumbnail.ts";
import { generateBookMockup } from "../_shared/book-mockup.ts";

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

async function signIfNeeded(rawUrl: string | null | undefined): Promise<string | null> {
  if (!rawUrl) return null;
  // Already a signed/public URL
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  // Storage path like "<ebook_id>/cover.png"
  const { data, error } = await supabase.storage.from("ebook-covers").createSignedUrl(rawUrl, 60 * 10);
  if (error) return null;
  return data?.signedUrl ?? null;
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
      .select("id, title, subtitle, category_slug, category_id, price, store_thumbnail_url, cover_url, key_benefits, benefit_bullets")
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

    await log(ebookId, "store_thumbnail.render", "started", { categorySlug, has_cover: !!e.cover_url });

    let bytes: Uint8Array | null = null;
    let qc: { passed: boolean; scores?: Record<string, number>; reasons: string[] } | null = null;
    let source: "ai_mockup" | "svg_fallback" = "svg_fallback";
    let attempts = 0;

    // ----- Try photoreal AI book mockup first -----
    const coverSigned = await signIfNeeded(e.cover_url);
    if (coverSigned) {
      try {
        const result = await generateBookMockup({
          coverUrl: coverSigned,
          title: e.title,
          subtitle: e.subtitle,
          categorySlug,
        });
        bytes = result.bytes;
        qc = result.qc;
        attempts = result.attempts;
        source = "ai_mockup";
        await log(ebookId, "store_thumbnail.ai_mockup", "completed", { model: result.model, attempts, qc });
      } catch (aiErr) {
        await log(ebookId, "store_thumbnail.ai_mockup", "failed", { error: (aiErr as Error).message });
      }
    } else {
      await log(ebookId, "store_thumbnail.ai_mockup", "skipped", { reason: "no_cover_url" });
    }

    // ----- SVG fallback -----
    if (!bytes) {
      const MAX = 3;
      let svgAttempts = 0;
      while (svgAttempts < MAX) {
        svgAttempts++;
        const svg = buildStoreThumbnailSVG({
          title: e.title,
          subtitle: e.subtitle,
          categorySlug,
          price: e.price,
        });
        try {
          bytes = await rasterizeThumbnail(svg, 1200);
        } catch (err) {
          await log(ebookId, "store_thumbnail.svg_render", "error", { attempt: svgAttempts, error: (err as Error).message });
          continue;
        }
        const svgQc = qcThumbnail({ bytes, svg, title: e.title });
        qc = { passed: svgQc.passed, scores: (svgQc as any).scores, reasons: svgQc.reasons };
        if (svgQc.passed) break;
      }
      attempts = svgAttempts;
    }

    if (!bytes || !qc) throw new Error("Thumbnail generation failed after retries");

    // Keep previous if the fresh attempt failed QC and we already have one on file.
    if (!qc.passed && e.store_thumbnail_url) {
      await supabase.from("ebooks").update({
        thumbnail_needs_review: true,
        store_thumbnail_qc: { source, ...qc } as any,
      }).eq("id", ebookId);
      await log(ebookId, "store_thumbnail.qc", "failed_kept_previous", { source, qc });
      return new Response(JSON.stringify({ ok: false, ebook_id: ebookId, source, qc, kept_previous: true }), {
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
      store_thumbnail_qc: { source, ...qc } as any,
      store_thumbnail_generated_at: new Date().toISOString(),
      thumbnail_needs_review: !qc.passed,
      updated_at: new Date().toISOString(),
    }).eq("id", ebookId);
    if (updErr) throw updErr;

    await log(ebookId, "store_thumbnail.render", "completed", { url, source, qc, attempts });

    return new Response(JSON.stringify({ ok: true, ebook_id: ebookId, url, source, qc, attempts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("generate-store-thumbnail error:", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
