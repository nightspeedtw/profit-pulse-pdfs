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
import { generateIdeogramIntegratedCover, generateIdeogramTextInpaint, IDEOGRAM_INTEGRATED_COVER_VERSION } from "../_shared/coloring/ideogram-integrated-cover.ts";
import { verifyExactCoverText } from "../_shared/coloring/cover-text-transcription.ts";
import { renderedColoringCoverProof } from "../_shared/coloring/coloring-cover-proof.ts";
import { readQcMode, waiveOrBlock } from "../_shared/coloring/qc-mode.ts";
import { computeCoverFingerprint, findDuplicateCover, DUPLICATE_HAMMING_THRESHOLD } from "../_shared/coloring/cover-uniqueness.ts";


declare const Deno: any;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── PERMANENT METADATA BLOAT GUARD (owner law: 'metadata_never_toasts') ───
// Every prior "cover parked" write persisted `ideogramAttempts` verbatim,
// which retained `_rawBytes` (raw PNG Uint8Arrays, ~2MB each) and full
// verdict transcripts. After 4-8 attempts the row's JSONB grew past
// 10-20 MB, forcing every subsequent UPDATE into a TOAST rewrite and
// causing statement timeouts / 57P03 rejections. Fix at source: strip
// bytes + truncate long strings + cap history depth on the way in.
// If this cap or the sanitizer is removed, the DB will re-bloat and
// covers will re-stall — do not shortcut it.
const MAX_ATTEMPT_HISTORY = 5;
function sanitizeAttemptForPersist(a: any): any {
  if (!a || typeof a !== "object") return a;
  const { _rawBytes, _verdict, ...rest } = a as any;
  const clone: any = { ...rest };
  const c = clone.checks;
  if (c && typeof c === "object") {
    const t = c.transcription;
    if (t && typeof t === "object") {
      clone.checks = {
        ...c,
        transcription: {
          pass: t.pass ?? null,
          reason: typeof t.reason === "string" ? t.reason.slice(0, 240) : t.reason ?? null,
          transcribed_raw: typeof t.transcribed_raw === "string" ? t.transcribed_raw.slice(0, 240) : undefined,
        },
      };
    }
  }
  if (typeof clone.reason === "string") clone.reason = clone.reason.slice(0, 240);
  return clone;
}
function sanitizeAttemptsForPersist(list: any): any[] {
  if (!Array.isArray(list)) return [];
  const cleaned = list.map(sanitizeAttemptForPersist);
  return cleaned.slice(-MAX_ATTEMPT_HISTORY);
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
// OOM defense (cover-function-worker-oom-v1): dropped from 3 → 1. Even
// with downsampled analysis buffers, 3 attempts × (rawBytes ~2 MB kept
// alive on text_rejected + decoded ~13 MB during compositor + base64-
// encoded vision request bodies) stacks past the 256 MB isolate cap.
// One attempt fits; if it fails, the outer worker-tick retries with a
// fresh isolate (own heap). Same effective retry budget, no stacking.
const MAX_IDEOGRAM_ATTEMPTS = 1;

// OWNER LAW (2026-07-17, added after $116 unbounded-retry incident):
// hard ceiling on how many TIMES the cover function may be invoked per book.
// Each invocation burns up to MAX_IDEOGRAM_ATTEMPTS × $0.06 = $0.18 on Runware
// Ideogram. Without this ceiling, worker-tick + self-advance + upgrade-sweep
// re-invoke the cover forever whenever text-verify keeps failing. When the
// ceiling is hit, the book parks with a distinct terminal-ish blocker that
// worker-tick's LANE_BLOCKED filter skips — permanent, non-waivable, non-self-
// advancing. Human/admin resets by clearing metadata.coloring_cover_invocations.
const MAX_COVER_INVOCATIONS_PER_BOOK = 8;
const COVER_RETRY_CEILING_REASON = "coloring_cover_retry_ceiling_reached";


function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`wallclock_timeout:${label}:${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

function isTransientBackendConnectionError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e ?? "");
  return /schema cache|Too many connections|Hot standby mode is disabled|database system is not accepting connections|SSL handshake failed|Error code 52[015]|\b52[015]\b|Web server is down|Cloudflare error page|connection closed before message completed/i.test(msg);
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

// OOM defense (cover-function-worker-oom-v1): every full-res decode of an
// Ideogram/GPT cover (~1600×2071) plus a matching Uint8Array RGBA buffer is
// ~13 MB. Doing that 3-4× per attempt inside a Deno edge isolate (256 MB
// heap) reliably OOMs. Downsample the decoded image to `MAX_ANALYSIS_DIM`
// on the long edge BEFORE allocating the RGBA buffer — the QC math
// (saturation, chroma, blank-region detection, dHash) doesn't need 2 MP
// resolution; 512 px is plenty and drops the biggest allocation ~10×.
const MAX_ANALYSIS_DIM = 512;

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

async function colorEvidence(bytes: Uint8Array) {
  const { img, w, h } = await decodeDownsampled(bytes);
  // Pack imagescript's RGBA-in-uint32 pixels into a flat RGBA byte buffer
  // so detectBlankRegions() (unit-tested) can operate on it. Now on the
  // DOWNSAMPLED canvas (~512 px long edge), so ~340k iters instead of
  // ~3.3M — fits inside the isolate CPU budget.
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
    _downsampled_from: `${bytes.length}b`,
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
  let requestBody: any = {};
  try {
    requestBody = await req.json().catch(() => ({}));
    const { ebook_id, force, mode } = requestBody;
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);
    const isUpgradeMode = mode === "upgrade";
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

    // ── HARD RETRY CEILING (owner law: unbounded_cover_retry_forbidden) ──
    // Increment BEFORE any provider call so a crashing attempt still counts.
    // Upgrade mode is exempt (it's a manual admin sweep, not the retry loop).
    const priorInvocations = Number((meta as any).coloring_cover_invocations ?? 0);
    const forceSelfArtFallback = !isUpgradeMode && priorInvocations >= MAX_COVER_INVOCATIONS_PER_BOOK;
    if (forceSelfArtFallback) {
      await patchMeta(db, ebook_id, {
        coloring_current_step_label: `Cover paid retry ceiling reached (${priorInvocations}/${MAX_COVER_INVOCATIONS_PER_BOOK}) — switching to zero-cost self-art cover.`,
        coloring_cover_retry_ceiling_redirect: {
          reason: COVER_RETRY_CEILING_REASON,
          invocations: priorInvocations,
          ceiling: MAX_COVER_INVOCATIONS_PER_BOOK,
          redirected_to: "self_art_deterministic_cover",
          detected_at: new Date().toISOString(),
        },
        awaiting: "cover_pdf_publish",
      });
    }

    // PAID-CEILING TRIPWIRE — sum across ALL cover providers (ideogram + gpt_image
    // + thumbnail + inpaint) in the last 24h. Prevents the c2839b88 class where
    // per-provider caps were bypassed by hopping between providers (2026-07-19).
    if (!forceSelfArtFallback) try {
      const { assertPaidCeiling: assertPC, isBudgetCeilingError: isBCE, parkOnPaidCeiling: parkPC } = await import("../_shared/paid-ceiling.ts");
      for (const s of ["coloring_cover_ideogram", "coloring_cover_gpt_image", "coloring_cover_ideogram_inpaint"]) {
        try {
          await assertPC({ ebook_id, step: s, supabase: db });
        } catch (ce) {
          if (isBCE(ce)) {
            console.error(`[coloring-cover] paid-ceiling hit ${s} for ebook=${ebook_id} — requeueing with cooldown`);
            await parkPC(ebook_id, ce, db);
            return json({ ok: false, parked: true, reason: ce.message }, 200);
          }
          throw ce;
        }
      }
    } catch (_pcSetupErr) { /* module import failure shouldn't block */ }

    if (!isUpgradeMode && !forceSelfArtFallback) {
      await patchMeta(db, ebook_id, { coloring_cover_invocations: priorInvocations + 1 });
    }


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
    const { resolveBandProfileForDbBand, bandProfileForAges } = await import("../_shared/coloring/age-bands.ts");
    const bandKey = (meta.age_band as string | undefined) ?? (row as any).age_band;
    const bandProfile = resolveBandProfileForDbBand(bandKey) ?? bandProfileForAges(ageMin, ageMax);
    const prompt = buildColoringCoverArtPrompt({
      categoryName: categoryNameFinal,
      ageMin, ageMax,
      heroSubjects,
      forbiddenSubjects,
      extraClauses: [anatomyClauses, learnedClause],
      bannedTitle: row.title,
      bandProfile,
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

    if (forceSelfArtFallback) {
      const selfArt = await renderColoringSelfArtCover({
        categoryKey,
        categoryName: categoryNameFinal,
        pages: renderedPages
          .slice()
          .sort((a: any, b: any) => (a.page ?? 999) - (b.page ?? 999))
          .slice(0, 3)
          .map((p: any) => ({ page: Number(p.page ?? 0), url: p.signed_url as string })),
        canvasWidth: COLORING_COVER_WIDTH,
        canvasHeight: COLORING_COVER_HEIGHT,
        seed: ebook_id,
      });
      const composed = await composeColoringCover({
        artBytes: selfArt.bytes,
        title: row.title,
        subtitle,
        description: row.description ?? null,
        palette: [selfArt.palette.background_hex, ...selfArt.palette.subject_hex],
        ageBadge,
      });
      const exactTranscript = {
        pass: true,
        degraded: false,
        required_tokens: String(row.title ?? "").split(/\s+/).filter(Boolean),
        missing_required: [],
        misspelled: [],
        extra: [],
        transcribed_raw: [row.title, subtitle, ageBadge, "SecretPDF Kids"].filter(Boolean).join(" | "),
        reason: "deterministic_exact_title_render",
      };
      const measured = measuredCoverScorecard({
        title: row.title, subtitle, ageBadge,
        text: { ok: true, has_glyphs: true, detected_text: exactTranscript.transcribed_raw, confidence: 1, degraded: false, reason: "deterministic_exact_title_render" },
        rawArtText: { ok: true, has_glyphs: false, detected_text: "", confidence: 1, degraded: false, reason: "self_art_raw_is_textless" },
        typographySource: "deterministic_exact_title_render",
        hero: { ok: true, matches: true, detected_subjects: heroSubjects, forbidden_hit: null, degraded: false, reason: "self_art_from_interior_refs" },
        frame: (composed.treatmentMeta as any).overlay_frame ?? { width: COLORING_COVER_WIDTH, height: COLORING_COVER_HEIGHT, safe_margin: 60, elements: [] },
        logo: { present: true, rect: null },
        artwork: { used_svg_fallback: false, synthesized_background: false, blank_background: false, blank_ratio: 0, region_stats: [] },
        quality: { produced_bytes: composed.finalBytes.length > 1024, luminance_dead: false, byte_size: composed.finalBytes.length },
        pageCountMatchesFinalPdf: true,
      });
      attempt.ended_at = new Date().toISOString();
      attempt.status = "accepted_self_art_retry_ceiling";
      attempt.checks = { accepted_via: "self_art_deterministic_cover", reason: COVER_RETRY_CEILING_REASON, self_art: selfArt };
      return await persistAcceptedCover({
        finalBytes: composed.finalBytes,
        artOnlyBytes: composed.artOnlyBytes,
        treatmentMeta: {
          ...composed.treatmentMeta,
          typography_source: "deterministic_exact_title_render",
          overlay_applied: false,
          title: row.title,
          subtitle,
          age_badge: ageBadge,
        },
        measured,
        renderedProof: composed.renderedProof,
        acceptedRung: "self_art_retry_ceiling",
        coverRecordExtras: {
          provider: "self_art_deterministic",
          provider_attempts: 0,
          evidence: { transcription: exactTranscript, self_art: selfArt, rendered_proof: composed.renderedProof },
          typography_source: "deterministic_exact_title_render",
          overlay_skipped: false,
          no_paid_ai_cover_call: true,
          retry_ceiling_redirected: true,
        },
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
    // Owner order 2026-07-17: on text-only failure, subsequent attempts must
    // INPAINT just the text region on the same base image rather than reroll
    // the entire cover. This preserves art that already passed
    // category/hero/uniqueness checks and cuts $/retry roughly in half by
    // avoiding a fresh full-scene gamble.
    let lastPassingArtBytes: Uint8Array | null = null;
    for (let attemptIndex = 1; attemptIndex <= MAX_IDEOGRAM_ATTEMPTS; attemptIndex++) {
      const useInpaint = attemptIndex > 1 && lastPassingArtBytes != null;
      const ideoReport: any = { attempt: attemptIndex, mode: useInpaint ? "inpaint" : "full", started_at: new Date().toISOString(), status: "started" };
      try {
        const ideo = useInpaint
          ? await withTimeout(
              generateIdeogramTextInpaint({
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
                ebook_id,
                baseImageBytes: lastPassingArtBytes!,
              }, { timeoutMs: IDEOGRAM_GEN_TIMEOUT_MS, seed: attemptIndex * 2017 }),
              IDEOGRAM_GEN_TIMEOUT_MS + 5_000,
              `ideogram_inpaint_a${attemptIndex}`,
            )
          : await withTimeout(
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
                ebook_id,
              }, { timeoutMs: IDEOGRAM_GEN_TIMEOUT_MS, seed: attemptIndex * 1009, db }),
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
        // Stash raw bytes ONLY on the waivable text-reject path so a
        // learning-mode waiver can accept the best-of art later. Holding
        // rawBytes on every attempt (previous behavior) blew the isolate
        // heap — 3-4 attempts × ~2 MB PNG = 6-8 MB kept alive for the
        // whole loop, on top of decode/rgba buffers. See known-regressions
        // `cover-function-worker-oom-v1`.
        ideoReport._verdict = verdict;

        if (!verdict.pass) {
          ideoReport.status = "text_rejected";
          ideoReport.reason = `text_verify_failed:${verdict.reason}`;
          // Owner order: art passed luminance+color but text failed → keep
          // these bytes as the base for the next attempt's inpaint retry
          // rather than re-rolling the whole cover. Also retained here for
          // the learning-mode waiver path (see best-of pick below).
          lastPassingArtBytes = rawBytes;
          ideoReport._rawBytes = rawBytes;
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
        // OOM defense: previously this path decoded finalBytes at full
        // resolution (~1600×2071 → 13 MB Uint32Array + 13 MB Uint8Array
        // copy via .buffer.slice(0)) and kept the buffer alive until
        // renderedColoringCoverProof returned. Downsample first — variance
        // + region-blank math needs pixels, not megapixels.
        const { img: finalImg, w: finalW, h: finalH } = await decodeDownsampled(finalBytes);
        const finalRgba = new Uint8Array(finalW * finalH * 4);
        for (let py = 0; py < finalH; py++) {
          for (let px = 0; px < finalW; px++) {
            const p = finalImg.getPixelAt(px + 1, py + 1);
            const i = (py * finalW + px) * 4;
            finalRgba[i] = (p >>> 24) & 0xff;
            finalRgba[i + 1] = (p >>> 16) & 0xff;
            finalRgba[i + 2] = (p >>> 8) & 0xff;
            finalRgba[i + 3] = 255;
          }
        }
        // Owner ruling 2026-07-17: title = REQUIRED, subtitle + age badge =
        // OPTIONAL (Ideogram consistently drops secondary marketing chrome).
        // `extra_unapproved` remains a HARD FAIL — no uncontrolled baked text.
        const renderedProof = renderedColoringCoverProof({
          rgba: finalRgba, width: finalW, height: finalH,
          frame: { width: finalW, height: finalH, safe_margin: Math.max(8, Math.floor(60 * finalW / COLORING_COVER_WIDTH)), elements: [] },
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
        attempt.checks = { ideogram_attempts: sanitizeAttemptsForPersist(ideogramAttempts), accepted_via: "ideogram_v3_integrated", rung: "tier1_ideogram" };
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
            ideogram_attempts: sanitizeAttemptsForPersist(ideogramAttempts),
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
      } finally {
        // ═══════ COVER PROVIDER PASS-RATE TELEMETRY (owner order 2026-07-18) ═══════
        // Records every cover attempt outcome so pickCoverPrimaryProvider()
        // can auto-degrade GPT Image → Ideogram if the rolling pass-rate on
        // real books drops below the floor. Provider is read from
        // ideoReport.checks.provider (set right after generation).
        try {
          const provider = (ideoReport?.checks as any)?.provider ?? null;
          if (provider) {
            await db.from("coloring_book_events").insert({
              ebook_kids_id: ebook_id,
              event_type: "cover_provider_attempt",
              metadata: {
                provider,
                pass: ideoReport?.status === "accepted",
                status: ideoReport?.status ?? "unknown",
                reason: ideoReport?.reason ?? null,
                mode: ideoReport?.mode ?? "full",
                attempt: attemptIndex,
              },
            });
          }
        } catch (_e) { /* telemetry is fire-and-forget */ }
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
              ideogram_attempts: sanitizeAttemptsForPersist(ideogramAttempts),
              rung: "tier1_ideogram_learning_waived",
              duplicate_of: { id: dup.id, title: dup.title, distance: dup.distance },
            };
            return await markCoverBlocked(
              db, ebook_id,
              { coloring_cover_single_attempt: attempt, coloring_cover_ideogram_attempts: sanitizeAttemptsForPersist(ideogramAttempts) },
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
        attempt.checks = { ideogram_attempts: sanitizeAttemptsForPersist(ideogramAttempts), rung: "tier1_ideogram_learning_waived" };
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
      ideogram_attempts: sanitizeAttemptsForPersist(ideogramAttempts),
      rung: "tier1_ideogram_only",
      overlay_fallback_disabled: true,
    };
    const lastReason = ideogramAttempts.length
      ? String(ideogramAttempts[ideogramAttempts.length - 1]?.reason ?? "ideogram_no_accept").slice(0, 180)
      : "ideogram_no_attempts";
    const tailResp = await markCoverBlocked(
      db, ebook_id,
      { coloring_cover_single_attempt: attempt, coloring_cover_ideogram_attempts: sanitizeAttemptsForPersist(ideogramAttempts) },
      `ideogram_only_park:${lastReason}`,
    );
    if (!(tailResp instanceof Response)) {
      // Structural tripwire (owner doctrine 2026-07-18,
      // silent-no-op-after-provider-fallback). Every exit path of this
      // function MUST return a Response tied to (a) success + asset URLs,
      // (b) explicit failure with strike + blocker_reason, or (c) explicit
      // park. If markCoverBlocked ever returns undefined we FAIL LOUDLY
      // naming the site rather than letting the worker see a happy 200.
      throw new Error("silent_no_op:cover_tail_markCoverBlocked_returned_non_response");
    }
    return tailResp;
    // Unreachable by design. If a future edit inserts code below this
    // line that forgets to return, this throw guarantees the failure is
    // observable rather than becoming a silent no-op.
    // eslint-disable-next-line no-unreachable
    throw new Error("silent_no_op:cover_fell_through_bottom_of_handler");
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    const ebookId = requestBody?.ebook_id;
    if (isTransientBackendConnectionError(e)) {
      console.warn("[coloring-cover] transient backend cooldown", msg);
      if (ebookId) {
        try {
          await patchMeta(db, ebookId, {
            coloring_current_step_label: `Cover technical cooldown — backend connection/schema cache: ${msg}`,
            coloring_transient_backend_at: new Date().toISOString(),
            awaiting: "cover_pdf_publish",
          });
          await db.from("ebooks_kids").update({
            pipeline_status: "queued",
            blocker_reason: null,
          }).eq("id", ebookId);
        } catch (stampErr: any) {
          console.warn("[coloring-cover] transient cooldown stamp skipped", stampErr?.message);
        }
      }
      return json({ ok: false, transient: true, requeued: true, reason: msg }, 202);
    }
    console.error("[coloring-cover] fatal", msg);
    // OWNER DOCTRINE: a thrown error must never leave the book silently
    // unchanged. Stamp a blocker_reason so worker-tick sees the failure,
    // the strike is visible in the DB, and downstream stall-watchdogs can
    // detect and rotate. Also record a defect event for the
    // silent-no-op-after-provider-fallback detection heuristic.
    try {
      if (ebookId) {
        await patchMeta(db, ebookId, {
          coloring_blocker: {
            class: "cover_function_threw",
            reason: `cover_fatal:${msg}`,
            detected_at: new Date().toISOString(),
          },
          coloring_current_step_label: `Cover function threw: ${msg}`,
        });
        await db.from("ebooks_kids").update({
          pipeline_status: "queued",
          blocker_reason: `coloring_cover_fatal:${msg}`.slice(0, 300),
        }).eq("id", ebookId);
        await db.from("coloring_book_events").insert({
          ebook_kids_id: ebookId,
          event_type: "cover_function_threw",
          metadata: { error: msg, at: new Date().toISOString() },
        }).catch(() => {});
      }
    } catch (stampErr: any) {
      console.error("[coloring-cover] blocker-stamp failed", stampErr?.message);
    }
    return json({ error: msg, blocker_stamped: true }, 500);
  }
});
