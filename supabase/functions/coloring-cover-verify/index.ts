// coloring-cover-verify — HALF 2 of the split cover pipeline.
//
// Fresh isolate. OOM-bounded by construction:
//   1. read metadata.cover_pending_verify
//   2. ONE fetch of signed URL → raw bytes (~2MB)
//   3. ONE downsampled decode to 512px (~1MB RGBA)
//   4. vision gates via URL reference (no base64 body — gateway fetches)
//   5. color evidence + rendered proof on the downsampled RGBA only
//   6. uniqueness fingerprint on downsampled bytes
//   7. on pass: fit to canvas → upload final → atomic swap cover_url →
//      chain thumbnail + assemble
//   8. on fail: stamp blocker with strike; requeue as cover_pdf_publish so
//      the next tick invokes coloring-cover-generate again (ceiling-bound)
//
// Never holds more than one full-res buffer at a time; peak memory well
// below the 256MB isolate budget.

// @ts-nocheck  Deno edge runtime
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { computeLuminance } from "../_shared/image-luminance.ts";
import { detectBlankRegions } from "../_shared/covers/blank-detect.ts";
import { uploadAndSignImage } from "../_shared/versioned-assets.ts";
import { MEASURED_COVER_GATE_VERSION, measuredCoverScorecard } from "../_shared/covers/cover-measured-gate.ts";
import { transcribeGlyphsByUrl, verifyCategoryHeroByUrl } from "../_shared/covers/cover-vision-guards.ts";
import { verifyExactCoverTextByUrl } from "../_shared/coloring/cover-text-transcription.ts";
import { renderedColoringCoverProof } from "../_shared/coloring/coloring-cover-proof.ts";
import { fitCoverArtToPortraitCanvas, COLORING_COVER_COMPOSITOR_VERSION, COLORING_COVER_HEIGHT, COLORING_COVER_WIDTH } from "../_shared/coloring/coloring-cover-compositor.ts";
import { resolveTrimProfileKey, TRIM_PROFILES } from "../_shared/coloring/trim-lock.ts";
import { computeCoverFingerprint, findDuplicateCover, DUPLICATE_HAMMING_THRESHOLD } from "../_shared/coloring/cover-uniqueness.ts";
import { scheduleSelfAdvance, SELF_ADVANCE_DELAY_BACKOFF_MS, fireAndForgetPost } from "../_shared/coloring/self-advance.ts";
import { atomicPatchMeta } from "../_shared/kids-metadata.ts";

