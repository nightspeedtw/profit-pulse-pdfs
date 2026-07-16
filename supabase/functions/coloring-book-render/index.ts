// coloring-book-render — STUB step for the coloring lane.
// P0 freeze: the real page/cover/PDF pipeline is post-P0. This stub
// flips a queued row into `generating`, records a note, then returns
// it to `queued` with an "awaiting_post_p0" flag so the state machine
// is observable without touching P0 production code paths.
//
// Body: { ebook_id: string }

// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { ebook_id } = await req.json();
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: row, error } = await db.from("ebooks_kids")
      .select("id, book_type, pipeline_status, metadata")
      .eq("id", ebook_id).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: "not_found" }, 404);
    if (row.book_type !== "coloring_book") {
      return json({ error: "wrong_lane", note: "coloring-book-render only accepts book_type=coloring_book" }, 400);
    }

    // Mark generating briefly for observability.
    await db.from("ebooks_kids").update({
      pipeline_status: "generating",
      metadata: { ...(row.metadata ?? {}), coloring_render_started_at: new Date().toISOString() },
    }).eq("id", ebook_id);

    // Post-P0: real render happens here. For now, return to queue with a
    // sticky note so the admin panel shows the reason clearly.
    await db.from("ebooks_kids").update({
      pipeline_status: "queued",
      metadata: {
        ...(row.metadata ?? {}),
        coloring_render_last_attempt_at: new Date().toISOString(),
        awaiting: "post_p0_coloring_render_engine",
      },
    }).eq("id", ebook_id);

    return json({ ok: true, ebook_id, note: "stub: awaiting post-P0 coloring render engine" });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
