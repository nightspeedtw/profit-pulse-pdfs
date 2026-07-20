// coloring-v2-tick — safety-net dispatcher (LIGHTWEIGHT).
// Learn from V1 546 death: bounded scan (N slots, oldest-first, indexed),
// fire-and-forget dispatch inside EdgeRuntime.waitUntil, response returns
// in <5s regardless of stage-function latency. Never touches ebooks_kids.
// @ts-nocheck
import { corsHeaders, db, fireStage, json } from "../_shared/coloring-v2/state.ts";
import { FEATURES } from "../_shared/features.ts";

declare const Deno: any;
declare const EdgeRuntime: any;

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

// Bounded slot count — never scan the whole table.
const MAX_SLOTS = 6;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const started = Date.now();
  try {
    if (!FEATURES.ENABLE_COLORING_LANE_V2) return json({ ok: true, disabled: true });

    // Real flag lives in DB (data-only cutover). Code flag is a floor.
    const [{ data: flagRow }, { data: frozenRow }] = await Promise.all([
      db().from("platform_settings").select("value_json").eq("key", "ENABLE_COLORING_LANE_V2").maybeSingle(),
      db().from("platform_settings").select("value_json").eq("key", "autopilot_frozen").maybeSingle(),
    ]);
    const flagEnabled = flagRow?.value_json?.enabled !== false; // default true unless explicitly disabled
    if (!flagEnabled) return json({ ok: true, disabled_by_flag: true });
    const frozen = frozenRow?.value_json === true || frozenRow?.value_json === "true" || frozenRow?.value_json?.frozen === true;
    if (frozen) return json({ ok: true, frozen: true });

    // Bounded scan: MAX_SLOTS oldest non-terminal, non-live books that
    // have been idle >90s. Indexed on stage_updated_at.
    const cutoff = new Date(Date.now() - 90_000).toISOString();
    const { data: books, error } = await db().from("coloring_v2_books")
      .select("id, stage, page_count")
      .neq("stage", "failed")
      .neq("publish_status", "live")
      .lte("stage_updated_at", cutoff)
      .lt("stage_attempt_count", 8)
      .order("stage_updated_at", { ascending: true })
      .limit(MAX_SLOTS);
    if (error) throw error;

    // Dispatch inside waitUntil so the response returns immediately.
    const plan = (books ?? []).map((b: any) => ({ book_id: b.id, stage: b.stage, page_count: b.page_count }));
    const dispatchWork = (async () => {
      for (const b of plan) {
        const fn = STAGE_TO_FN[b.stage];
        if (!fn) continue;
        const body: Record<string, unknown> = { book_id: b.book_id };
        if (b.stage === "interior_render") {
          const { data: got } = await db().from("coloring_v2_assets")
            .select("page_number").eq("book_id", b.book_id).eq("kind", "interior");
          const done = new Set((got ?? []).map((r: any) => r.page_number));
          let next = 1;
          for (let p = 1; p <= (b.page_count ?? 32); p++) if (!done.has(p)) { next = p; break; }
          body.page_number = next;
        }
        // fireStage is already fire-and-forget with a short timeout via .catch(()=>{}).
        await fireStage(fn, body);
      }
    })();
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(dispatchWork);
    } else {
      // best-effort local drain; still non-blocking on response
      void dispatchWork;
    }

    return json({ ok: true, slots: plan.length, planned: plan, elapsed_ms: Date.now() - started });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e), elapsed_ms: Date.now() - started }, 500);
  }
});
