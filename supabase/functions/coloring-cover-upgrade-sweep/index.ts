// coloring-cover-upgrade-sweep
//
// OWNER LAW 'cover_can_never_fail' — auto-upgrade refinement:
//   Rung-2 self-art fallback is INSURANCE so a book can sell today.
//   This sweeper piggybacks on the worker tick and retries rung 1
//   (the painterly AI cover) for books wearing a fallback. On success,
//   `coloring-book-cover` atomically swaps cover_url + thumbnail_url and
//   clears cover_upgrade_pending. On failure, the existing cover is
//   untouched (sale continuity guaranteed).
//
// Contract:
//   - max 1 upgrade attempt / book / 24h (throttled by cover_upgrade_last_attempt_at)
//   - max N books per invocation (small batch — piggyback, not a heavy job)
//   - books must have cover_upgrade_pending=true (set only on rung-2 accept)

// @ts-nocheck  Deno edge runtime
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH = 3;

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batchSize = Math.min(10, Math.max(1, body?.batch_size ?? DEFAULT_BATCH));
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Pull candidates: coloring books flagged for upgrade. We check the
    // 24h throttle in-code because metadata is JSONB.
    const { data: rows, error } = await db.from("ebooks_kids")
      .select("id, title, metadata, cover_url")
      .eq("book_type", "coloring_book")
      .contains("metadata", { cover_upgrade_pending: true })
      .limit(50);
    if (error) throw error;

    const now = Date.now();
    const eligible = (rows ?? []).filter((r: any) => {
      const last = r.metadata?.cover_upgrade_last_attempt_at;
      if (!last) return true;
      return now - Date.parse(last) >= DAY_MS;
    }).slice(0, batchSize);

    const results: any[] = [];
    for (const r of eligible) {
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/coloring-book-cover`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
            apikey: SERVICE_KEY,
          },
          body: JSON.stringify({ ebook_id: r.id, force: true, mode: "upgrade" }),
        });
        const outcome = await resp.json().catch(() => ({}));
        results.push({ ebook_id: r.id, title: r.title, status: resp.status, outcome });
      } catch (e: any) {
        results.push({ ebook_id: r.id, error: e?.message ?? String(e) });
      }
    }
    return json({ ok: true, considered: rows?.length ?? 0, eligible: eligible.length, results });
  } catch (e: any) {
    console.error("[coloring-cover-upgrade-sweep] fatal", e?.message);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
