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

interface LadderState {
  rungs: CoverRungLabel[];
  next_index: number;
  reports: Array<Pick<CoverLadderRungReport, "rung" | "reason" | "produced_bytes">>;
  started_at: string;
  updated_at: string;
}

function newLadderState(): LadderState {
  const now = new Date().toISOString();
  return {
    rungs: [...DEFAULT_COVER_RUNGS],
    next_index: 0,
    reports: [],
    started_at: now,
    updated_at: now,
  };
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
    if (!force && meta.coloring_cover && row.cover_url) {
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

    // Load or init ladder state.
    let state = (meta.coloring_cover_ladder as LadderState | undefined) ?? null;
    if (!state || force) state = newLadderState();

    // Sanity guard
    if (state.next_index >= state.rungs.length) {
      // Should not happen (SVG rung is terminal), but reset to fallback rung
      state.next_index = state.rungs.length - 1;
    }

    const rung = state.rungs[state.next_index];
    await patchMeta(db, ebook_id, {
      coloring_current_step_label: `Cover ladder rung ${state.next_index + 1}/${state.rungs.length}: ${rung}`,
      coloring_progress_percent: 92,
      coloring_cover_ladder: { ...state, updated_at: new Date().toISOString() },
    });

    console.log(`[coloring-cover] ${ebook_id} running rung ${rung} (${state.next_index + 1}/${state.rungs.length})`);

    const result = await runSingleCoverRung(ladderInput, rung);
    state.reports.push({
      rung: result.report.rung,
      reason: result.report.reason,
      produced_bytes: result.report.produced_bytes,
    });
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

      const version = `${Date.now()}`;
      const path = `kids/${ebook_id}/coloring/cover-${version}.png`;
      const up = await uploadAndSignImage(db, "ebook-covers", path, finalBytes, {
        contentType: "image/png",
      });

      const coverRecord = {
        url: up.signedUrl,
        storage_path: up.path,
        accepted_rung: rung,
        used_svg_fallback: usedSvgFallback,
        title_treatment: treatmentMeta,
        rung_reports: state.reports,
        generated_at: new Date().toISOString(),
        subtitle_used: subtitle,
        age_badge: ageBadge,
        spelling_verified: (treatmentMeta as any)?.title === row.title,
      };

      state.next_index = state.rungs.length; // done
      await db.from("ebooks_kids").update({ cover_url: up.signedUrl }).eq("id", ebook_id);
      await patchMeta(db, ebook_id, {
        coloring_cover: coverRecord,
        coloring_cover_ladder: { ...state, updated_at: new Date().toISOString() },
        coloring_progress_percent: 94,
        coloring_current_step_label: "Cover generated — assembling PDF",
      });

      fireAndForget("coloring-book-assemble", { ebook_id });
      return json({ ok: true, accepted_rung: rung, chained: "assemble", used_svg_fallback: usedSvgFallback });
    }

    // Dead or error → advance and self-invoke to run next rung.
    console.warn(`[coloring-cover] ${ebook_id} rung ${rung} ${result.status}: ${result.report.reason} — advancing`);
    state.next_index += 1;
    await patchMeta(db, ebook_id, {
      coloring_cover_ladder: { ...state, updated_at: new Date().toISOString() },
      coloring_current_step_label: `Cover ladder advancing → rung ${Math.min(state.next_index + 1, state.rungs.length)}/${state.rungs.length}`,
    });

    fireAndForget("coloring-book-cover", { ebook_id });
    return json({
      ok: true,
      advanced: true,
      failed_rung: rung,
      failed_reason: result.report.reason,
      next_rung: state.rungs[state.next_index] ?? "done",
    });
  } catch (e: any) {
    console.error("[coloring-cover] fatal", e?.message);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
