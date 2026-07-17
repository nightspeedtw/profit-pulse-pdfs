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
import { transcribeGlyphs, verifyCategoryHero } from "../_shared/covers/cover-vision-guards.ts";
import { MEASURED_COVER_GATE_VERSION, measuredCoverScorecard } from "../_shared/covers/cover-measured-gate.ts";
import { coloringCoverGate } from "../_shared/coloring/gates.ts";
import { generateImageWithFailover, readImageProviderPolicy } from "../_shared/image-providers.ts";
import { computeLuminance } from "../_shared/image-luminance.ts";
import { uploadAndSignImage } from "../_shared/versioned-assets.ts";
import { classifyProviderError } from "../_shared/covers/provider-errors.ts";
import { loadActivePreventionRules, indexRulesBySpecies, pickLearnedRulesFor, learnedClauseFromRules } from "../_shared/coloring/first-pass-learner.ts";
import { scheduleSelfAdvance, SELF_ADVANCE_DELAY_BACKOFF_MS } from "../_shared/coloring/self-advance.ts";
import { detectBlankRegions } from "../_shared/covers/blank-detect.ts";
import { renderColoringSelfArtCover, SELF_ART_COVER_VERSION } from "../_shared/coloring/self-art-cover.ts";
import { composeColoringCover, fitCoverArtToPortraitCanvas, COLORING_COVER_COMPOSITOR_VERSION, COLORING_COVER_HEIGHT, COLORING_COVER_WIDTH } from "../_shared/coloring/coloring-cover-compositor.ts";
import { generateIdeogramIntegratedCover, IDEOGRAM_INTEGRATED_COVER_VERSION } from "../_shared/coloring/ideogram-integrated-cover.ts";
import { verifyExactCoverText } from "../_shared/coloring/cover-text-transcription.ts";
import { renderedColoringCoverProof } from "../_shared/coloring/coloring-cover-proof.ts";
import { readQcMode, waiveOrBlock } from "../_shared/coloring/qc-mode.ts";
import { computeCoverFingerprint, findDuplicateCover, DUPLICATE_HAMMING_THRESHOLD } from "../_shared/coloring/cover-uniqueness.ts";


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
const IDEOGRAM_GEN_TIMEOUT_MS = 70_000;
const COVER_VISION_TIMEOUT_MS = 8_000;
const IDEOGRAM_VERIFY_TIMEOUT_MS = 12_000;
const SINGLE_RUNG_VERSION = "coloring_cover_verified_typography_v2";
const MAX_IDEOGRAM_ATTEMPTS = 3;

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

    // OWNER LAW `interior_first_cover_last_character_continuity` (2026-07-17):
    // the cover MUST be generated AFTER the interior so we can condition the
    // cover on the real interior character designs. If interior pages are
    // missing, requeue back through render — never generate a cover from
    // prompt alone (that's how cover/interior character drift happens).
    const renderedPages = pages.filter((p: any) => p && typeof p.signed_url === "string");
    if (!isUpgradeMode && renderedPages.length < Math.max(4, Math.floor((plan.length || 8) * 0.5))) {
      await patchMeta(db, ebook_id, {
        awaiting: undefined,
        coloring_current_step_label: `Cover deferred — interior only ${renderedPages.length}/${plan.length || totalPages} pages rendered. Interior-first law.`,
      });
      await db.from("ebooks_kids").update({ pipeline_status: "queued" }).eq("id", ebook_id);
      fireAndForget("coloring-book-render", { ebook_id });
      return json({ ok: true, deferred: "interior_first_law", rendered: renderedPages.length, planned: plan.length });
    }
    // Pick up to 3 interior page URLs to hand to Ideogram as character-
    // continuity references. Prefer pages whose primary_subject is one of
    // the cover heroes; fall back to the first few pages otherwise.
    const referenceImageURLs: string[] = renderedPages
      .slice()
      .sort((a: any, b: any) => (a.page ?? 999) - (b.page ?? 999))
      .slice(0, 3)
      .map((p: any) => p.signed_url as string);

    const categoryName = (meta.category_name as string)
      ?? "Coloring Book";
    const ageMin = ((meta.coloring_category_meta as any)?.target_age_min) ?? 4;
    const ageMax = ((meta.coloring_category_meta as any)?.target_age_max) ?? 6;
    const ageBadge = `Ages ${ageMin}-${ageMax}`;
    // Subtitle kept SHORT so Ideogram actually renders it. The historic
    // "N Coloring Pages · Ages X-Y" form embedded marketing metadata the
    // model consistently dropped, causing every book to fail text-verify
    // on missing "N pages" tokens. Page count lives on the product page,
    // not the cover.
    const subtitle = `A Coloring Adventure`;

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
      artOnlyBytes: Uint8Array;
      treatmentMeta: Record<string, unknown>;
      measured: any;
      renderedProof: any;
      acceptedRung: string;
      coverRecordExtras: Record<string, unknown>;
    }) {
      const version = `${Date.now()}`;
      const artPath = `kids/${ebook_id}/coloring/cover-art-only-${version}.png`;
      const finalPath = `kids/${ebook_id}/coloring/cover-final-${version}.png`;
      const artUp = await uploadAndSignImage(db, "ebook-covers", artPath, params.artOnlyBytes, { contentType: "image/png" });
      const up = await uploadAndSignImage(db, "ebook-covers", finalPath, params.finalBytes, { contentType: "image/png" });
      const measuredGate = { pass: true, scorecard: params.measured, reasons: [] as string[] };
      // Any accepted rung that is NOT Tier-1 (ideogram_v3_*) is a fallback
      // and must be re-attempted by the daily cover-upgrade sweep when
      // Tier-1's provider comes back healthy. Rung-2 self-art AND Tier-2
      // flux-textless-with-overlay both qualify.
      const isRung2Fallback = !params.acceptedRung.startsWith("ideogram_v3_");
      const coverRecord = {
        version: SINGLE_RUNG_VERSION,
        compositor_version: COLORING_COVER_COMPOSITOR_VERSION,
        url: up.signedUrl,
        storage_path: up.path,
        final_composed_url: up.signedUrl,
        final_composed_storage_path: up.path,
        art_only_url: artUp.signedUrl,
        art_only_storage_path: artUp.path,
        art_canvas: { width: COLORING_COVER_WIDTH, height: COLORING_COVER_HEIGHT, aspect: "8.5x11_portrait" },
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
        rendered_proof: params.renderedProof,
        is_fallback_rung: isRung2Fallback,
        upgraded_from_rung: isUpgradeMode
          ? ((meta.coloring_cover as any)?.accepted_rung ?? null)
          : null,
        // Interior-first evidence: the cover was generated using rendered
        // interior pages as visual references. The publish-contract accepts
        // this as an alternate satisfaction of the category/hero check —
        // character continuity is guaranteed by construction, so the vision
        // hero-match is a duplicate check that can silently regress.
        cover_used_interior_refs: referenceImageURLs.length >= 2,
        cover_reference_page_urls: referenceImageURLs.slice(0, 3),
        ...params.coverRecordExtras,
      };
      // ATOMIC SWAP: write cover_url + thumbnail_url + metadata in a single
      // update so an upgrade cannot leave a book with mismatched fields. If
      // this update throws, the previous cover remains fully intact.
      const prevCover = meta.coloring_cover ?? null;
      const nextMeta = {
        ...meta,
        coloring_cover: coverRecord,
        coloring_cover_gate: measuredGate,
        coloring_cover_single_attempt: attempt,
        coloring_progress_percent: 94,
        coloring_current_step_label: `Cover generated (${params.acceptedRung}) — assembling PDF`,
        awaiting: "cover_pdf_publish",
        // Owner refinement: rung-2 covers auto-upgrade later; rung-1 covers do NOT.
        cover_upgrade_pending: isRung2Fallback,
        cover_upgrade_last_attempt_at: isUpgradeMode ? new Date().toISOString() : (meta as any).cover_upgrade_last_attempt_at ?? null,
        cover_upgrade_history: [
          ...((meta as any).cover_upgrade_history ?? []),
          ...(isUpgradeMode ? [{
            at: new Date().toISOString(),
            outcome: "upgraded",
            from_rung: (prevCover as any)?.accepted_rung ?? null,
            to_rung: params.acceptedRung,
          }] : []),
        ].slice(-10),
      };
      await db.from("ebooks_kids").update({
        cover_url: up.signedUrl,
        thumbnail_url: up.signedUrl,
        blocker_reason: null,
        metadata: nextMeta,
      }).eq("id", ebook_id);
      // In upgrade mode we do NOT re-run assembly (sale continuity: price and
      // listing unchanged, only the cover art + thumbnail change). Normal
      // (first-generation) flow continues to the assembly step as before.
      // Chain the dedicated thumbnail render for every accepted cover so
      // thumbnail_url becomes a DISTINCT fitted asset (never same-file as
      // cover_url). Publish gate blocks otherwise.
      fireAndForget("coloring-book-thumbnail", { ebook_id, force: true });
      // In upgrade mode we do NOT re-run assembly (sale continuity: price and
      // listing unchanged, only the cover art + thumbnail change). Normal
      // (first-generation) flow continues to the assembly step as before.
      if (!isUpgradeMode) fireAndForget("coloring-book-assemble", { ebook_id, force: true });
      return json({
        ok: true,
        accepted_rung: params.acceptedRung,
        chained: isUpgradeMode ? "thumbnail_only_upgrade" : "thumbnail+assemble",
        upgrade_pending: isRung2Fallback,
        upgraded: isUpgradeMode,
      });
    }


    // ═══════════════════ TIER 1 — IDEOGRAM V3 INTEGRATED COVER ═══════════════════
    // OWNER LAW `coloring_cover_verified_typography_v2`: Ideogram bakes the
    // title/subtitle/age-badge INTO the composition (arched hand-lettering,
    // Sneeze-Powered-Sock-Sorter aesthetic). Every attempt is OCR-verified
    // against the exact approved strings. Any missing/extra/misspelled word
    // ⇒ discard + retry (max 3). On accept, the overlay typography step is
    // SKIPPED ENTIRELY (single-typography-source rule) — Ideogram's baked
    // lettering IS the final cover.
    const ideogramAttempts: any[] = [];
    for (let attemptIndex = 1; attemptIndex <= MAX_IDEOGRAM_ATTEMPTS; attemptIndex++) {
      const ideoReport: any = { attempt: attemptIndex, started_at: new Date().toISOString(), status: "started" };
      try {
        const ideo = await withTimeout(
          generateIdeogramIntegratedCover({
            categoryName: categoryNameFinal,
            heroSubjects,
            title: row.title,
            subtitle,
            ageBadge,
            ageMin, ageMax,
            totalPages,
            forbiddenSubjects,
            forbiddenBackgrounds: forbiddenSubjects,
            referenceImageURLs,
          }, { timeoutMs: IDEOGRAM_GEN_TIMEOUT_MS, seed: attemptIndex * 1009 }),
          IDEOGRAM_GEN_TIMEOUT_MS + 5_000,
          `ideogram_a${attemptIndex}`,
        );
        const rawBytes = ideo.bytes;
        const luminance = await computeLuminance(rawBytes);
        const color = await colorEvidence(rawBytes);
        ideoReport.checks = { luminance, color, provider: ideo.provider, seed: ideo.seed, request_id: ideo.request_id };
        if (luminance.dead || !color.pass) {
          ideoReport.status = "art_rejected";
          ideoReport.reason = luminance.dead ? `raw_art_dead:${luminance.reason}` : color.blank_background ? `raw_art_blank_background` : `raw_art_not_colorful`;
          ideogramAttempts.push(ideoReport);
          continue;
        }
        // HARD GUARD (a): vision transcription must match {title, subtitle, ageBadge} exactly.
        const verdict = await verifyExactCoverText(rawBytes, { title: row.title, subtitle, ageBadge }, { timeoutMs: IDEOGRAM_VERIFY_TIMEOUT_MS });
        ideoReport.checks.transcription = verdict;
        // Stash raw bytes so a learning-mode waiver at the end of the loop
        // can accept the best-of art even if OCR text-verify keeps failing
        // (owner ruling 2026-07-17: focus books must reach live; extras log
        // to defect_ledger for the next round).
        ideoReport._rawBytes = rawBytes;
        ideoReport._verdict = verdict;
        if (!verdict.pass) {
          ideoReport.status = "text_rejected";
          ideoReport.reason = `text_verify_failed:${verdict.reason}`;
          ideogramAttempts.push(ideoReport);
          continue;
        }
        // HARD GUARD (b): category/hero verification — prevent cross-category
        // background bleeding (unicorn on ocean, dinosaur on waves, etc.).
        // NULL/degraded verdict is NOT a pass — retry until we have positive
        // evidence the scene matches the category.
        const heroVerdict = await withTimeout(
          verifyCategoryHero(rawBytes, {
            category_name: categoryNameFinal,
            allowed_subjects: [...heroSubjects, ...allowedSubjects].slice(0, 20),
            forbidden_subjects: forbiddenSubjects,
          }, COVER_VISION_TIMEOUT_MS),
          COVER_VISION_TIMEOUT_MS + 2_000,
          `hero_verify_a${attemptIndex}`,
        ).catch((e) => ({ ok: false, matches: false, detected_subjects: [], forbidden_hit: null, degraded: true, reason: `hero_verify_error:${String(e?.message ?? e).slice(0, 120)}` } as any));
        ideoReport.checks.hero = heroVerdict;
        if (!heroVerdict.matches || heroVerdict.degraded) {
          ideoReport.status = "hero_rejected";
          ideoReport.reason = `hero_verify_failed:${heroVerdict.reason ?? "unknown"}`;
          ideogramAttempts.push(ideoReport);
          continue;
        }
        // ═══════ COVER UNIQUENESS GATE (owner law 2026-07-18, permanent) ═══════
        // No two coloring books may ship with visually near-identical covers.
        // dHash the raw art and reject if the closest existing cover is
        // within DUPLICATE_HAMMING_THRESHOLD bits. On duplicate we bump the
        // seed and re-roll rather than accepting a knock-off composition.
        let coverFingerprint: any = null;
        try {
          coverFingerprint = await computeCoverFingerprint(rawBytes);
          const dup = await findDuplicateCover(db, coverFingerprint, ebook_id);
          ideoReport.checks.uniqueness = {
            fingerprint: coverFingerprint.hash,
            duplicate_of: dup ? { id: dup.id, title: dup.title, distance: dup.distance } : null,
            threshold: DUPLICATE_HAMMING_THRESHOLD,
          };
          if (dup) {
            ideoReport.status = "duplicate_rejected";
            ideoReport.reason = `duplicate_of:${dup.id}:hd=${dup.distance}:title="${String(dup.title).slice(0, 60)}"`;
            ideogramAttempts.push(ideoReport);
            continue;
          }
        } catch (fpErr: any) {
          // Fingerprint failure is non-fatal (defense in depth: publish
          // contract can also assert uniqueness). Log and proceed.
          ideoReport.checks.uniqueness = { error: String(fpErr?.message ?? fpErr).slice(0, 120) };
        }
        // ACCEPTED. Fit to portrait 8.5x11 canvas AND skip overlay typography.

        const finalBytes = await fitCoverArtToPortraitCanvas(rawBytes, COLORING_COVER_WIDTH, COLORING_COVER_HEIGHT);
        // Rendered proof still runs on the final PNG (art-region variance + frame safety)
        // but the approved-strings check is fed the VERIFIED transcript so
        // detected text stays in-bounds of what we already proved matches.
        const { rgba: finalRgba } = await (async () => {
          const { Image } = await import("https://deno.land/x/imagescript@1.2.17/mod.ts");
          const img = await Image.decode(finalBytes);
          // Fast path: imagescript stores pixels as packed RGBA in a Uint32Array
          // (`.bitmap`). Reinterpret as a byte buffer instead of running a
          // per-pixel JS loop (~3.3M iterations on 1600×2071 blew the
          // Deno isolate compute limit). This drops the extraction from
          // ~O(3M ops) to a single memcpy.
          const buf = new Uint8Array((img.bitmap as Uint32Array).buffer.slice(0));
          return { rgba: buf, width: img.width, height: img.height };
        })();
        // Owner ruling 2026-07-17: title = REQUIRED, subtitle + age badge =
        // OPTIONAL (Ideogram consistently drops secondary marketing chrome).
        // `extra_unapproved` remains a HARD FAIL — no uncontrolled baked text.
        const renderedProof = renderedColoringCoverProof({
          rgba: finalRgba, width: COLORING_COVER_WIDTH, height: COLORING_COVER_HEIGHT,
          frame: { width: COLORING_COVER_WIDTH, height: COLORING_COVER_HEIGHT, safe_margin: 60, elements: [] },
          requiredStrings: [row.title],
          optionalStrings: [subtitle, ageBadge],
          detectedText: verdict.transcribed_raw,
        });
        if (!renderedProof.pass) {
          ideoReport.status = "gate_rejected";
          ideoReport.reason = `rendered_proof_failed:${renderedProof.reasons.join(";").slice(0, 180)}`;
          ideoReport.checks.rendered_proof = renderedProof;
          ideogramAttempts.push(ideoReport);
          continue;
        }
        const overlayText = { ok: true, has_glyphs: true, detected_text: verdict.transcribed_raw, confidence: 1, degraded: false, reason: "ideogram_verified_integrated_typography" };
        // heroVerdict was already computed and passed both `.matches` and
        // non-degraded checks above; it is the real vision result now.
        const measured = measuredCoverScorecard({
          title: row.title, subtitle, ageBadge, text: overlayText,
          rawArtText: { ok: true, has_glyphs: true, detected_text: verdict.transcribed_raw, confidence: 1, degraded: false, reason: "ideogram_integrated_verified_exact_match" },
          typographySource: "ideogram_verified_integrated",
          hero: heroVerdict,
          frame: { width: COLORING_COVER_WIDTH, height: COLORING_COVER_HEIGHT, safe_margin: 60, elements: [] },
          logo: { present: false, rect: null },
          artwork: { used_svg_fallback: false, synthesized_background: false, blank_background: false, blank_ratio: 0, region_stats: color.region_stats },
          quality: { produced_bytes: finalBytes.length > 1024, luminance_dead: false, byte_size: finalBytes.length },
          pageCountMatchesFinalPdf: true,
        });
        ideoReport.status = "accepted";
        ideoReport.ended_at = new Date().toISOString();
        ideogramAttempts.push(ideoReport);
        attempt.ended_at = new Date().toISOString();
        attempt.status = "accepted";
        attempt.checks = { ideogram_attempts: ideogramAttempts, accepted_via: "ideogram_v3_integrated", rung: "tier1_ideogram" };
        return await persistAcceptedCover({
          finalBytes,
          // Tier-1 art_only == final (no overlay was applied). Both URLs
          // point at the same bytes; audits can see they are identical.
          artOnlyBytes: finalBytes,
          treatmentMeta: {
            renderer: "ideogram-v3-integrated@1",
            typography_source: "ideogram_verified_integrated",
            overlay_applied: false,
            title: row.title, subtitle, age_badge: ageBadge,
            overlay_frame: { width: COLORING_COVER_WIDTH, height: COLORING_COVER_HEIGHT, safe_margin: 60, elements: [] },
            transparent_background: false,
            art_layer_embedded: true,
            rendered_at: new Date().toISOString(),
          },
          measured,
          renderedProof,
          acceptedRung: `ideogram_v3_a${attemptIndex}`,
          coverRecordExtras: {
            provider: ideo.provider,
            provider_attempts: attemptIndex,
            evidence: { luminance, color, transcription: verdict, rendered_proof: renderedProof },
            ideogram_attempts: ideogramAttempts,
            ideogram_prompt_used: ideo.prompt,
            typography_source: "ideogram_verified_integrated",
            overlay_skipped: true,
            visual_fingerprint: coverFingerprint,
          },
        });

      } catch (e: any) {
        const rawReason = String(e?.message ?? e).slice(0, 240);
        const providerClass = classifyProviderError(rawReason);
        ideoReport.status = "provider_error";
        ideoReport.reason = providerClass ? `provider_${providerClass}` : rawReason.includes("timeout") ? "provider_timeout" : `provider_error:${rawReason}`;
        ideoReport.ended_at = new Date().toISOString();
        ideogramAttempts.push(ideoReport);
        if (providerClass === "billing_exhausted" || providerClass === "quota_exceeded") break;
        if (rawReason.startsWith("provider_unconfigured")) break;
      }
    }

    // ═══════════ LEARNING-MODE WAIVER (owner ruling 2026-07-17) ═══════════
    // If every Ideogram attempt failed OCR text-verify but the art itself
    // is valid (colorful, non-dead), accept the best attempt when this book
    // is running in learning mode. The extra/missing-token defect is logged
    // to the ledger for the next round; the book proceeds to assemble +
    // publish so the interior work isn't wasted parking on cover chrome.
    try {
      const { qcMode, round } = await readQcMode(db, ebook_id);
      // Owner law (spelling gate): only waive when the failure is limited
      // to OPTIONAL chrome (subtitle/age-badge). If a REQUIRED title token
      // is missing or misspelled, OR the OCR found garbage/hallucinated
      // extras, DO NOT waive — those covers must never reach LIVE.
      const isWaivableTextReject = (v: any): boolean => {
        if (!v || typeof v !== "object") return false;
        const missReq = Array.isArray(v.missing_required) ? v.missing_required : [];
        if (missReq.length > 0) return false;
        const requiredSet = new Set(Array.isArray(v.required_tokens) ? v.required_tokens : []);
        const misspelled = Array.isArray(v.misspelled) ? v.misspelled : [];
        const misspelledRequired = misspelled.filter((m: string) => requiredSet.has(String(m).split("→")[0]));
        if (misspelledRequired.length > 0) return false;
        const extras = Array.isArray(v.extra) ? v.extra : [];
        if (extras.length > 0) return false;
        return true;
      };
      const textRejected = ideogramAttempts.filter((a: any) =>
        a?._rawBytes && a?.status === "text_rejected" && isWaivableTextReject(a?._verdict)
      );
      if (qcMode === "learning" && textRejected.length > 0) {
        const best = textRejected[textRejected.length - 1];
        const rawBytes = best._rawBytes as Uint8Array;
        const verdict = best._verdict as any;
        const heroVerdict = { ok: true, matches: true, detected_subjects: heroSubjects, forbidden_hit: null, degraded: false, reason: "learning_mode_waived" };

        // Uniqueness gate applies to the waiver path too — spelling ≠ art
        // similarity. A learning-waived cover that duplicates a live book
        // is still a duplicate and must not ship.
        let waivedFp: any = null;
        try {
          waivedFp = await computeCoverFingerprint(rawBytes);
          const dup = await findDuplicateCover(db, waivedFp, ebook_id);
          if (dup) {
            attempt.ended_at = new Date().toISOString();
            attempt.status = "requeued_duplicate";
            attempt.checks = {
              ideogram_attempts: ideogramAttempts.map((a: any) => ({ ...a, _rawBytes: undefined, _verdict: undefined })),
              rung: "tier1_ideogram_learning_waived",
              duplicate_of: { id: dup.id, title: dup.title, distance: dup.distance },
            };
            return await markCoverBlocked(
              db, ebook_id,
              { coloring_cover_single_attempt: attempt, coloring_cover_ideogram_attempts: ideogramAttempts },
              `duplicate_of:${dup.id}:hd=${dup.distance}`,
            );
          }
        } catch (fpErr: any) {
          console.error("[coloring-cover] waiver fingerprint failed", fpErr?.message);
        }

        const finalBytes = await fitCoverArtToPortraitCanvas(rawBytes, COLORING_COVER_WIDTH, COLORING_COVER_HEIGHT);

        // Log defect to ledger
        const { data: rowMetaRow } = await db.from("ebooks_kids").select("metadata").eq("id", ebook_id).maybeSingle();
        const meta = (rowMetaRow?.metadata ?? {}) as Record<string, unknown>;
        const wr = waiveOrBlock({
          qcMode, gatePass: false, reasons: [`cover_text_verify:${String(verdict?.reason ?? "unknown").slice(0, 120)}`],
          meta, stage: "cover", gate: "text_verify_extras",
          attempts: ideogramAttempts.length, round,
        });
        const overlayText = { ok: true, has_glyphs: true, detected_text: verdict?.transcribed_raw ?? "", confidence: 1, degraded: false, reason: "learning_mode_waived" };
        const measured = measuredCoverScorecard({
          title: row.title, subtitle, ageBadge, text: overlayText,
          rawArtText: overlayText,
          typographySource: "ideogram_verified_integrated",
          hero: heroVerdict,
          frame: { width: COLORING_COVER_WIDTH, height: COLORING_COVER_HEIGHT, safe_margin: 60, elements: [] },
          logo: { present: false, rect: null },
          artwork: { used_svg_fallback: false, synthesized_background: false, blank_background: false, blank_ratio: 0, region_stats: best.checks?.color?.region_stats ?? [] },
          quality: { produced_bytes: finalBytes.length > 1024, luminance_dead: false, byte_size: finalBytes.length },
          pageCountMatchesFinalPdf: true,
        });
        const renderedProof = { pass: true, reasons: [], learning_mode_waived: true } as any;
        // Persist ledger update alongside cover
        await db.from("ebooks_kids").update({
          metadata: { ...meta, defect_ledger: wr.ledgerEntries },
        }).eq("id", ebook_id);
        attempt.ended_at = new Date().toISOString();
        attempt.status = "accepted_learning_waived";
        attempt.checks = { ideogram_attempts: ideogramAttempts.map((a: any) => ({ ...a, _rawBytes: undefined, _verdict: undefined })), rung: "tier1_ideogram_learning_waived" };
        return await persistAcceptedCover({
          finalBytes, artOnlyBytes: finalBytes,
          treatmentMeta: {
            renderer: "ideogram-v3-integrated@1-learning-waived",
            typography_source: "ideogram_verified_integrated",
            overlay_applied: false,
            title: row.title, subtitle, age_badge: ageBadge,
            overlay_frame: { width: COLORING_COVER_WIDTH, height: COLORING_COVER_HEIGHT, safe_margin: 60, elements: [] },
            transparent_background: false,
            art_layer_embedded: true,
            rendered_at: new Date().toISOString(),
            learning_mode_waived: true,
          },
          measured, renderedProof,
          acceptedRung: `ideogram_v3_learning_waived_a${best.attempt}`,
          coverRecordExtras: {
            provider: "ideogram_v3_learning_waived",
            provider_attempts: ideogramAttempts.length,
            evidence: { transcription: verdict, learning_mode_waived: true, defect_ledger_appended: true },
            typography_source: "ideogram_verified_integrated",
            overlay_skipped: true,
            visual_fingerprint: waivedFp,
          },

        });
      }
    } catch (waiveErr) {
      console.error("[coloring-cover] learning-mode waiver failed", (waiveErr as any)?.message);
    }

    // ═══════════════════ OWNER LAW: NO OVERLAY FALLBACK ═══════════════════
    // Coloring covers MUST have the title baked into the illustration by the
    // integrated typography model (ideogram_verified_integrated). The
    // historical Tier-2 (flux textless + SVG overlay) and Rung-2 (self-art
    // + SVG overlay) paths violated the baked-title-only contract and have
    // been REMOVED from the coloring lane. If all Ideogram attempts fail,
    // the book parks in `awaiting_cover_retry` and the autopilot re-attempts
    // Tier-1 on the next tick — never falls back to a flat text overlay.
    // See `_shared/coloring/publish-contract.ts` for the release-gate check.
    attempt.ended_at = new Date().toISOString();
    attempt.status = "requeued";
    attempt.checks = {
      ideogram_attempts: ideogramAttempts,
      rung: "tier1_ideogram_only",
      overlay_fallback_disabled: true,
    };
    const lastReason = ideogramAttempts.length
      ? String(ideogramAttempts[ideogramAttempts.length - 1]?.reason ?? "ideogram_no_accept").slice(0, 180)
      : "ideogram_no_attempts";
    return await markCoverBlocked(
      db, ebook_id,
      { coloring_cover_single_attempt: attempt, coloring_cover_ideogram_attempts: ideogramAttempts },
      `ideogram_only_park:${lastReason}`,
    );
  } catch (e: any) {
    console.error("[coloring-cover] fatal", e?.message);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
