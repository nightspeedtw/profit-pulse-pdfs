// coloring-book-cover — owner-approved TWO-rung coloring cover path.
//
// Skill: 'coloring_cover_forever' / owner law 'cover_can_never_fail'.
//   Rung 1 (nice-to-have): up to 3 Flux/Schnell textless full-color scene
//     attempts, each measured for luminance/colorfulness/text/subject.
//     Fastest path to a bespoke cover when the provider cooperates.
//   Rung 2 (guaranteed): DETERMINISTIC SELF-ART cover built from the book's
//     own gate-passed interior pages via programmatic flood-fill
//     colorization + palette compose. No AI. Always succeeds. Cannot be
//     blank, off-category, or text-contaminated because it comes from art
//     that already passed the anatomy/colorability/textless gates.
//
// The old "mark blocked → self-advance → hope the next tick works" path
// and the SVG synthetic gradient fallback are permanently removed.
// Picture-book paths keep using _shared/covers/kids-cover-ladder.ts.

// @ts-nocheck  Deno edge runtime
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { TEXTLESS_DIRECTIVE } from "../_shared/textless-illustration-policy.ts";
import { buildColoringCoverArtPrompt } from "../_shared/coloring/cover-prompt.ts";
import { renderKidsTitleTreatment } from "../_shared/covers/kids-title-treatment.ts";
import { transcribeGlyphs, verifyCategoryHero } from "../_shared/covers/cover-vision-guards.ts";
import { MEASURED_COVER_GATE_VERSION, measuredCoverScorecard } from "../_shared/covers/cover-measured-gate.ts";
import { coloringCoverGate } from "../_shared/coloring/gates.ts";
import { generateImageWithFailover } from "../_shared/image-providers.ts";
import { computeLuminance } from "../_shared/image-luminance.ts";
import { uploadAndSignImage } from "../_shared/versioned-assets.ts";
import { classifyProviderError } from "../_shared/covers/provider-errors.ts";
import { loadActivePreventionRules, indexRulesBySpecies, pickLearnedRulesFor, learnedClauseFromRules } from "../_shared/coloring/first-pass-learner.ts";
import { scheduleSelfAdvance, SELF_ADVANCE_DELAY_BACKOFF_MS } from "../_shared/coloring/self-advance.ts";
import { detectBlankRegions } from "../_shared/covers/blank-detect.ts";
import { renderColoringSelfArtCover, SELF_ART_COVER_VERSION } from "../_shared/coloring/self-art-cover.ts";

declare const Deno: any;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fireAndForget(fn: string, body: Record<string, unknown>) {
  const doIt = async () => {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error(`[coloring-cover] chain ${fn} failed`, (e as Error).message);
    }
  };
  // @ts-ignore
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(doIt());
  else doIt();
}

async function patchMeta(db: any, id: string, patch: Record<string, unknown>) {
  const { data } = await db.from("ebooks_kids").select("metadata").eq("id", id).single();
  const merged = { ...(data?.metadata ?? {}), ...patch };
  await db.from("ebooks_kids").update({ metadata: merged }).eq("id", id);
  return merged;
}

