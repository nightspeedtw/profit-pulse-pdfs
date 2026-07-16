// coloring-book-cover — generates the cover for a coloring book row.
//
// Contract:
//   • Called when ebooks_kids.metadata.awaiting='cover_pdf_publish' and
//     coloring_cover is absent OR chained by coloring-book-render on
//     completion. Idempotent: skips if cover already stored.
//   • Uses the unified kids cover ladder (Ideogram → Recraft → Gemini →
//     SVG synthetic fallback) so a coloring book can NEVER retire for a
//     dead cover.
//   • Composites the SVG title treatment overlay on top of the accepted
//     rung's artwork so the title/subtitle/age badge is legible + spelled.
//   • Uploads to `ebook-covers` bucket, sets ebook_kids.cover_url +
//     metadata.coloring_cover, then chains to coloring-book-assemble.
//
// Never lowers a gate, never appends duplicates.

// @ts-nocheck  Deno edge runtime
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { renderKidsCoverWithLadder } from "../_shared/covers/kids-cover-ladder.ts";
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

function chain(fn: string, body: Record<string, unknown>) {
  const doIt = async () => {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { ebook_id, force } = await req.json();
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: row, error } = await db.from("ebooks_kids")
      .select("id, book_type, title, subtitle, description, metadata, cover_url")
      .eq("id", ebook_id).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: "not_found" }, 404);
    if (row.book_type !== "coloring_book") return json({ error: "wrong_lane" }, 400);

    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    if (!force && meta.coloring_cover && row.cover_url) {
      // Already have a cover — advance the chain.
      chain("coloring-book-assemble", { ebook_id });
      return json({ ok: true, skipped: "cover_exists", chained: "assemble" });
    }

    // Pull one rendered interior page to use as visual reference (style/character coherence).
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

    await patchMeta(db, ebook_id, {
      coloring_current_step_label: "Generating cover artwork (ladder)",
      coloring_progress_percent: 92,
    });

    const charDesc = [
      `A charming, kid-friendly COVER for a coloring book titled "${row.title}".`,
      `Subject: ${categoryName}. Show 2-4 adorable characters/subjects from the theme in a warm painterly SCENE (COLOR artwork, NOT line-art — this is the printed cover shown in stores).`,
      `Cover art: full-color, cheerful, high contrast, inviting to children ages ${ageMin}-${ageMax}.`,
    ].join(" ");

    const ladder = await renderKidsCoverWithLadder({
      ebookId: ebook_id,
      title: row.title,
      subtitle: subtitle,
      description: row.description ?? null,
      charDesc,
      styleSuffix: "modern warm painterly children's book cover, cheerful colors, cozy inviting",
      negativePrompt:
        "line art only, uncolored, monochrome, black-and-white coloring page, empty, blank, grayscale interior, worksheet, low quality",
      refUrls,
      palette: ["#FFF6E5", "#2A1A0A", "#E9B44C", "#6BAA75", "#4FA3D8"],
    });

    // Composite the title treatment on top.
    const treatment = await renderKidsTitleTreatment({
      coverBg: ladder.bytes,
      title: row.title,
      subtitle: subtitle,
      palette: ["#FFF6E5", "#2A1A0A", "#E9B44C", "#6BAA75"],
      description: row.description ?? null,
      ageBadge,
    }).catch((e) => {
      console.warn("[coloring-cover] title treatment failed", (e as Error).message);
      return null as any;
    });

    const finalBytes: Uint8Array = treatment?.png ?? ladder.bytes;

    const version = `${Date.now()}`;
    const path = `kids/${ebook_id}/coloring/cover-${version}.png`;
    const up = await uploadAndSignImage(db, "ebook-covers", path, finalBytes, {
      contentType: "image/png",
    });

    const coverRecord = {
      url: up.signedUrl,
      storage_path: up.path,
      accepted_rung: ladder.accepted_rung,
      used_svg_fallback: ladder.used_svg_fallback,
      title_treatment: treatment?.metadata ?? null,
      rung_reports: ladder.rung_reports.map((r) => ({
        rung: r.rung, reason: r.reason, produced_bytes: r.produced_bytes,
      })),
      generated_at: new Date().toISOString(),
      subtitle_used: subtitle,
      age_badge: ageBadge,
      spelling_verified: (treatment?.metadata as any)?.title === row.title,
    };

    await db.from("ebooks_kids").update({
      cover_url: up.signedUrl,
    }).eq("id", ebook_id);
    await patchMeta(db, ebook_id, {
      coloring_cover: coverRecord,
      coloring_progress_percent: 94,
      coloring_current_step_label: "Cover generated — assembling PDF",
    });

    // Chain to assemble.
    chain("coloring-book-assemble", { ebook_id });

    return json({ ok: true, cover: coverRecord, chained: "assemble" });
  } catch (e: any) {
    console.error("[coloring-cover] fatal", e?.message);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
