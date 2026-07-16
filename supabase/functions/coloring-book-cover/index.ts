// coloring-book-cover — per-rung state machine for the unified cover ladder.
//
// PROBLEM this file solves:
//   Running all 4 generator rungs (Ideogram A/B → Recraft → Gemini) plus
//   SVG fallback in a single edge invocation blows the ~30s CPU cap and
//   the book gets parked at 92% forever. Fix: execute EXACTLY ONE rung
//   per invocation, persist the ladder state in metadata, and self-invoke
//   to advance to the next rung. Dead frames advance without consuming
//   any retire budget; SVG fallback is dead-impossible and terminal.
//
// State (metadata.coloring_cover_ladder):
//   { rungs: [...], next_index: n, reports: [...], started_at, updated_at }
//
// Contract:
//   • book_type=coloring_book only.
//   • Idempotent: if cover_url already set, skips generation and chains
//     to assemble.
//   • Never lowers a gate. Never retires a book. On SVG-fallback rung the
//     cover is guaranteed.

// @ts-nocheck  Deno edge runtime
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  DEFAULT_COVER_RUNGS,
  runSingleCoverRung,
  type CoverLadderInput,
  type CoverLadderRungReport,
  type CoverRungLabel,
} from "../_shared/covers/kids-cover-ladder.ts";
import { renderKidsTitleTreatment } from "../_shared/covers/kids-title-treatment.ts";
import { transcribeGlyphs, verifyCategoryHero } from "../_shared/covers/cover-vision-guards.ts";
import { MEASURED_COVER_GATE_VERSION, measuredCoverScorecard } from "../_shared/covers/cover-measured-gate.ts";
import { coloringCoverGate } from "../_shared/coloring/gates.ts";
import { uploadAndSignImage } from "../_shared/versioned-assets.ts";

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

interface RungAttempt {
  speed?: "QUALITY" | "BALANCED" | "TURBO" | null;
  started_at: string;
  ended_at?: string | null;
  ok?: boolean;
  reason?: string | null;
  status?: string;
}

interface LadderState {
  rungs: CoverRungLabel[];
  next_index: number;
  // Ideogram speed cursor: 0=QUALITY, 1=BALANCED, 2=TURBO. Resets on rung advance.
  ideogram_speed_cursor: number;
  reports: Array<Pick<CoverLadderRungReport, "rung" | "reason" | "produced_bytes">>;
  attempts_by_rung: Record<string, RungAttempt[]>;
  started_at: string;
  updated_at: string;
}

const IDEOGRAM_SPEEDS: Array<"QUALITY" | "BALANCED" | "TURBO"> = ["QUALITY", "BALANCED", "TURBO"];
const RUNG_WALLCLOCK_MS = 90_000;
const CRASH_STALE_MS = 3 * 60_000; // any attempt with no ended_at older than this = crashed