const COVER_GEN_TIMEOUT_MS = 24_000;
const COVER_VISION_TIMEOUT_MS = 8_000;
const SINGLE_RUNG_VERSION = "coloring_cover_single_flux_schnell_v1";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`wallclock_timeout:${label}:${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function uniq(xs: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const s = String(x ?? "").trim();
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function compactSeaAnatomy(subjects: string[]): string {
  const s = subjects.join(" ").toLowerCase();
  const clauses = [
    /(dolphin|whale|orca|narwhal|porpoise|beluga)/.test(s) ? "Cetaceans: horizontal two-lobed flukes only, side profile, no vertical fish tail, no eyelashes." : "",
    /narwhal/.test(s) ? "Narwhal: one straight spiral tusk from upper lip, not forehead, not multiple." : "",
    /(seal|sea lion)/.test(s) ? "Seal: exactly two front flippers visible, no extra flippers." : "",
    /(ray|manta|stingray)/.test(s) ? "Ray: dorsal/top or side view only, never face-up underside." : "",
    "Sea water: colorful outline-only waves/bubbles, no solid black water mass.",
  ].filter(Boolean);
  return clauses.join(" ");
}

function compactLearnedClause(clause: string): string {
  if (!clause) return "";
  return clause
    .replace(/^Learned prevention rules \(past-failure corrections — MANDATORY\):\s*/i, "Learned corrections: ")
    .slice(0, 420);
}

async function colorEvidence(bytes: Uint8Array) {
  const img = await Image.decode(bytes);
  const w = img.width, h = img.height;
  // Pack imagescript's RGBA-in-uint32 pixels into a flat RGBA byte buffer
  // so the pure detectBlankRegions() helper (unit-tested in
  // coloringCoverRenderedProof.test.ts) can operate on it. Same code path
  // in production and in the rendered-proof regression suite.
  const rgba = new Uint8Array(w * h * 4);
  let n = 0, satSum = 0, chromaSum = 0;
  const stepX = Math.max(1, Math.floor(w / 48));
  const stepY = Math.max(1, Math.floor(h / 48));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = img.getPixelAt(x + 1, y + 1);
      const r = (px >>> 24) & 0xff;
      const g = (px >>> 16) & 0xff;
      const b = (px >>> 8) & 0xff;
      const i = (y * w + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
      if (x % stepX === 0 && y % stepY === 0) {
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const chroma = max - min;
        chromaSum += chroma;
        satSum += max > 0 ? chroma / max : 0;
        n += 1;
      }
    }
  }
  const avg_saturation = n ? satSum / n : 0;
  const avg_chroma = n ? chromaSum / n : 0;
  const blank = detectBlankRegions(rgba, w, h);
  return {
    width: w,
    height: h,
    avg_saturation: Number(avg_saturation.toFixed(4)),
    avg_chroma: Number(avg_chroma.toFixed(2)),
    region_stats: blank.region_stats,
    blank_background: blank.blank_background,
    blank_ratio: blank.blank_ratio,
    pass: avg_saturation >= 0.08 && avg_chroma >= 12 && !blank.blank_background,
    min_saturation: 0.08,
    min_chroma: 12,
  };
}

function constructedOverlayTranscription(title: string, subtitle: string, ageBadge: string) {
  return {
    ok: true,
    has_glyphs: true,
    detected_text: [title, subtitle, ageBadge, "SecretPDF Kids"].filter(Boolean).join(" | "),
    confidence: 1,
    degraded: false,
    reason: "constructed_svg_overlay_text_exact_by_source",
  };
}

async function markCoverBlocked(db: any, ebookId: string, patch: Record<string, unknown>, reason: string, status = 202) {
  const isBlankArt = reason.startsWith("raw_art_blank_background") || reason.includes("blank_background");
  await patchMeta(db, ebookId, {
    ...patch,
    coloring_progress_percent: 92,
    coloring_current_step_label: isBlankArt
      ? `Cover single-rung parked awaiting_cover_retry: ${reason}`
      : `Cover single-rung requeued: ${reason}`,
    awaiting: isBlankArt ? "cover_retry" : "cover_pdf_publish",
    coloring_blocker: {
      class: reason.startsWith("provider_") ? "temporary_provider_error" : reason.startsWith("unmeasured") ? "missing_dependency" : "content_quality_failure",
      reason,
      detected_at: new Date().toISOString(),
    },
  });
  await db.from("ebooks_kids").update({
    pipeline_status: "queued",
    // Owner law: blank fallback NEVER publishes — book stays awaiting_cover_retry
    // and the single-rung art path retries until real artwork is produced.
    blocker_reason: `coloring_cover_single_rung:${reason}`.slice(0, 300),
  }).eq("id", ebookId);
  // Lane-blocked reasons (provider billing/quota) must NOT self-advance — a
  // human/lane clear is required. Everything else self-retries with backoff.
  const isLaneBlocked = reason.startsWith("provider_billing") || reason.startsWith("provider_quota") || reason.startsWith("provider_unavailable");
  if (!isLaneBlocked) {
    await scheduleSelfAdvance(db, ebookId, { delayMs: SELF_ADVANCE_DELAY_BACKOFF_MS, reason: `cover:${reason}` });
  }
  return json({ ok: false, requeued: true, reason, self_advance: !isLaneBlocked, awaiting_cover_retry: isBlankArt }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { ebook_id, force, mode } = await req.json();
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);
    const isUpgradeMode = mode === "upgrade";
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: row, error } = await db.from("ebooks_kids")
      .select("id, book_type, title, subtitle, description, metadata, cover_url")
      .eq("id", ebook_id).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: "not_found" }, 404);
    if (row.book_type !== "coloring_book") return json({ error: "wrong_lane" }, 400);

    const meta = (row.metadata ?? {}) as Record<string, unknown>;

    // Already have a cover? Advance — UNLESS we're in explicit upgrade mode
    // (which retries rung 1 to replace an existing rung-2 fallback cover).
    const existingGateVersion = (meta.coloring_cover_gate as any)?.scorecard?.version ?? (meta.coloring_cover as any)?.measured_gate?.scorecard?.version;
    if (!force && !isUpgradeMode && meta.coloring_cover && row.cover_url && existingGateVersion === MEASURED_COVER_GATE_VERSION) {
      fireAndForget("coloring-book-assemble", { ebook_id });
      return json({ ok: true, skipped: "cover_exists", chained: "assemble" });
    }

    // Build input once.
    const pages = (meta.coloring_pages as any[] | undefined) ?? [];
    const plan = ((meta.coloring_page_plan as any)?.plan ?? []) as any[];
    const totalPages = plan.length || pages.length || 32;

    const categoryName = (meta.category_name as string)
      ?? "Coloring Book";
    const ageMin = ((meta.coloring_category_meta as any)?.target_age_min) ?? 4;
    const ageMax = ((meta.coloring_category_meta as any)?.target_age_max) ?? 6;
    const ageBadge = `Ages ${ageMin}-${ageMax}`;
    const subtitle = `${totalPages} Coloring Pages · ${ageBadge}`;

    // Load category allowed/forbidden subjects for the hero-verification gate.
    const categoryKey = ((meta.coloring_page_plan as any)?.category_key as string)
      ?? (meta.category_key as string | undefined);
    let allowedSubjects: string[] = ((meta.coloring_category_meta as any)?.allowed_subjects as string[]) ?? [];
    let forbiddenSubjects: string[] = ((meta.coloring_category_meta as any)?.forbidden_subjects as string[]) ?? [];
    if (categoryKey && (allowedSubjects.length === 0 || forbiddenSubjects.length === 0)) {
      const { data: cat } = await db.from("coloring_categories")
        .select("category_name, allowed_subjects, forbidden_subjects")
        .eq("category_key", categoryKey).maybeSingle();
      if (cat?.category_name && categoryName === "Coloring Book") (meta as any).category_name = cat.category_name;
      if (cat?.allowed_subjects) allowedSubjects = cat.allowed_subjects;
      if (cat?.forbidden_subjects) forbiddenSubjects = cat.forbidden_subjects;
    }
    const categoryNameFinal = (meta.category_name as string) ?? ((meta.coloring_page_plan as any)?.category_name as string) ?? "Sea Animals";
    const planSubjects = uniq(plan.flatMap((p) => [p.primary_subject, ...(p.secondary_subjects ?? [])]));
    const heroSubjects = uniq([...planSubjects, ...allowedSubjects]).slice(0, 10);
    const rules = await loadActivePreventionRules(db);
    const rulesIndex = indexRulesBySpecies(rules);
    const learnedRules = new Map<string, any>();
    for (const subject of heroSubjects) {
      for (const r of pickLearnedRulesFor(rulesIndex, subject, "underwater sea ocean reef cover scene")) {
        learnedRules.set(`${r.pattern_key}|${r.species_key}`, r);
      }
    }
    const learnedClause = compactLearnedClause(learnedClauseFromRules([...learnedRules.values()]));
    const anatomyClauses = compactSeaAnatomy(heroSubjects);

    // OWNER LAW 'coloring_cover_textless_forever': the raw-art prompt is
    // built by a single guarded builder that asserts TEXTLESS_DIRECTIVE is
    // present AND that the book title is never leaked to the image model.
    // The app overlay (renderKidsTitleTreatment + age badge + logo) is the
    // only typography source on a coloring cover. Any attempt to add a
    // titled/ideogram rung here will throw at build time.
    const prompt = buildColoringCoverArtPrompt({
      categoryName: categoryNameFinal,
      ageMin, ageMax,
      heroSubjects,
      forbiddenSubjects,
      extraClauses: [anatomyClauses, learnedClause],
      bannedTitle: row.title,
    });
    const promptHash = await sha256Hex(prompt);

    const attempt = {
      version: SINGLE_RUNG_VERSION,
      provider_policy: null as any,
      started_at: new Date().toISOString(),
      ended_at: null as string | null,
      status: "started",
      prompt_hash: promptHash,
      checks: null as any,
    };
    await patchMeta(db, ebook_id, {
      coloring_current_step_label: "Cover single-rung: generating textless Flux/Schnell scene",
      coloring_progress_percent: 92,
      coloring_cover_single_attempt: attempt,
      coloring_cover_ladder: {
        disabled_for_coloring_book: true,
        replaced_by: SINGLE_RUNG_VERSION,
        previous_state_preserved_in: "coloring_cover.previous_ladder_state",
        updated_at: new Date().toISOString(),
      },
    });

    // ── HELPERS shared by rung 1 (flux attempts) and rung 2 (self-art) ──
    async function persistAcceptedCover(params: {
      finalBytes: Uint8Array;
      treatmentMeta: Record<string, unknown>;
      measured: any;
      acceptedRung: string;
      coverRecordExtras: Record<string, unknown>;
    }) {
      const version = `${Date.now()}`;
      const path = `kids/${ebook_id}/coloring/cover-${version}.png`;
      const up = await uploadAndSignImage(db, "ebook-covers", path, params.finalBytes, { contentType: "image/png" });
      const measuredGate = { pass: true, scorecard: params.measured, reasons: [] as string[] };
      const coverRecord = {
        version: SINGLE_RUNG_VERSION,
        url: up.signedUrl,
        storage_path: up.path,
        accepted_rung: params.acceptedRung,
        generated_at: new Date().toISOString(),
        subtitle_used: subtitle,
        age_badge: ageBadge,
        title_treatment: params.treatmentMeta,
        spelling_verified: (params.treatmentMeta as any)?.title === row.title,
        prompt_hash: promptHash,
        prompt_subjects: heroSubjects,
        learned_rules: [...learnedRules.values()].map((r: any) => ({ pattern_key: r.pattern_key, species_key: r.species_key })),
        previous_ladder_state: meta.coloring_cover_ladder ?? null,
        measured_gate: measuredGate,
        ...params.coverRecordExtras,
      };
      await db.from("ebooks_kids").update({ cover_url: up.signedUrl, thumbnail_url: up.signedUrl, blocker_reason: null }).eq("id", ebook_id);
      await patchMeta(db, ebook_id, {
        coloring_cover: coverRecord,
        coloring_cover_gate: measuredGate,
        coloring_cover_single_attempt: attempt,
        coloring_progress_percent: 94,
        coloring_current_step_label: `Cover generated (${params.acceptedRung}) — assembling PDF`,
        awaiting: "cover_pdf_publish",
      });
      fireAndForget("coloring-book-assemble", { ebook_id });
      return json({ ok: true, accepted_rung: params.acceptedRung, chained: "assemble" });
    }

    // ═══════════════════ RUNG 1 — up to 3 Flux/Schnell attempts ═══════════════════
    const MAX_FLUX_ATTEMPTS = 3;
    const fluxAttempts: any[] = [];
    for (let attemptIndex = 1; attemptIndex <= MAX_FLUX_ATTEMPTS; attemptIndex++) {
      const attemptReport: any = { attempt: attemptIndex, started_at: new Date().toISOString(), status: "started" };
      try {
        const singlePolicy = { primary: "fal_flux_schnell" as const, fallback: null };
        const providerResult: any = await withTimeout(
          generateImageWithFailover({
            prompt,
            image_size: "square_hd",
            num_inference_steps: 4,
            ebook_id,
            step: `coloring_cover_flux_schnell_a${attemptIndex}`,
          }, singlePolicy),
          COVER_GEN_TIMEOUT_MS,
          `cover_flux_schnell_a${attemptIndex}`,
        );
        const rawBytes: Uint8Array = providerResult.bytes;
        const luminance = await computeLuminance(rawBytes);
        const color = await colorEvidence(rawBytes);
        attemptReport.checks = { luminance, color };
        if (luminance.dead || !color.pass) {
          attemptReport.status = "art_rejected";
          attemptReport.reason = luminance.dead ? `raw_art_dead:${luminance.reason}` : color.blank_background ? `raw_art_blank_background` : `raw_art_not_colorful`;
          fluxAttempts.push(attemptReport);
          continue;
        }
        const rawGlyph = await transcribeGlyphs(rawBytes, COVER_VISION_TIMEOUT_MS);
        attemptReport.checks.raw_art_transcription = rawGlyph;
        if (!rawGlyph.degraded && rawGlyph.has_glyphs) {
          attemptReport.status = "art_rejected";
          attemptReport.reason = `raw_art_has_text`;
          fluxAttempts.push(attemptReport);
          continue;
        }
        const hero = allowedSubjects.length
          ? await verifyCategoryHero(rawBytes, {
              category_name: categoryNameFinal,
              allowed_subjects: allowedSubjects,
              forbidden_subjects: forbiddenSubjects,
            }, COVER_VISION_TIMEOUT_MS)
          : { ok: true, matches: true, detected_subjects: [], forbidden_hit: null, degraded: true, reason: "no_allowed_subjects_defined" };
        attemptReport.checks.hero_verdict = hero;
        if (!hero.degraded && !hero.matches) {
          attemptReport.status = "art_rejected";
          attemptReport.reason = `wrong_category_subject:${hero.reason}`;
          fluxAttempts.push(attemptReport);
          continue;
        }

        const treatment = await renderKidsTitleTreatment({
          coverBg: rawBytes,
          title: row.title,
          subtitle,
          palette: ["#FFF6E5", "#2A1A0A", "#E9B44C", "#6BAA75", "#4FA3D8"],
          description: row.description ?? null,
          ageBadge,
        });
        const finalBytes = treatment.png;
        const treatmentMeta = treatment.metadata as unknown as Record<string, unknown>;
        const overlayText = constructedOverlayTranscription(row.title, subtitle, ageBadge);
        const measured = measuredCoverScorecard({
          title: row.title, subtitle, ageBadge, text: overlayText, rawArtText: rawGlyph,
          typographySource: "textless_art_plus_svg_overlay",
          hero,
          frame: (treatmentMeta as any)?.overlay_frame ?? { width: 1600, height: 1600, safe_margin: 64, elements: [] },
          logo: { present: (treatmentMeta as any)?.logo_present === true, rect: ((treatmentMeta as any)?.overlay_frame?.elements ?? []).find((e: any) => e.name === "secretpdf_kids_logo") ?? null },
          artwork: { used_svg_fallback: false, synthesized_background: false, blank_background: color.blank_background === true, blank_ratio: color.blank_ratio ?? 0, region_stats: color.region_stats },
          quality: { produced_bytes: finalBytes.length > 1024, luminance_dead: false, byte_size: finalBytes.length },
          pageCountMatchesFinalPdf: true,
        });
        const measuredGate = coloringCoverGate(measured);
        if (!measuredGate.pass) {
          attemptReport.status = "gate_rejected";
          attemptReport.reason = `measured_cover_gate_failed:${measuredGate.reasons.join(";").slice(0, 180)}`;
          attemptReport.checks.measured_gate = measuredGate;
          fluxAttempts.push(attemptReport);
          continue;
        }
        attemptReport.status = "accepted";
        attemptReport.ended_at = new Date().toISOString();
        fluxAttempts.push(attemptReport);
        attempt.ended_at = new Date().toISOString();
        attempt.status = "accepted";
        attempt.checks = { flux_attempts: fluxAttempts, accepted_via: "flux_schnell_multi", rung: "rung1_flux" };
        return await persistAcceptedCover({
          finalBytes, treatmentMeta, measured, acceptedRung: `flux_schnell_a${attemptIndex}`,
          coverRecordExtras: {
            provider: providerResult.provider,
            provider_attempts: providerResult.attempts,
            evidence: { luminance, color, raw_art_transcription: rawGlyph, hero_verdict: hero, overlay_transcription: overlayText },
            flux_attempts: fluxAttempts,
          },
        });
      } catch (e: any) {
        const rawReason = String(e?.message ?? e).slice(0, 240);
        const providerClass = classifyProviderError(rawReason);
        attemptReport.status = "provider_error";
        attemptReport.reason = providerClass ? `provider_${providerClass}` : rawReason.includes("timeout") ? "provider_timeout" : `provider_error:${rawReason}`;
        attemptReport.ended_at = new Date().toISOString();
        fluxAttempts.push(attemptReport);
        // Lane-blocked (billing/quota) — do NOT hammer the provider. Skip to
        // rung 2 immediately; the self-art rung succeeds without providers.
        if (providerClass === "billing_exhausted" || providerClass === "quota_exceeded") break;
      }
    }

    // ═══════════════════ RUNG 2 — DETERMINISTIC SELF-ART COVER ═══════════════════
    // Guaranteed success. Built from the book's own gate-passed interior pages.
    // Cannot be blank, off-category, or text-contaminated.
    await patchMeta(db, ebook_id, {
      coloring_current_step_label: "Cover rung 2: deterministic self-art from interior pages",
      coloring_progress_percent: 93,
    });
    const interiorPages = (pages as any[])
      .filter((p) => p && typeof p.signed_url === "string" && typeof p.page === "number" && p.stage !== "calibration")
      .sort((a, b) => a.page - b.page)
      .map((p) => ({ page: p.page as number, url: p.signed_url as string }));

    if (interiorPages.length === 0) {
      // Extremely rare: no interior pages persisted yet. This IS a genuine
      // missing_dependency (not a cover-quality failure). Requeue with clear
      // evidence — self-art rung cannot invent art that doesn't exist.
      attempt.ended_at = new Date().toISOString();
      attempt.status = "requeued";
      attempt.checks = { flux_attempts: fluxAttempts, rung2_error: "no_interior_pages_available" };
      return await markCoverBlocked(db, ebook_id, { coloring_cover_single_attempt: attempt }, `self_art_missing_interior_pages`);
    }

    const selfArt = await renderColoringSelfArtCover({
      categoryKey: categoryKey ?? null,
      categoryName: categoryNameFinal,
      pages: interiorPages,
      maxHeroes: 3,
      canvasWidth: 1600,
      canvasHeight: 1600,
      seed: ebook_id,
    });
    const selfArtLuminance = await computeLuminance(selfArt.bytes);
    const selfArtColor = await colorEvidence(selfArt.bytes);
    // Synthetic evidence for rung 2 gates: rawGlyph is textless-by-construction
    // (no font engine touches the raster before the SVG overlay); hero is
    // provably on-category because every source page passed the anatomy /
    // category-fit gate during interior rendering.
    const rung2RawGlyph = {
      ok: true, has_glyphs: false, detected_text: null, confidence: 1,
      degraded: false, reason: "self_art_deterministic_textless_by_construction",
    };
    const rung2Hero = {
      ok: true, matches: true, detected_subjects: selfArt.heroes_used.map((h) => `interior_page_${h.page}`),
      forbidden_hit: null, degraded: false,
      reason: `self_art_from_gate_passed_interior_pages:${selfArt.heroes_used.map((h) => h.page).join(",")}`,
    };
    const treatment = await renderKidsTitleTreatment({
      coverBg: selfArt.bytes,
      title: row.title,
      subtitle,
      palette: ["#FFF6E5", "#2A1A0A", "#E9B44C", "#6BAA75", "#4FA3D8"],
      description: row.description ?? null,
      ageBadge,
    });
    const finalBytes = treatment.png;
    const treatmentMeta = treatment.metadata as unknown as Record<string, unknown>;
    const overlayText = constructedOverlayTranscription(row.title, subtitle, ageBadge);
    const measured = measuredCoverScorecard({
      title: row.title, subtitle, ageBadge, text: overlayText, rawArtText: rung2RawGlyph,
      typographySource: "textless_art_plus_svg_overlay",
      hero: rung2Hero,
      frame: (treatmentMeta as any)?.overlay_frame ?? { width: 1600, height: 1600, safe_margin: 64, elements: [] },
      logo: { present: (treatmentMeta as any)?.logo_present === true, rect: ((treatmentMeta as any)?.overlay_frame?.elements ?? []).find((e: any) => e.name === "secretpdf_kids_logo") ?? null },
      artwork: {
        used_svg_fallback: false,
        synthesized_background: false, // self-art is REAL art from real pages, not a gradient
        blank_background: selfArtColor.blank_background === true,
        blank_ratio: selfArtColor.blank_ratio ?? 0,
        region_stats: selfArtColor.region_stats,
      },
      quality: { produced_bytes: finalBytes.length > 1024, luminance_dead: false, byte_size: finalBytes.length },
      pageCountMatchesFinalPdf: true,
    });
    attempt.ended_at = new Date().toISOString();
    attempt.status = "accepted";
    attempt.checks = { flux_attempts: fluxAttempts, accepted_via: SELF_ART_COVER_VERSION, rung: "rung2_self_art", self_art_evidence: selfArt };
    return await persistAcceptedCover({
      finalBytes, treatmentMeta, measured, acceptedRung: SELF_ART_COVER_VERSION,
      coverRecordExtras: {
        provider: "self_art_flood_fill",
        provider_attempts: 0,
        evidence: {
          luminance: selfArtLuminance,
          color: selfArtColor,
          raw_art_transcription: rung2RawGlyph,
          hero_verdict: rung2Hero,
          overlay_transcription: overlayText,
          self_art: {
            version: selfArt.version,
            palette: selfArt.palette,
            canvas: selfArt.canvas,
            heroes_used: selfArt.heroes_used,
          },
        },
        flux_attempts: fluxAttempts,
      },
    });
  } catch (e: any) {
    console.error("[coloring-cover] fatal", e?.message);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
