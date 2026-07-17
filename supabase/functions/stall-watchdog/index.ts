// stall-watchdog — enforces the global Stall SLA on both lanes.
//
// Cron-safe: no body required. Scans EVERY non-terminal ebooks_kids row
// (both picture_book and coloring_book) whose progress evidence has not
// advanced in STALL_THRESHOLD_MS. For each stall it (1) writes a
// stall_event BEFORE reacting, (2) applies exactly one wired reaction,
// and (3) flags repeat_after_fix when a pipeline_skills entry already
// claims the blocker_class is fixed.
//
// This function replaces "silent idle" with observable, machine-readable
// evidence. It NEVER lowers a QC threshold.

// @ts-nocheck  Deno edge runtime
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  decideReaction,
  isRepeatAfterFix,
  STALL_THRESHOLD_MS,
  TERMINAL_STATUSES,
} from "../_shared/stall-sla.ts";
import { CURRENT_COLORING_REPAIR_REGIME } from "../_shared/coloring/repair-regime.ts";

declare const Deno: any;
const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-passcode",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PASSCODE = Deno.env.get("ADMIN_PASSCODE") ?? "453451";

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fireAndForget(fn: string, body: Record<string, unknown>) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
      body: JSON.stringify(body),
    });
  } catch (e) { console.error(`[stall-watchdog] chain ${fn} failed`, (e as Error).message); }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let manual = false;
  try {
    const body = await req.clone().json().catch(() => ({}));
    manual = !!body?.manual;
    if (manual) {
      const supplied = req.headers.get("x-admin-passcode") ?? body?.passcode ?? "";
      if (supplied !== PASSCODE) return json({ error: "unauthenticated" }, 401);
    }
  } catch { /* cron path */ }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const now = Date.now();
  const cutoff = new Date(now - STALL_THRESHOLD_MS).toISOString();

  // Load candidates: any non-terminal row not touched in threshold window.
  // AMENDMENT: pipeline_status='published' is only terminal when the book
  // is FULLY LIVE (pdf_url + cover_url + listing_status='live'). A
  // 'published' row missing pdf_url is non-terminal by DB invariant
  // (ebooks_kids_live_assets_guard) — it MUST be scanned for stalls.
  const nonPublishedTerminals = [...TERMINAL_STATUSES].filter((s) => s !== "published");
  const { data: rowsA, error } = await db
    .from("ebooks_kids")
    .select("id, book_type, pipeline_status, metadata, cover_url, pdf_url, listing_status, updated_at")
    .not("pipeline_status", "in", `(${nonPublishedTerminals.map(s => `"${s}"`).join(",")})`)
    .lt("updated_at", cutoff)
    .limit(200);
  if (error) return json({ error: error.message }, 500);
  // Filter out fully-live published rows (true terminal).
  const rows = (rowsA ?? []).filter((r: any) => !(
    r.pipeline_status === "published" && r.pdf_url && r.cover_url && r.listing_status === "live"
  ));

  const detected: unknown[] = [];
  const reacted: unknown[] = [];

  // Preload skill defect classes for repeat-after-fix detection.
  const { data: skills } = await db.from("pipeline_skills").select("metadata");
  const skillList = (skills ?? []).map((s: any) => ({ metadata: s.metadata ?? {} }));

  for (const row of rows ?? []) {
    const decision = decideReaction(row as any, now, CURRENT_COLORING_REPAIR_REGIME);
    if (!decision.is_stalled) continue;
    const repeat = isRepeatAfterFix(decision.blocker_class, skillList);

    // 1. WRITE stall_event FIRST (silent idle = impossible by construction).
    const { data: inserted } = await db.from("stall_events").insert({
      ebook_id: row.id,
      book_type: row.book_type,
      pipeline_status: row.pipeline_status,
      awaiting: decision.awaiting,
      step_label: decision.step_label,
      blocker_class: decision.blocker_class,
      reaction: decision.reaction,
      repeat_after_fix: repeat,
      regime_version: decision.regime_version,
      evidence: decision.evidence,
      stall_age_seconds: Math.round(decision.age_ms / 1000),
    }).select("id").maybeSingle();
    detected.push({ ebook_id: row.id, class: decision.blocker_class, age_min: Math.round(decision.age_ms / 60_000), repeat });

    // 2. Apply the wired reaction.
    if (decision.reaction === "advance_regime") {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const deadPages = ((meta as any).coloring_dead_pages as number[] | undefined) ?? [];
      const attempts = { ...(((meta as any).coloring_repair_attempts as Record<string, number>) ?? {}) };
      for (const p of deadPages) attempts[String(p)] = 0;
      const merged = {
        ...meta,
        coloring_repair_attempts: attempts,
        coloring_last_requeued_regime_version: CURRENT_COLORING_REPAIR_REGIME,
        coloring_regime_version: CURRENT_COLORING_REPAIR_REGIME,
        coloring_last_requeued_at: new Date().toISOString(),
        awaiting: "render",
        coloring_current_step_label: `Stall-SLA requeue under regime ${CURRENT_COLORING_REPAIR_REGIME}`,
      };
      await db.from("ebooks_kids").update({
        pipeline_status: "queued", blocker_reason: null, metadata: merged,
      }).eq("id", row.id);
      await fireAndForget("coloring-book-render", { ebook_id: row.id });
      reacted.push({ ebook_id: row.id, reaction: "advance_regime" });
    } else if (decision.reaction === "resume_checkpoint") {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const awaiting = meta.awaiting as string | undefined;
      const target = row.book_type === "coloring_book"
        ? (awaiting === "cover_pdf_publish"
            ? (row.cover_url ? (row.pdf_url ? "coloring-book-publish" : "coloring-book-assemble") : "coloring-book-cover")
            : (awaiting === "publish" ? "coloring-book-publish" : "coloring-book-render"))
        : "kids-repair-supervisor";
      await db.from("ebooks_kids").update({
        pipeline_status: "queued", blocker_reason: null,
        metadata: { ...meta, coloring_current_step_label: `Stall-SLA resume → ${target}` },
      }).eq("id", row.id);
      await fireAndForget(target, { ebook_id: row.id });
      reacted.push({ ebook_id: row.id, reaction: "resume_checkpoint", target });
    } else {
      // surface_blocker: persist machine-readable blocker; do not silently retry.
      await db.from("ebooks_kids").update({
        blocker_reason: `stall_sla:${decision.blocker_class}:${Math.round(decision.age_ms / 60_000)}m`,
      }).eq("id", row.id);
      reacted.push({ ebook_id: row.id, reaction: "surface_blocker" });
    }

    if (repeat && inserted?.id) {
      console.warn(`[stall-watchdog] repeat_after_fix class=${decision.blocker_class} ebook=${row.id}`);
    }
  }

  return json({
    ok: true, scanned: rows?.length ?? 0, detected: detected.length,
    threshold_ms: STALL_THRESHOLD_MS, events: detected, reacted,
  });
});
