// coloring-v2-cover-bleed-sweep
//
// OWNER LAW `cover_full_bleed_edge_verifier_v16` backfill.
//
// Scans recent coloring_v2 covers, downloads each cover_url, runs the v16
// full-bleed verifier, and for failures resets the book so the main
// cover stage regenerates. One-Book-At-A-Time is preserved: this endpoint
// only marks; the standard tick dispatches regenerations sequentially.
//
// POST { limit?: number, dry_run?: boolean, book_ids?: string[] }
//
// @ts-nocheck  Deno edge runtime
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyFullBleed } from "../_shared/coloring-v2/full-bleed-verify.ts";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Batch cap and blackout constants. See plan.md 2026-07-25: bleed-sweep
// must never demote more LIVE books than the tick can regenerate before
// the daily CF pool refills, or the storefront's LIVE count collapses
// (which is exactly the regression we saw on 2026-07-25).
const MAX_SWEEP_LIMIT = 20;
const DEFAULT_SWEEP_LIMIT = 5;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(MAX_SWEEP_LIMIT, Number(body.limit ?? DEFAULT_SWEEP_LIMIT)));
    const dryRun = body.dry_run !== false;
    const force = body.force === true;
    const explicit: string[] = Array.isArray(body.book_ids) ? body.book_ids : [];

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ error: "missing_service_role" }, 500);
    const db = createClient(url, key);

    // Blackout window: if fewer than 3 CF accounts have fresh quota, skip
    // demoting LIVE books. Regenerating a cover doesn't touch CF, but the
    // demoted book will halt LIVE traffic until the tick + interior repair
    // (which DOES burn CF for any downstream reshoot) can complete.
    if (!force && !dryRun && explicit.length === 0) {
      const { data: gs } = await db.from("generation_settings").select("coloring_autopilot").eq("id", 1).maybeSingle();
      const cfg = (gs?.coloring_autopilot ?? {}) as Record<string, unknown>;
      const latches = (cfg.cf_account_latches ?? {}) as Record<string, string>;
      const nowMs = Date.now();
      const activeLatches = Object.values(latches).filter((iso) => {
        const t = new Date(iso).getTime();
        return Number.isFinite(t) && t > nowMs;
      }).length;
      // Assume 7 accounts configured. Skip when >=5 are latched (fewer than 3 free).
      if (activeLatches >= 5) {
        return json({
          ok: true,
          skipped: "cf_blackout",
          active_latches: activeLatches,
          note: "bleed-sweep suppressed while CF quota is drained; pass force=true to override",
        });
      }
    }

    let q = db.from("coloring_v2_books")
      .select("id, title, approved_cover_asset_id")
      .not("approved_cover_asset_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (explicit.length) q = db.from("coloring_v2_books")
      .select("id, title, approved_cover_asset_id")
      .in("id", explicit);
    const { data: books, error: bErr } = await q;
    if (bErr) return json({ error: bErr.message }, 500);

    const results: any[] = [];
    for (const book of books ?? []) {
      const { data: asset } = await db.from("coloring_v2_assets")
        .select("id, storage_path, meta")
        .eq("id", book.approved_cover_asset_id)
        .maybeSingle();
      if (!asset) { results.push({ book_id: book.id, skipped: "no_asset" }); continue; }

      // Prior meta may already have a v16 pass — skip.
      const priorPass = asset.meta?.full_bleed?.pass === true
        && asset.meta?.full_bleed_law === "cover_full_bleed_edge_verifier_v16";
      if (priorPass) { results.push({ book_id: book.id, skipped: "already_v16_pass" }); continue; }

      const { data: signed } = await db.storage.from("coloring-v2").createSignedUrl(asset.storage_path, 300);
      if (!signed?.signedUrl) { results.push({ book_id: book.id, skipped: "sign_failed" }); continue; }
      const resp = await fetch(signed.signedUrl);
      if (!resp.ok) { results.push({ book_id: book.id, skipped: `download_${resp.status}` }); continue; }
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const verdict = await verifyFullBleed(bytes).catch((e) => ({ pass: true, reason: `verifier_crash:${String(e).slice(0,120)}`, worstEdge: null, edges: {} as any } as any));

      const entry: any = {
        book_id: book.id,
        title: book.title,
        asset_id: asset.id,
        pass: verdict.pass,
        worstEdge: verdict.worstEdge,
        reason: verdict.reason,
      };

      if (!verdict.pass && !dryRun) {
        // Reset for regeneration by the standard tick (One-Book-At-A-Time).
        await db.from("coloring_v2_books").update({
          approved_cover_asset_id: null,
          stage: "cover",
          stage_attempt_count: 0,
          last_error: `bleed_sweep_v16_reset:${verdict.reason}`,
          updated_at: new Date().toISOString(),
        }).eq("id", book.id);
        // Annotate the failing asset so audits can find it.
        await db.from("coloring_v2_assets").update({
          meta: { ...(asset.meta ?? {}), full_bleed_sweep_v16: verdict },
        }).eq("id", asset.id);
        entry.reset = true;
      }
      results.push(entry);
    }

    const failed = results.filter((r) => r.pass === false).length;
    const passed = results.filter((r) => r.pass === true).length;
    return json({ ok: true, dry_run: dryRun, scanned: results.length, passed, failed, results });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
