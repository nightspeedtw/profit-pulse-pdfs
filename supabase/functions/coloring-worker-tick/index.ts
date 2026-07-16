// coloring-worker-tick — the DEDICATED dispatcher for the coloring queue.
// Scans book_type='coloring_book' + pipeline_status='queued', respects
// coloring-only pause + parallelism cap, and hands each row to
// coloring-book-render. Independent of picture-book state.
//
// Body: { manual?: boolean, passcode?: string }

// @ts-nocheck
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-passcode",
};

const PASSCODE = Deno.env.get("ADMIN_PASSCODE") ?? "453451";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service, { auth: { persistSession: false } });
  const result: Record<string, unknown> = { tick_at: new Date().toISOString(), dispatched: [] };

  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* cron */ }
    const manual = !!body.manual;
    if (manual) {
      const supplied = req.headers.get("x-admin-passcode") ?? body?.passcode ?? "";
      if (supplied !== PASSCODE) return json({ error: "unauthenticated" }, 401);
    }

    const { data: gs } = await db
      .from("generation_settings").select("coloring_autopilot").eq("id", 1).maybeSingle();
    const cfg = gs?.coloring_autopilot ?? {};
    if (cfg.paused) {
      result.skipped = "engine_paused";
      await recordTick(db, result);
      return json(result);
    }

    const maxParallel = Math.max(1, Number(cfg.max_parallel ?? 1));
    const { count: inFlight } = await db
      .from("ebooks_kids")
      .select("id", { count: "exact", head: true })
      .eq("book_type", "coloring_book")
      .eq("pipeline_status", "generating");
    result.in_flight = inFlight ?? 0;
    const slots = Math.max(0, maxParallel - (inFlight ?? 0));
    result.slots = slots;
    if (slots === 0) {
      result.skipped = "at_parallelism_cap";
      await recordTick(db, result);
      return json(result);
    }

    const { data: queued } = await db
      .from("ebooks_kids")
      .select("id, title, metadata, pdf_url, cover_url")
      .eq("book_type", "coloring_book")
      .eq("pipeline_status", "queued")
      .order("created_at", { ascending: true })
      .limit(slots);
    result.queue_size = queued?.length ?? 0;

    // Route each queued coloring row to the correct stage based on `awaiting`:
    //   'cover_pdf_publish'          → coloring-book-cover (chains → assemble → publish)
    //   'publish'                    → coloring-book-publish
    //   otherwise                    → coloring-book-render (interior)
    // NOTE: 'owner_calibration_review' and 'owner_final_verification' pins
    // are REMOVED — calibration is auto-approved by the gates and publish
    // is auto-chained. Any legacy row still carrying those awaits is routed
    // back to its natural stage (render or publish) so it flows without wait.
    for (const row of queued ?? []) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const awaiting = meta.awaiting as string | undefined;
      let target = "coloring-book-render";
      if (awaiting === "cover_pdf_publish") {
        target = row.cover_url ? (row.pdf_url ? "coloring-book-publish" : "coloring-book-assemble") : "coloring-book-cover";
      } else if (awaiting === "publish" || awaiting === "owner_final_verification") {
        // owner_final_verification is a legacy human-hold pin — treat as ready-to-publish.
        target = row.pdf_url ? "coloring-book-publish" : "coloring-book-assemble";
      }
      // 'owner_calibration_review' legacy pin: fall through to coloring-book-render;
      // the render function will detect calibration-complete and auto-approve.
      const r = await fetch(`${url}/functions/v1/${target}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${service}`,
          apikey: service,
        },
        body: JSON.stringify({ ebook_id: row.id }),
      });
      const j = await r.json().catch(() => ({}));
      (result.dispatched as unknown[]).push({
        ebook_id: row.id, title: row.title, target, ok: r.ok, status: r.status,
        note: j?.note ?? j?.error ?? null,
      });
    }

    await recordTick(db, result);
    return json(result);
  } catch (e: any) {
    result.error = e?.message ?? String(e);
    await recordTick(db, result);
    return json(result, 500);
  }
});

async function recordTick(db: any, result: Record<string, unknown>) {
  try {
    const { data: gs } = await db.from("generation_settings").select("coloring_autopilot").eq("id", 1).maybeSingle();
    const merged = { ...(gs?.coloring_autopilot ?? {}), last_worker_tick_at: new Date().toISOString(), last_worker_tick_result: result };
    await db.from("generation_settings").update({ coloring_autopilot: merged }).eq("id", 1);
  } catch { /* non-fatal */ }
}

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