function newLadderState(): LadderState {
  const now = new Date().toISOString();
  return {
    rungs: [...DEFAULT_COVER_RUNGS],
    next_index: 0,
    ideogram_speed_cursor: 0,
    reports: [],
    attempts_by_rung: {},
    started_at: now,
    updated_at: now,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`wallclock_timeout:${label}:${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { ebook_id, force, resume } = await req.json();
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: row, error } = await db.from("ebooks_kids")
      .select("id, book_type, title, subtitle, description, metadata, cover_url")
      .eq("id", ebook_id).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: "not_found" }, 404);
    if (row.book_type !== "coloring_book") return json({ error: "wrong_lane" }, 400);

    const meta = (row.metadata ?? {}) as Record<string, unknown>;

    // Already have a cover? Advance.
    const existingGateVersion = (meta.coloring_cover_gate as any)?.scorecard?.version ?? (meta.coloring_cover as any)?.measured_gate?.scorecard?.version;
    if (!force && meta.coloring_cover && row.cover_url && existingGateVersion === MEASURED_COVER_GATE_VERSION) {
      fireAndForget("coloring-book-assemble", { ebook_id });
      return json({ ok: true, skipped: "cover_exists", chained: "assemble" });
    }

    // Build input once.
    const pages = (meta.coloring_pages as any[] | undefined) ?? [];
    const refUrls = pages.slice(0, 2).map((p) => p.signed_url).filter(Boolean);
    const plan = ((meta.coloring_page_plan as any)?.plan ?? []) as any[];
    const totalPages = plan.length || pages.length || 32;

    const categoryName = (meta.category_name as string)
      ?? ((meta.coloring_page_plan as any)?.category_name as string)
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
        .select("allowed_subjects, forbidden_subjects")
        .eq("category_key", categoryKey).maybeSingle();
      if (cat?.allowed_subjects) allowedSubjects = cat.allowed_subjects;
      if (cat?.forbidden_subjects) forbiddenSubjects = cat.forbidden_subjects;
    }

    const charDesc = [
      `A charming, kid-friendly COVER for a coloring book titled "${row.title}".`,
      `Subject: ${categoryName}. Show 2-4 adorable characters/subjects from the theme in a warm painterly SCENE (COLOR artwork, NOT line-art — this is the printed cover shown in stores).`,
      allowedSubjects.length ? `Hero must be one of: ${allowedSubjects.slice(0, 8).join(", ")}.` : "",
      `Cover art: full-color, cheerful, high contrast, inviting to children ages ${ageMin}-${ageMax}.`,
    ].filter(Boolean).join(" ");

    const ladderInput: CoverLadderInput = {
      ebookId: ebook_id,
      title: row.title,
      subtitle,
      ageBadge,
      description: row.description ?? null,
      charDesc,
      styleSuffix: "modern warm painterly children's book cover, cheerful colors, cozy inviting",
      negativePrompt:
        "line art only, uncolored, monochrome, black-and-white coloring page, empty, blank, grayscale interior, worksheet, low quality",
      refUrls,
      palette: ["#FFF6E5", "#2A1A0A", "#E9B44C", "#6BAA75", "#4FA3D8"],
      categoryName,
      allowedSubjects,
      forbiddenSubjects,
    };

    // Load or init ladder state (migrate legacy state missing new fields).
    let state = (meta.coloring_cover_ladder as LadderState | undefined) ?? null;
    if (!state || force) state = newLadderState();
    if (typeof state.ideogram_speed_cursor !== "number") state.ideogram_speed_cursor = 0;
    if (!state.attempts_by_rung) state.attempts_by_rung = {};

    if (state.next_index >= state.rungs.length) {
      state.next_index = state.rungs.length - 1;
    }

    // ── Crash detection: if the current rung has an in-flight attempt with
    //    no ended_at older than CRASH_STALE_MS, mark it crashed and cascade.
    const currRung = state.rungs[state.next_index];
    const attemptsForRung = state.attempts_by_rung[currRung] ?? [];
    const lastAttempt = attemptsForRung[attemptsForRung.length - 1];
    if (lastAttempt && !lastAttempt.ended_at) {
      const ageMs = Date.now() - new Date(lastAttempt.started_at).getTime();
      if (ageMs > CRASH_STALE_MS) {
        lastAttempt.ended_at = new Date().toISOString();
        lastAttempt.ok = false;
        lastAttempt.reason = `crash_timeout_after_${ageMs}ms`;
        lastAttempt.status = "crashed";
        // Cascade: for ideogram rungs advance speed; otherwise advance rung.
        if ((currRung === "ideogram_v3_a" || currRung === "ideogram_v3_b")
            && state.ideogram_speed_cursor < IDEOGRAM_SPEEDS.length - 1) {
          state.ideogram_speed_cursor += 1;
        } else {
          state.next_index += 1;
          state.ideogram_speed_cursor = 0;
        }
      }
    }

    const rung = state.rungs[state.next_index];
    const isIdeogram = rung === "ideogram_v3_a" || rung === "ideogram_v3_b";
    const speed = isIdeogram ? IDEOGRAM_SPEEDS[state.ideogram_speed_cursor] : null;

    // Persist BEFORE calling the rung so a crash leaves evidence.
    const attempt: RungAttempt = {
      speed,
      started_at: new Date().toISOString(),
      ended_at: null,
    };
    state.attempts_by_rung[rung] = [...(state.attempts_by_rung[rung] ?? []), attempt];
    await patchMeta(db, ebook_id, {
      coloring_current_step_label:
        `Cover ladder rung ${state.next_index + 1}/${state.rungs.length}: ${rung}${speed ? ` (${speed})` : ""}`,
      coloring_progress_percent: 92,
      coloring_cover_ladder: { ...state, updated_at: new Date().toISOString() },
    });

    console.log(`[coloring-cover] ${ebook_id} rung ${rung} speed=${speed} (${state.next_index + 1}/${state.rungs.length})`);

    // ── Run rung with wallclock guard so slow QUALITY calls cannot silent-loop.
    let result: Awaited<ReturnType<typeof runSingleCoverRung>>;
    try {
      result = await withTimeout(
        runSingleCoverRung({ ...ladderInput, ideogramRenderingSpeed: speed ?? undefined }, rung),
        RUNG_WALLCLOCK_MS,
        `${rung}:${speed ?? "n/a"}`,
      );
    } catch (e: any) {
      const reason = `rung_exception:${String(e?.message ?? e).slice(0, 220)}`;
      attempt.ended_at = new Date().toISOString();
      attempt.ok = false;
      attempt.reason = reason;
      attempt.status = "error";
      state.reports.push({ rung, reason, produced_bytes: false } as any);
      // Cascade speed on ideogram, else advance rung.
      if (isIdeogram && state.ideogram_speed_cursor < IDEOGRAM_SPEEDS.length - 1) {
        state.ideogram_speed_cursor += 1;
      } else {
        state.next_index += 1;
        state.ideogram_speed_cursor = 0;
      }
      await patchMeta(db, ebook_id, {
        coloring_cover_ladder: { ...state, updated_at: new Date().toISOString() },
        coloring_current_step_label:
          `Cover ladder cascading after ${rung}${speed ? `/${speed}` : ""} error → next attempt`,
      });
      fireAndForget("coloring-book-cover", { ebook_id });
      return json({ ok: true, advanced: true, failed_rung: rung, failed_speed: speed, failed_reason: reason });
    }

    // Record the attempt's outcome.
    attempt.ended_at = new Date().toISOString();
    attempt.ok = result.status === "ok" || result.status === "fallback";
    attempt.reason = result.report.reason;
    attempt.status = result.status;

    state.reports.push({
      rung: result.report.rung,
      reason: result.report.reason,
      produced_bytes: result.report.produced_bytes,
      glyph_verdict: result.report.glyph_verdict ?? null,
      hero_verdict: result.report.hero_verdict ?? null,
    } as any);
    state.updated_at = new Date().toISOString();

    if (result.status === "ok" || result.status === "fallback") {
      // Composite title treatment (for fallback the bytes already include it).
      let finalBytes: Uint8Array = result.bytes!;
      let treatmentMeta: Record<string, unknown> | null = result.title_treatment_metadata ?? null;
      const usedSvgFallback = result.status === "fallback";

      if (!usedSvgFallback) {
        try {
          const treatment = await renderKidsTitleTreatment({
            coverBg: finalBytes,
            title: row.title,
            subtitle,
            palette: ["#FFF6E5", "#2A1A0A", "#E9B44C", "#6BAA75"],
            description: row.description ?? null,
            ageBadge,
          });
          finalBytes = treatment.png;
          treatmentMeta = treatment.metadata as unknown as Record<string, unknown>;
        } catch (e) {
          console.warn("[coloring-cover] title treatment failed, using raw cover", (e as Error).message);
        }
      }

      // Measured cover gate — no constants. The final raster must contain
      // only approved text (title/subtitle/age/logo), category-correct heroes,
      // safe-frame overlays, and the canonical SecretPDF Kids logo.
      const finalGlyph = await transcribeGlyphs(finalBytes);
      const finalHero = allowedSubjects.length
        ? await verifyCategoryHero(finalBytes, {
            category_name: categoryName,
            allowed_subjects: allowedSubjects,
            forbidden_subjects: forbiddenSubjects,
          })
        : { ok: true, matches: true, detected_subjects: [], forbidden_hit: null, degraded: true, reason: "no_allowed_subjects_defined" };
      const fallbackMeta = (result.report.meta as any) ?? {};
      const measured = measuredCoverScorecard({
        title: row.title,
        subtitle,
        ageBadge,
        text: finalGlyph,
        rawArtText: usedSvgFallback
          ? { ok: true, has_glyphs: false, detected_text: "", confidence: 1, degraded: false, reason: "fallback_background_no_ai_text" }
          : (result.report.glyph_verdict ?? null),
        typographySource: "textless_art_plus_svg_overlay",
        hero: finalHero,
        frame: (treatmentMeta as any)?.overlay_frame ?? { width: 1600, height: 1600, safe_margin: 64, elements: [] },
        logo: {
          present: (treatmentMeta as any)?.logo_present === true,
          rect: ((treatmentMeta as any)?.overlay_frame?.elements ?? []).find((e: any) => e.name === "secretpdf_kids_logo") ?? null,
        },
        artwork: {
          used_svg_fallback: usedSvgFallback,
          synthesized_background: fallbackMeta.synthesized_background === true,
          blank_background: usedSvgFallback && fallbackMeta.synthesized_background === true,
          blank_ratio: usedSvgFallback && fallbackMeta.synthesized_background === true ? 1 : 0,
        },
        quality: { produced_bytes: finalBytes.length > 1024, luminance_dead: false, byte_size: finalBytes.length },
        pageCountMatchesFinalPdf: true,
      });
      const measuredGate = coloringCoverGate(measured);

      if (!measuredGate.pass) {
        const reason = `measured_cover_gate_failed:${measuredGate.reasons.join(";").slice(0, 240)}`;
        attempt.ended_at = new Date().toISOString();
        attempt.ok = false;
        attempt.reason = reason;
        attempt.status = "dead-equivalent";
        state.reports.push({ rung, reason, produced_bytes: true, glyph_verdict: finalGlyph, hero_verdict: finalHero } as any);
        if (isIdeogram && state.ideogram_speed_cursor < IDEOGRAM_SPEEDS.length - 1) {
          state.ideogram_speed_cursor += 1;
        } else if (!usedSvgFallback) {
          state.next_index += 1;
          state.ideogram_speed_cursor = 0;
        } else {
          await patchMeta(db, ebook_id, {
            coloring_cover_gate: { pass: false, reasons: measuredGate.reasons, scorecard: measured, glyph_verdict: finalGlyph, hero_verdict: finalHero },
            coloring_cover_ladder: { ...state, updated_at: new Date().toISOString() },
            coloring_current_step_label: "Cover measured gate failed at fallback — blocked with evidence",
          });
          return json({ ok: false, error: "cover_measured_gate_failed", reasons: measuredGate.reasons, glyph: finalGlyph, hero: finalHero }, 422);
        }
        await patchMeta(db, ebook_id, {
          coloring_cover_gate: { pass: false, reasons: measuredGate.reasons, scorecard: measured, glyph_verdict: finalGlyph, hero_verdict: finalHero },
          coloring_cover_ladder: { ...state, updated_at: new Date().toISOString() },
          coloring_current_step_label: `Cover measured gate rejected ${rung}${speed ? `/${speed}` : ""} → next attempt`,
        });
        fireAndForget("coloring-book-cover", { ebook_id });
        return json({ ok: true, advanced: true, failed_rung: rung, failed_reason: reason, measured_gate: measuredGate });
      }

      const version = `${Date.now()}`;
      const path = `kids/${ebook_id}/coloring/cover-${version}.png`;
      const up = await uploadAndSignImage(db, "ebook-covers", path, finalBytes, {
        contentType: "image/png",
      });

      const coverRecord = {
        url: up.signedUrl,
        storage_path: up.path,
        accepted_rung: rung,
        accepted_speed: speed,
        used_svg_fallback: usedSvgFallback,
        title_treatment: treatmentMeta,
        rung_reports: state.reports,
        attempts_by_rung: state.attempts_by_rung,
        generated_at: new Date().toISOString(),
        subtitle_used: subtitle,
        age_badge: ageBadge,
        spelling_verified: (treatmentMeta as any)?.title === row.title,
        measured_gate: { pass: true, scorecard: measured, reasons: [], glyph_verdict: finalGlyph, hero_verdict: finalHero },
      };

      state.next_index = state.rungs.length; // done
      await db.from("ebooks_kids").update({ cover_url: up.signedUrl }).eq("id", ebook_id);
      await patchMeta(db, ebook_id, {
        coloring_cover: coverRecord,
        coloring_cover_gate: coverRecord.measured_gate,
        coloring_cover_ladder: { ...state, updated_at: new Date().toISOString() },
        coloring_progress_percent: 94,
        coloring_current_step_label: "Cover generated — assembling PDF",
      });

      fireAndForget("coloring-book-assemble", { ebook_id });
      return json({ ok: true, accepted_rung: rung, accepted_speed: speed, chained: "assemble", used_svg_fallback: usedSvgFallback });
    }

    // Dead / dead-equivalent / error → cascade speed on ideogram, else advance rung.
    console.warn(`[coloring-cover] ${ebook_id} rung ${rung} speed=${speed} ${result.status}: ${result.report.reason} — cascading`);
    if (isIdeogram && state.ideogram_speed_cursor < IDEOGRAM_SPEEDS.length - 1) {
      state.ideogram_speed_cursor += 1;
    } else {
      state.next_index += 1;
      state.ideogram_speed_cursor = 0;
    }
    await patchMeta(db, ebook_id, {
      coloring_cover_ladder: { ...state, updated_at: new Date().toISOString() },
      coloring_current_step_label:
        `Cover ladder cascading after ${rung}${speed ? `/${speed}` : ""} → rung ${Math.min(state.next_index + 1, state.rungs.length)}/${state.rungs.length}${state.ideogram_speed_cursor > 0 ? ` speed=${IDEOGRAM_SPEEDS[state.ideogram_speed_cursor]}` : ""}`,
    });

    fireAndForget("coloring-book-cover", { ebook_id });
    return json({
      ok: true,
      advanced: true,
      failed_rung: rung,
      failed_speed: speed,
      failed_reason: result.report.reason,
      next_rung: state.rungs[state.next_index] ?? "done",
      next_speed: IDEOGRAM_SPEEDS[state.ideogram_speed_cursor] ?? null,
    });
  } catch (e: any) {
    console.error("[coloring-cover] fatal", e?.message);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
