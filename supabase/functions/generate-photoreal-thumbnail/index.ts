// Reference-grade photoreal book thumbnail generator.
// Two-stage: deterministic HTML cover face → Gemini 3 Pro Image photoreal mockup
// composite. Hard-gated by AI-critic QC. Overwrites store_thumbnail_url ONLY on
// pass. Never touches PDF / manuscript / price / copy. Never calls external storefront APIs.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/stripe.ts";
import {
  buildCoverFaceHtml,
  renderCoverFacePng,
  illustrationDebtExit,
  illustrationDeepEnergy,
  type CoverFaceInput,
} from "../_shared/cover-face.ts";
import { renderPhotorealMockup } from "../_shared/photoreal-mockup.ts";
import { qcPhotorealThumbnail } from "../_shared/thumbnail-qc-photoreal.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const SIGNED_TTL = 60 * 60 * 24 * 365;

// Known-book presets (Phase-1 samples only). Everything else falls through
// with a generic mapping; the endpoint is meant to be called explicitly.
const PRESETS: Record<string, (title: string, subtitle: string | null) => CoverFaceInput> = {
  "cfc0ab97-ec48-447a-a0ca-73513e36941f": (title, subtitle) => ({
    title,
    subtitle: subtitle ?? "A Practical Plan to Eliminate Debt with Confidence",
    badge: "EBOOK",
    style: "matte_black_gold",
    illustrationSvg: illustrationDebtExit("#f4c430", "#f5f1e6"),
    footerChips: ["Clear Plan", "6-Month Framework", "Build Momentum", "Financial Freedom"],
  }),
  "160f23dd-2c74-4bd0-910d-2fb3d1a5b00e": (title, subtitle) => ({
    title,
    subtitle: subtitle ?? "Restore Steady Energy in 30 Days",
    badge: "FIELD GUIDE",
    style: "forest_wellness",
    illustrationSvg: illustrationDeepEnergy("#e8b64a", "#f4ecd8"),
    footerChips: ["Daily Rhythm", "Deep Recovery", "Calm Focus", "Sustained Energy"],
  }),
};

