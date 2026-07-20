// coloring-v2-page-plan — plans N distinct interior pages.
// @ts-nocheck
import { advance, callAiJson, corsHeaders, db, fetchBook, fireStage, json, recordError } from "../_shared/coloring-v2/state.ts";
import { buildPagePlanPrompt, PAGE_PLAN_SYSTEM, buildInteriorImagePrompt } from "../_shared/coloring-v2/prompts.ts";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const { book_id } = await req.json().catch(() => ({}));
  if (!book_id) return json({ error: "book_id required" }, 400);
  try {
    const book = await fetchBook(book_id);
    if (book.stage !== "page_plan") return json({ ok: true, skipped: true, stage: book.stage });

    const { data: conceptAsset } = await db().from("coloring_v2_assets")
      .select("meta").eq("book_id", book_id).eq("kind", "concept").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: bibleRow } = await db().from("coloring_v2_style_bibles")
      .select("bible").eq("book_id", book_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const concept = conceptAsset?.meta ?? { title: book.title };
    const styleBible = bibleRow?.bible ?? {};

    const plan = await callAiJson(
      buildPagePlanPrompt(concept, styleBible, book.age_band, book.page_count),
      PAGE_PLAN_SYSTEM,
    );
    const pages = Array.isArray(plan?.pages) ? plan.pages : [];
    if (pages.length !== book.page_count) {
      throw new Error(`page_plan returned ${pages.length} pages, expected ${book.page_count}`);
    }

    // Persist each page, pre-render the interior prompt so render-page can just fetch it.
    const rows = pages.map((p: any, i: number) => ({
      book_id,
      page_number: p.page_number ?? (i + 1),
      purpose: p.purpose ?? "scene",
      scene: p.scene ?? "",
      focal_subject: p.focal_subject ?? "",
      action: p.action ?? "",
      supporting: p.supporting ?? "",
      framing: p.framing ?? "mid",
      detail_target: p.detail_target ?? "",
      continuity: p.continuity ?? "",
      forbidden: p.forbidden ?? "",
      prompt: buildInteriorImagePrompt(p, styleBible, book.age_band),
      fingerprint: `${p.focal_subject ?? ""}|${p.framing ?? ""}`.slice(0, 200),
    }));
    // clear old plans just in case (idempotent replay)
    await db().from("coloring_v2_page_plans").delete().eq("book_id", book_id);
    const { error } = await db().from("coloring_v2_page_plans").insert(rows);
    if (error) throw error;

    await advance(book_id, "page_plan", "interior_render");
    await fireStage("coloring-v2-render-page", { book_id, page_number: 1 });
    return json({ ok: true, pages: rows.length });
  } catch (e: any) {
    await recordError(book_id, "page_plan", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
