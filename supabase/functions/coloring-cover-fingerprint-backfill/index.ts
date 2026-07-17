// One-shot backfill: computes visual_fingerprint for every coloring-book
// cover that doesn't have one yet. Idempotent — safe to re-run. Bounded to
// 40 books per invocation so a single run stays within edge-function
// wall-clock limits.

// @ts-nocheck  Deno edge runtime
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { computeCoverFingerprint } from "../_shared/coloring/cover-uniqueness.ts";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await db
    .from("ebooks_kids")
    .select("id, title, cover_url, metadata")
    .eq("book_type", "coloring_book")
    .not("cover_url", "is", null)
    .limit(200);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const results: any[] = [];
  let processed = 0;
  for (const row of (data ?? [])) {
    if (processed >= 40) break;
    const existing = row?.metadata?.coloring_cover?.visual_fingerprint;
    if (existing?.hash) {
      results.push({ id: row.id, skipped: "already_has_fp" });
      continue;
    }
    try {
      const res = await fetch(row.cover_url);
      if (!res.ok) { results.push({ id: row.id, error: `fetch_${res.status}` }); continue; }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const fp = await computeCoverFingerprint(bytes);
      const nextMeta = {
        ...(row.metadata ?? {}),
        coloring_cover: {
          ...((row.metadata as any)?.coloring_cover ?? {}),
          visual_fingerprint: fp,
        },
      };
      const { error: upErr } = await db.from("ebooks_kids").update({ metadata: nextMeta }).eq("id", row.id);
      if (upErr) { results.push({ id: row.id, error: `update_${upErr.message}` }); continue; }
      results.push({ id: row.id, title: row.title, hash: fp.hash });
      processed++;
    } catch (e: any) {
      results.push({ id: row.id, error: String(e?.message ?? e).slice(0, 200) });
    }
  }
  return new Response(JSON.stringify({ ok: true, processed, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