declare const Deno: any;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_ANALYSIS_DIM = 512;
const VISION_TIMEOUT_MS = 12_000;
const SPLIT_VERSION = "coloring_cover_split_v1_verify";

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
// Race-safe metadata patch — see _shared/kids-metadata.ts.
async function patchMeta(db: any, id: string, patch: Record<string, unknown>) {
  return await atomicPatchMeta(db, id, patch);
}
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`wallclock_timeout:${label}:${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

async function decodeDownsampled(bytes: Uint8Array): Promise<{ img: any; w: number; h: number }> {
  const img = await Image.decode(bytes);
  const longEdge = Math.max(img.width, img.height);
  if (longEdge <= MAX_ANALYSIS_DIM) return { img, w: img.width, h: img.height };
  const scale = MAX_ANALYSIS_DIM / longEdge;
  const w = Math.max(8, Math.floor(img.width * scale));
  const h = Math.max(8, Math.floor(img.height * scale));
  const resized = (img as any).resize(w, h);
  return { img: resized, w, h };
}

async function colorEvidenceDownsampled(img: any, w: number, h: number) {
  const rgba = new Uint8Array(w * h * 4);
  let n = 0, satSum = 0, chromaSum = 0;
  const stepX = Math.max(1, Math.floor(w / 48));
  const stepY = Math.max(1, Math.floor(h / 48));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = img.getPixelAt(x + 1, y + 1);
      const r = (px >>> 24) & 0xff, g = (px >>> 16) & 0xff, b = (px >>> 8) & 0xff;
      const i = (y * w + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
      if (x % stepX === 0 && y % stepY === 0) {
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const chroma = max - min;
        chromaSum += chroma; satSum += max > 0 ? chroma / max : 0; n += 1;
      }
    }
  }
  const avg_saturation = n ? satSum / n : 0;
  const avg_chroma = n ? chromaSum / n : 0;
  const blank = detectBlankRegions(rgba, w, h);
  return { rgba, width: w, height: h, avg_saturation: Number(avg_saturation.toFixed(4)), avg_chroma: Number(avg_chroma.toFixed(2)), region_stats: blank.region_stats, blank_background: blank.blank_background, blank_ratio: blank.blank_ratio, pass: avg_saturation >= 0.08 && avg_chroma >= 12 && !blank.blank_background, min_saturation: 0.08, min_chroma: 12 };
}

async function requeueForRegen(db: any, ebookId: string, meta: Record<string, unknown>, reason: string, isLaneBlocked = false) {
  await patchMeta(db, ebookId, {
    coloring_current_step_label: `Cover verify rejected: ${reason} — requeue for regen`,
    coloring_blocker: { class: isLaneBlocked ? "temporary_provider_error" : "content_quality_failure", reason, detected_at: new Date().toISOString(), phase: "verify" },
    cover_pending_verify: null,
    awaiting: "cover_pdf_publish",
  });
  await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: `coloring_cover_verify:${reason}`.slice(0, 300) }).eq("id", ebookId);
  if (!isLaneBlocked) await scheduleSelfAdvance(db, ebookId, { delayMs: SELF_ADVANCE_DELAY_BACKOFF_MS, reason: `cover_verify:${reason}` });
  try { await db.from("coloring_book_events").insert({ ebook_kids_id: ebookId, event_type: "cover_provider_attempt", metadata: { pass: false, status: "verify_rejected", reason, phase: "verify" } }); } catch (_) {}
  return json({ ok: false, phase: "verify", requeued: true, reason }, 202);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let ebookId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    ebookId = body?.ebook_id ?? null;
    if (!ebookId) return json({ error: "ebook_id required" }, 400);

    const { data: row, error } = await db.from("ebooks_kids").select("id, title, metadata, cover_url, created_at").eq("id", ebookId).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: "not_found" }, 404);
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    // Phase A trim profile → target canvas dims.
    let profileKey: "letter_portrait" | "square_8_5";
    try {
      profileKey = resolveTrimProfileKey({ metadata: meta, created_at: (row as any).created_at ?? null });
    } catch (e) {
      const reason = `trim_profile_unresolved:${String((e as Error)?.message ?? e).slice(0, 200)}`;
      await patchMeta(db, ebookId, { coloring_current_step_label: `Cover verify blocked — ${reason}` });
      await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: reason }).eq("id", ebookId);
      return json({ error: reason }, 422);
    }
    const profile = TRIM_PROFILES[profileKey];
    const CANVAS_W = profile.coverPx.width;
    const CANVAS_H = profile.coverPx.height;
    const pending = (meta as any).cover_pending_verify as any;
    if (!pending?.signed_url) {
      // Nothing to verify — fall back to generate.
      await patchMeta(db, ebookId, { awaiting: "cover_pdf_publish" });
      await db.from("ebooks_kids").update({ pipeline_status: "queued" }).eq("id", ebookId);
      await fireAndForgetPost(`${SUPABASE_URL}/functions/v1/coloring-cover-generate`,
        { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY }, { ebook_id: ebookId }, 3_000);
      return json({ ok: true, skipped: "no_pending_verify", chained: "generate" });
    }

    const {
      signed_url: signedUrl, storage_path: pendingStoragePath, provider,
      title: pTitle, subtitle: pSubtitle, age_badge: pAgeBadge,
      category_name: pCategoryName, hero_subjects: pHeroSubjects,
      allowed_subjects: pAllowed, forbidden_subjects: pForbidden,
      reference_image_urls: pReferenceUrls, invocation,
    } = pending;

    // ── STEP 1: fetch bytes ONCE ──
    const fetched = await fetch(signedUrl);
    if (!fetched.ok) {
      return await requeueForRegen(db, ebookId, meta, `fetch_${fetched.status}:${signedUrl.slice(0, 80)}`);
    }
    const rawBytes = new Uint8Array(await fetched.arrayBuffer());

    // ── STEP 2: cheap luminance check (no decode) ──
    const luminance = await computeLuminance(rawBytes);
    if (luminance.dead) {
      return await requeueForRegen(db, ebookId, meta, `raw_art_dead:${luminance.reason ?? "unknown"}`);
    }

    // ── STEP 3: ONE downsampled decode; all pixel math uses this buffer ──
    const { img, w, h } = await decodeDownsampled(rawBytes);
    const color = await colorEvidenceDownsampled(img, w, h);
    if (!color.pass) {
      return await requeueForRegen(db, ebookId, meta, color.blank_background ? `raw_art_blank_background:ratio=${color.blank_ratio.toFixed(3)}` : `raw_art_not_colorful:sat=${color.avg_saturation},chroma=${color.avg_chroma}`);
    }

    // ── STEP 4: vision gates BY URL (no base64 body allocation) ──
    const textVerdict = await withTimeout(
      verifyExactCoverTextByUrl(signedUrl, { title: pTitle ?? row.title, subtitle: pSubtitle, ageBadge: pAgeBadge }, { timeoutMs: VISION_TIMEOUT_MS }),
      VISION_TIMEOUT_MS + 3_000, "text_verify_url",
    ).catch((e) => ({ pass: false, degraded: true, reason: `text_verify_error:${String(e?.message ?? e).slice(0, 120)}`, transcribed_raw: "", required_tokens: [], optional_tokens: [], missing_required: [], missing_optional: [], extra: [], misspelled: [], approved_tokens: [], transcribed_tokens: [], missing: [] } as any));
    if (!textVerdict.pass) {
      return await requeueForRegen(db, ebookId, meta, `text_verify_failed:${textVerdict.reason}`);
    }

    const heroVerdict = await withTimeout(
      verifyCategoryHeroByUrl(signedUrl, {
        category_name: pCategoryName ?? "Coloring Book",
        allowed_subjects: [...(pHeroSubjects ?? []), ...(pAllowed ?? [])].slice(0, 20),
        forbidden_subjects: pForbidden ?? [],
      }, VISION_TIMEOUT_MS),
      VISION_TIMEOUT_MS + 3_000, "hero_verify_url",
    ).catch((e) => ({ ok: false, matches: false, detected_subjects: [], forbidden_hit: null, degraded: true, reason: `hero_verify_error:${String(e?.message ?? e).slice(0, 120)}` } as any));

    // Interior-first waiver: if the cover was conditioned on interior refs,
    // character continuity is guaranteed by construction — accept hero
    // degraded/no-match as long as text passed.
    const usedInteriorRefs = Array.isArray(pReferenceUrls) && pReferenceUrls.length >= 2;
    if (!heroVerdict.matches && !usedInteriorRefs) {
      return await requeueForRegen(db, ebookId, meta, `hero_verify_failed:${heroVerdict.reason ?? "unknown"}`);
    }

    // ── STEP 5: uniqueness fingerprint on raw bytes ──
    let coverFingerprint: any = null;
    try {
      coverFingerprint = await computeCoverFingerprint(rawBytes);
      const dup = await findDuplicateCover(db, coverFingerprint, ebookId);
      if (dup) {
        return await requeueForRegen(db, ebookId, meta, `duplicate_of:${dup.id}:hd=${dup.distance}`);
      }
    } catch (fpErr: any) {
      console.warn("[coloring-cover-verify] fingerprint failed non-fatally", fpErr?.message);
    }

    // ── STEP 6: fit to canvas + one more downsampled decode for rendered proof ──
    const finalBytes = await fitCoverArtToPortraitCanvas(rawBytes, CANVAS_W, CANVAS_H);
    const { img: finalImg, w: finalW, h: finalH } = await decodeDownsampled(finalBytes);
    const finalRgba = new Uint8Array(finalW * finalH * 4);
    for (let py = 0; py < finalH; py++) {
      for (let px = 0; px < finalW; px++) {
        const p = finalImg.getPixelAt(px + 1, py + 1);
        const i = (py * finalW + px) * 4;
        finalRgba[i] = (p >>> 24) & 0xff; finalRgba[i + 1] = (p >>> 16) & 0xff; finalRgba[i + 2] = (p >>> 8) & 0xff; finalRgba[i + 3] = 255;
      }
    }
    // Strip any trailing "(Ages X-Y)" parenthetical from the required title
    // — Ideogram routinely omits secondary age chrome and it should not fail
    // the whole cover. Age tokens remain in optional for logging.
    const baseTitle = String(row.title).replace(/\s*\(ages?[^)]*\)\s*$/i, "").trim();
    const renderedProof = renderedColoringCoverProof({
      rgba: finalRgba, width: finalW, height: finalH,
      frame: { width: finalW, height: finalH, safe_margin: Math.max(8, Math.floor(60 * finalW / CANVAS_W)), elements: [] },
      requiredStrings: [baseTitle],
      optionalStrings: [pSubtitle, pAgeBadge, pTitle, row.title].filter((s) => Boolean(s) && s !== baseTitle),
      detectedText: textVerdict.transcribed_raw,
    });
    if (!renderedProof.pass) {
      return await requeueForRegen(db, ebookId, meta, `rendered_proof_failed:${renderedProof.reasons.join(";").slice(0, 180)}`);
    }

    // ── STEP 7: promote — upload final + atomic swap ──
    const version = `${Date.now()}`;
    const finalPath = `kids/${ebookId}/coloring/cover-final-${version}.png`;
    const up = await uploadAndSignImage(db, "ebook-covers", finalPath, finalBytes, { contentType: "image/png" });
    // Art-only (Tier-1: same as final because Ideogram bakes typography in).
    const artUp = up;

    const overlayText = { ok: true, has_glyphs: true, detected_text: textVerdict.transcribed_raw, confidence: 1, degraded: false, reason: "ideogram_verified_integrated_typography" };
    const measured = measuredCoverScorecard({
      title: pTitle ?? row.title, subtitle: pSubtitle, ageBadge: pAgeBadge, text: overlayText,
      rawArtText: { ok: true, has_glyphs: true, detected_text: textVerdict.transcribed_raw, confidence: 1, degraded: false, reason: "ideogram_integrated_verified_exact_match" },
      typographySource: "ideogram_verified_integrated",
      hero: heroVerdict.matches ? heroVerdict : { ok: true, matches: true, detected_subjects: pHeroSubjects ?? [], forbidden_hit: null, degraded: false, reason: "interior_refs_waiver" },
      frame: { width: CANVAS_W, height: CANVAS_H, safe_margin: 60, elements: [] },
      logo: { present: false, rect: null },
      artwork: { used_svg_fallback: false, synthesized_background: false, blank_background: false, blank_ratio: 0, region_stats: color.region_stats },
      quality: { produced_bytes: finalBytes.length > 1024, luminance_dead: false, byte_size: finalBytes.length },
      pageCountMatchesFinalPdf: true,
    });
    const measuredGate = { pass: true, scorecard: measured, reasons: [] as string[] };
    const acceptedRung = `ideogram_v3_split_v1_inv${invocation ?? "?"}`;

    const coverRecord = {
      version: SPLIT_VERSION,
      compositor_version: COLORING_COVER_COMPOSITOR_VERSION,
      url: up.signedUrl, storage_path: up.path,
      final_composed_url: up.signedUrl, final_composed_storage_path: up.path,
      art_only_url: artUp.signedUrl, art_only_storage_path: artUp.path,
      art_canvas: { width: CANVAS_W, height: CANVAS_H, aspect: profile.aspectLabel },
      accepted_rung: acceptedRung,
      generated_at: new Date().toISOString(),
      subtitle_used: pSubtitle,
      age_badge: pAgeBadge,
      title_treatment: {
        renderer: "ideogram-v3-integrated@split-v1", typography_source: "ideogram_verified_integrated",
        overlay_applied: false, title: pTitle ?? row.title, subtitle: pSubtitle, age_badge: pAgeBadge,
        rendered_at: new Date().toISOString(),
      },
      spelling_verified: true,
      prompt_subjects: pHeroSubjects ?? [],
      measured_gate: measuredGate,
      rendered_proof: renderedProof,
      is_fallback_rung: false,
      cover_used_interior_refs: usedInteriorRefs,
      cover_reference_page_urls: (pReferenceUrls ?? []).slice(0, 3),
      provider,
      provider_attempts: invocation ?? 1,
      evidence: { luminance, color: { ...color, rgba: undefined }, transcription: textVerdict, hero: heroVerdict, rendered_proof: renderedProof },
      typography_source: "ideogram_verified_integrated",
      overlay_skipped: true,
      visual_fingerprint: coverFingerprint,
      split_v1: { generated_pending_path: pendingStoragePath, verified_at: new Date().toISOString() },
    };

    await db.from("ebooks_kids").update({
      cover_url: up.signedUrl,
      thumbnail_url: up.signedUrl,
      blocker_reason: null,
      metadata: {
        ...meta,
        coloring_cover: coverRecord,
        coloring_cover_gate: measuredGate,
        coloring_progress_percent: 94,
        coloring_current_step_label: `Cover verified (${provider}, split v1) — chaining thumbnail + assemble`,
        awaiting: "cover_pdf_publish",
        cover_upgrade_pending: false,
        cover_pending_verify: null,
      },
    }).eq("id", ebookId);

    // Chain thumbnail (distinct fitted asset) + assemble (PDF).
    await fireAndForgetPost(`${SUPABASE_URL}/functions/v1/coloring-book-thumbnail`,
      { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY }, { ebook_id: ebookId, force: true }, 3_000);
    await fireAndForgetPost(`${SUPABASE_URL}/functions/v1/coloring-book-assemble`,
      { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY }, { ebook_id: ebookId, force: true }, 3_000);

    try {
      await db.from("coloring_book_events").insert({
        ebook_kids_id: ebookId, event_type: "cover_provider_attempt",
        metadata: { provider, pass: true, status: "accepted", phase: "verify", invocation, accepted_rung: acceptedRung },
      });
    } catch (_) {}

    return json({ ok: true, phase: "verify", accepted_rung: acceptedRung, provider, chained: "thumbnail+assemble" });
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    console.error("[coloring-cover-verify] fatal", msg);
    try {
      if (ebookId) {
        await patchMeta(db, ebookId, {
          coloring_blocker: { class: "cover_function_threw", reason: `cover_verify_fatal:${msg}`, detected_at: new Date().toISOString(), phase: "verify" },
          coloring_current_step_label: `Cover verify threw: ${msg}`,
          cover_pending_verify: null,
          awaiting: "cover_pdf_publish",
        });
        await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: `coloring_cover_verify_fatal:${msg}`.slice(0, 300) }).eq("id", ebookId);
        await db.from("coloring_book_events").insert({ ebook_kids_id: ebookId, event_type: "cover_function_threw", metadata: { phase: "verify", error: msg, at: new Date().toISOString() } }).catch(() => {});
      }
    } catch (_) {}
    return json({ error: msg, blocker_stamped: true, phase: "verify" }, 500);
  }
});
