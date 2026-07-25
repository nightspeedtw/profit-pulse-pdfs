// coloring-v2-tick — safety-net dispatcher (LIGHTWEIGHT).
// Learn from V1 546 death: bounded scan (N slots, oldest-first, indexed),
// fire-and-forget dispatch inside EdgeRuntime.waitUntil, response returns
// in <5s regardless of stage-function latency. Never touches ebooks_kids.
// @ts-nocheck
import {
  acquireColoringV2ProductionLock,
  corsHeaders,
  db,
  fireStage,
  json,
  lockIsLive,
  readColoringV2ProductionLock,
} from "../_shared/coloring-v2/state.ts";
import { isColoringV2BookParked, pickClosestColoringV2Book } from "../_shared/coloring-v2/one-book.ts";
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

// Owner law: one-book-at-a-time. Finish the single closest-to-done book
// completely before starting or resuming another book.
const MAX_SLOTS = 1;

const ACTIVE_STAGES = ["concept", "style_bible", "page_plan", "interior_render", "cover", "qc", "pdf", "publish"];

async function countInteriors(bookId: string, pageCount: number): Promise<{ unique: number; total: number; next: number }> {
  const { data: got } = await db().from("coloring_v2_assets")
    .select("page_number").eq("book_id", bookId).eq("kind", "interior");
  const pages = (got ?? []).map((r: any) => Number(r.page_number)).filter((n: number) => Number.isFinite(n));
  const done = new Set(pages);
  let next = Math.max(1, pageCount);
  for (let p = 1; p <= pageCount; p++) if (!done.has(p)) { next = p; break; }
  return { unique: done.size, total: pages.length, next };
}

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

    // Bounded scan: choose the single closest-to-done non-terminal book.
    // This intentionally scans a bounded candidate set and ranks in-code so
    // page-progress can outrank stale older books.
    const cutoff = new Date(Date.now() - 90_000).toISOString();
    const { data: activeBooks, error: activeError } = await db().from("coloring_v2_books")
      .select("id, stage, page_count, stage_attempt_count, updated_at, stage_updated_at, final_pdf_asset_id")
      .in("stage", ACTIVE_STAGES)
      .neq("publish_status", "live")
      .lte("stage_updated_at", cutoff)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (activeError) throw activeError;

    let candidates = activeBooks ?? [];
    if (candidates.length === 0) {
      const { data: queuedBooks, error: queuedError } = await db().from("coloring_v2_books")
        .select("id, stage, page_count, stage_attempt_count, updated_at, stage_updated_at, final_pdf_asset_id")
        .eq("stage", "queued")
        .neq("publish_status", "live")
        .lte("stage_updated_at", cutoff)
        .order("stage_updated_at", { ascending: true })
        .limit(20);
      if (queuedError) throw queuedError;
      candidates = queuedBooks ?? [];
    }

    const interiorIds = candidates.filter((r: any) => r.stage === "interior_render").map((r: any) => r.id);
    const interiorCounts = new Map<string, { unique: number; total: number; next: number }>();
    if (interiorIds.length) {
      const { data: assetRows } = await db().from("coloring_v2_assets")
        .select("book_id, page_number")
        .in("book_id", interiorIds)
        .eq("kind", "interior");
      const byBook = new Map<string, number[]>();
      for (const a of assetRows ?? []) {
        const arr = byBook.get(a.book_id) ?? [];
        arr.push(Number(a.page_number));
        byBook.set(a.book_id, arr);
      }
      for (const row of candidates) {
        if (row.stage !== "interior_render") continue;
        const pageCount = Number(row.page_count ?? 32);
        const pages = (byBook.get(row.id) ?? []).filter((n: number) => Number.isFinite(n));
        const done = new Set(pages.filter((n: number) => n >= 1 && n <= pageCount));
        let next = Math.max(1, pageCount);
        for (let p = 1; p <= pageCount; p++) if (!done.has(p)) { next = p; break; }
        interiorCounts.set(row.id, { unique: done.size, total: pages.length, next });
      }
    }

    const enriched: any[] = candidates.map((row: any) => {
      const counts = interiorCounts.get(row.id) ?? { unique: 0, total: 0, next: 1 };
      return { ...row, interiors_done: counts.unique, interiors_total: counts.total, next_page: counts.next };
    });

    const heldLock = await readColoringV2ProductionLock();
    let selected = null;
    if (lockIsLive(heldLock)) {
      const held = enriched.find((b) => b.id === heldLock.holder) ?? null;
      // Regression 2026-07-25: if the lock-holder itself is parked
      // (awaiting_quota_reset), release the lock so tick can pick a
      // workable book instead of spinning against the parked holder.
      if (held && isColoringV2BookParked(held)) {
        try { await (await import("../_shared/coloring-v2/state.ts")).releaseColoringV2ProductionLock(held.id); } catch (_) { /* best-effort */ }
        selected = pickClosestColoringV2Book(enriched);
      } else {
        selected = held;
        if (!selected) {
          const { data: holderRow } = await db().from("coloring_v2_books")
            .select("id, stage, page_count, stage_attempt_count, updated_at, stage_updated_at, last_error, final_pdf_asset_id")
            .eq("id", heldLock.holder)
            .neq("publish_status", "live")
            .maybeSingle();
          if (!holderRow || !STAGE_TO_FN[holderRow.stage] || isColoringV2BookParked(holderRow as any)) {
            if (holderRow && isColoringV2BookParked(holderRow as any)) {
              try { await (await import("../_shared/coloring-v2/state.ts")).releaseColoringV2ProductionLock(holderRow.id); } catch (_) { /* */ }
            }
            return json({ ok: true, waiting_for_lock_holder: heldLock.holder, lock_expires_at: heldLock.expires_at, slots: 0, elapsed_ms: Date.now() - started });
          }
          let counts = { unique: 0, total: 0, next: 1 };
          if (holderRow.stage === "interior_render") {
            counts = await countInteriors(holderRow.id, Number(holderRow.page_count ?? 32));
          }
          selected = { ...holderRow, interiors_done: counts.unique, interiors_total: counts.total, next_page: counts.next };
        }
      }
    } else {
      selected = pickClosestColoringV2Book(enriched);
    }

    const books = selected ? [selected].slice(0, MAX_SLOTS) : [];

    // Dispatch inside waitUntil so the response returns immediately.
    const plan = (books ?? []).map((b: any) => ({
      book_id: b.id,
      stage: b.stage,
      page_count: b.page_count,
      next_page: b.next_page,
      interiors_done: b.interiors_done,
    }));
    const dispatchWork = (async () => {
      for (const b of plan) {
        const fn = STAGE_TO_FN[b.stage];
        if (!fn) continue;
        const lock = await acquireColoringV2ProductionLock(b.book_id);
        if (!lock.acquired) continue;
        const body: Record<string, unknown> = { book_id: b.book_id, chain_owner_book_id: b.book_id };
        if (b.stage === "interior_render") {
          body.page_number = b.next_page;
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