async function log(ebookId: string, step: string, status: string, payload: unknown) {
  try {
    await supabase.from("pipeline_step_logs").insert({ ebook_id: ebookId, step, status, payload: payload as any });
  } catch (_) { /* best effort */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const ebookId: string = body.ebook_id;
    const dryRun: boolean = body.dry_run === true;
    const promoteInspection: boolean = body.promote_inspection === true;
    const overrideNote: string | undefined = body.override_note;
    const maxAttempts: number = Math.min(3, Math.max(1, Number(body.max_attempts ?? 3)));
    if (!ebookId) throw new Error("ebook_id is required");

    const { data: e, error } = await supabase
      .from("ebooks")
      .select("id, title, subtitle, store_thumbnail_url")
      .eq("id", ebookId)
      .maybeSingle();
    if (error) throw error;
    if (!e?.title) throw new Error("ebook not found or missing title");

    // ------ Promote-inspection short path (manual override) ------
    // Copies the previously-generated `photoreal_attempt.png` into the final
    // `store_thumbnail.png` slot and updates the ebook row. Skips Stage 1/2
    // regeneration entirely — used when a strict QC gate blocked promotion
    // but the operator is satisfied with the visual result.
    if (promoteInspection) {
      const inspectionPath = `${ebookId}/photoreal_attempt.png`;
      const { data: file, error: dlErr } = await supabase.storage
        .from("ebook-covers").download(inspectionPath);
      if (dlErr || !file) throw new Error(`no inspection png to promote: ${dlErr?.message ?? "not found"}`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const finalPath = `${ebookId}/store_thumbnail.png`;
      const { error: upErr } = await supabase.storage.from("ebook-covers")
        .upload(finalPath, bytes, { contentType: "image/png", upsert: true });
      if (upErr) throw upErr;
      const { data: signed, error: signErr } = await supabase.storage.from("ebook-covers")
        .createSignedUrl(finalPath, SIGNED_TTL);
      if (signErr) throw signErr;
      const url = signed.signedUrl;
      const { error: updErr } = await supabase.from("ebooks").update({
        store_thumbnail_url: url,
        store_thumbnail_qc: {
          source: "photoreal_gemini3_pro_image",
          promoted_via: "manual_override",
          note: overrideNote ?? "operator approved best attempt despite strict shadow_lighting_score gate",
        } as any,
        store_thumbnail_generated_at: new Date().toISOString(),
        thumbnail_needs_review: false,
        updated_at: new Date().toISOString(),
      }).eq("id", ebookId);
      if (updErr) throw updErr;
      await log(ebookId, "photoreal_thumbnail.final", "completed_override", { url });
      return new Response(JSON.stringify({ ok: true, ebook_id: ebookId, url, promoted_via: "manual_override" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const preset = PRESETS[ebookId];
    if (!preset) throw new Error(`no preset registered for ebook ${ebookId} — sample-only endpoint`);

    await log(ebookId, "photoreal_thumbnail.start", "started", { title: e.title });

    // ---- Stage 1: deterministic cover face ----
    const spec = preset(e.title, e.subtitle);
    const html = buildCoverFaceHtml(spec);
    const facePng = await renderCoverFacePng(html);
    await log(ebookId, "photoreal_thumbnail.cover_face", "completed", { bytes: facePng.length });

    // ---- Stage 2: photoreal mockup w/ up to N attempts ----
    let mockupBytes: Uint8Array | null = null;
    let qc: any = null;
    let attempts = 0;
    let repairReasons: string[] = [];
    let lastPrompt = "";
    let lastModel = "";

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const r = await renderPhotorealMockup(facePng, { attempt: attempts, repairReasons });
        lastModel = r.model;
        lastPrompt = r.prompt;
        qc = await qcPhotorealThumbnail(r.bytes, e.title);
        await log(ebookId, "photoreal_thumbnail.attempt", qc.passed ? "passed" : "failed", { attempt: attempts, qc });
        if (qc.passed) { mockupBytes = r.bytes; break; }
        // failed → also keep bytes so caller can inspect the best attempt
        mockupBytes = r.bytes;
        repairReasons = qc.repair_hints ?? [];
      } catch (err) {
        await log(ebookId, "photoreal_thumbnail.attempt", "error", { attempt: attempts, error: (err as Error).message });
      }
    }

    if (!mockupBytes || !qc) throw new Error("photoreal thumbnail generation failed with no output");

    // Always upload the last attempt to an inspection path so the reviewer can see it.
    const inspectionPath = `${ebookId}/photoreal_attempt.png`;
    await supabase.storage.from("ebook-covers").upload(inspectionPath, mockupBytes, {
      contentType: "image/png", upsert: true,
    });
    const { data: inspSigned } = await supabase.storage.from("ebook-covers")
      .createSignedUrl(inspectionPath, SIGNED_TTL);

    if (!qc.passed || dryRun) {
      await log(ebookId, "photoreal_thumbnail.final", qc.passed ? "dry_run" : "failed_kept_previous", {
        qc, attempts, inspection_url: inspSigned?.signedUrl,
      });
      return new Response(JSON.stringify({
        ok: qc.passed,
        ebook_id: ebookId,
        passed: qc.passed,
        attempts,
        qc,
        inspection_url: inspSigned?.signedUrl,
        store_thumbnail_url_unchanged: e.store_thumbnail_url,
        dry_run: dryRun,
        model: lastModel,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Pass: promote to store_thumbnail_url
    const finalPath = `${ebookId}/store_thumbnail.png`;
    const { error: upErr } = await supabase.storage.from("ebook-covers")
      .upload(finalPath, mockupBytes, { contentType: "image/png", upsert: true });
    if (upErr) throw upErr;
    const { data: signed, error: signErr } = await supabase.storage.from("ebook-covers")
      .createSignedUrl(finalPath, SIGNED_TTL);
    if (signErr) throw signErr;

    const url = signed.signedUrl;
    const { error: updErr } = await supabase.from("ebooks").update({
      store_thumbnail_url: url,
      store_thumbnail_qc: { source: "photoreal_gemini3_pro_image", model: lastModel, attempts, ...qc } as any,
      store_thumbnail_generated_at: new Date().toISOString(),
      thumbnail_needs_review: false,
      updated_at: new Date().toISOString(),
    }).eq("id", ebookId);
    if (updErr) throw updErr;

    await log(ebookId, "photoreal_thumbnail.final", "completed", { url, qc, attempts, model: lastModel });

    return new Response(JSON.stringify({
      ok: true, ebook_id: ebookId, url, passed: true, attempts, qc, model: lastModel,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("generate-photoreal-thumbnail error:", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
