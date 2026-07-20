// coloring-v2-tick — safety-net dispatcher. Cron-hits this; it picks up any
// V2 book whose stage is not terminal and re-fires the matching stage
// function. Idempotent: each stage function no-ops if not in its stage.
// @ts-nocheck
import { corsHeaders, db, fireStage, json } from "../_shared/coloring-v2/state.ts";
import { FEATURES } from "../_shared/features.ts";

declare const Deno: any;

const STAGE_TO_FN: Record<string, string> = {
  queued: "coloring-v2-concept",
  concept: "coloring-v2-concept",
  style_bible: "coloring-v2-style-bible",
  page_plan: "coloring-v2-page-plan",
  interior_render: "coloring-v2-render-page",
  cover: "coloring-v2-cover",
  qc: "coloring-v2-qc",
  pdf: "coloring-v2-pdf",
  publish: "coloring-v2-publish",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  try {
    if (!FEATURES.ENABLE_COLORING_LANE_V2) return json({ ok: true, disabled: true });

    // Frozen kill-switch
    const { data: frozenRow } = await db().from("platform_settings").select("value").eq("key", "autopilot_frozen").maybeSingle();
    if (frozenRow?.value === true || frozenRow?.value === "true") {
      return json({ ok: true, frozen: true });
    }

    // Pick books not in terminal stages that haven't advanced in >2 minutes
    const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
    const { data: books, error } = await db().from("coloring_v2_books")
      .select("id, stage, page_count, stage_attempt_count")
      .not("stage", "in", "(failed)")
      .neq("publish_status", "live")
      .lte("stage_updated_at", cutoff)
      .lt("stage_attempt_count", 6)
      .order("stage_updated_at", { ascending: true })
      .limit(5);
    if (error) throw error;

    const fired: any[] = [];
    for (const b of (books ?? [])) {
      const fn = STAGE_TO_FN[b.stage];
      if (!fn) continue;
      const body: Record<string, unknown> = { book_id: b.id };
      if (b.stage === "interior_render") {
        // find first missing page
        const { data: got } = await db().from("coloring_v2_assets")
          .select("page_number").eq("book_id", b.id).eq("kind", "interior");
        const done = new Set((got ?? []).map((r: any) => r.page_number));
        let next = 1;
        for (let p = 1; p <= b.page_count; p++) if (!done.has(p)) { next = p; break; }
        body.page_number = next;
      }
      await fireStage(fn, body);
      fired.push({ book_id: b.id, stage: b.stage, fn });
    }
    return json({ ok: true, fired });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
