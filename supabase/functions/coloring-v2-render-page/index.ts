// coloring-v2-render-page — renders one page then chains to the next.
// When all pages are done, advances to `cover` and fires the cover stage.
//
// Anatomy gate (coloring_v2_anatomy_gate_v1, 2026-07-22):
// Every attempt goes through checkPageAnatomy BEFORE uploadAsset. Failing
// verdicts trigger a retry with defect-specific negative prompt clauses.
// After MAX_ATTEMPTS real defects, the book is parked at stage='failed'
// with last_error='anatomy_unrecoverable_page_N' so credits stop burning.
// A degraded verdict (verifier outage) uploads normally and marks
// metadata.anatomy_unmeasured=true — the QC safety net will re-check.
// @ts-nocheck
import { acquireColoringV2ProductionLock, advance, chainOwnerMatches, corsHeaders, db, fetchBook, fireStage, json, recordError, releaseColoringV2ProductionLock, uploadAsset } from "../_shared/coloring-v2/state.ts";
import { shouldSpendForRenderPage } from "../_shared/coloring-v2/one-book.ts";
import { INTERIOR_NEGATIVE_PROMPT } from "../_shared/coloring-v2/prompts.ts";
import { renderImageWithFallback } from "../_shared/coloring-v2/image-fallback.ts";
import { checkPageAnatomy, defectsToNegativeClause } from "../_shared/coloring-v2/anatomy-check.ts";
import { FalBillingLockedError } from "../_shared/fal-billing.ts";

// Wake time for a parked book: next UTC midnight + small jitter, matching
// _shared/coloring/quota-park.ts. Cloudflare's daily neuron pool resets at
// 00:00 UTC — parking to that instant means the standard tick will pick
// this book back up as soon as fresh quota is available.
function nextCfResetWake(from: Date = new Date()): Date {
  const wake = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, 0, 0, 0));
  wake.setUTCSeconds(wake.getUTCSeconds() + Math.floor(Math.random() * 180) + 60);
  return wake;
}

declare const Deno: any;

const IDEOGRAM_MODEL = "ideogram:4@1";
const CANVAS = 1024;
const MAX_ATTEMPTS = 3;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const { book_id, page_number, chain_owner_book_id } = await req.json().catch(() => ({}));
  if (!book_id || !page_number) return json({ error: "book_id + page_number required" }, 400);
  try {
    if (!chainOwnerMatches(book_id, chain_owner_book_id)) return json({ ok: true, skipped: true, reason: "chain_owner_mismatch" });
    const lock = await acquireColoringV2ProductionLock(book_id);
    if (!lock.acquired) return json({ ok: true, waiting_for_lock: true, holder: lock.holder, expires_at: lock.expires_at });

    const book = await fetchBook(book_id);
    if (book.stage !== "interior_render") return json({ ok: true, skipped: true, stage: book.stage });

    const requestedPage = Number(page_number);
    const pageCount = Number(book.page_count ?? 32);
    const preflight = shouldSpendForRenderPage({
      stage: book.stage,
      lockAcquired: lock.acquired,
      requestedPage,
      pageCount,
      pageAlreadyRendered: false,
    });
    if (!preflight.allowed && preflight.reason === "render_page_out_of_range") {
      await db().from("coloring_v2_books").update({
        stage: "failed",
        generation_status: "failed",
        stage_updated_at: new Date().toISOString(),
        last_error: `needs_code_fix:render_page_out_of_range:${requestedPage}:page_count=${pageCount}`,
      }).eq("id", book_id);
      await releaseColoringV2ProductionLock(book_id).catch(() => false);
      return json({ ok: false, parked: true, reason: "render_page_out_of_range", page_number: requestedPage, page_count: pageCount }, 200);
    }

    const { data: plan, error: planErr } = await db().from("coloring_v2_page_plans")
      .select("*").eq("book_id", book_id).eq("page_number", requestedPage).single();
    if (planErr) throw planErr;

    // Skip if this page is already rendered.
    const { data: existingRows } = await db().from("coloring_v2_assets")
      .select("id")
      .eq("book_id", book_id)
      .eq("page_number", requestedPage)
      .eq("kind", "interior")
      .order("created_at", { ascending: false })
      .limit(1);

    let assetId = existingRows?.[0]?.id;
    const spendGate = shouldSpendForRenderPage({
      stage: book.stage,
      lockAcquired: lock.acquired,
      requestedPage,
      pageCount,
      pageAlreadyRendered: Boolean(assetId),
    });
    if (!spendGate.allowed && spendGate.reason !== "page_already_rendered") {
      return json({ ok: true, skipped: true, reason: spendGate.reason });
    }
    if (!assetId) {
      let lastErr: any = null;
      let extraNegative = "";
      let lastDefects: string[] = [];
      let anatomyUnmeasured = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const bytes = await renderImageWithFallback({
            prompt: plan.prompt,
            negative_prompt: extraNegative
              ? `${INTERIOR_NEGATIVE_PROMPT}, ${extraNegative}`
              : INTERIOR_NEGATIVE_PROMPT,
            model: IDEOGRAM_MODEL,
            width: CANVAS, height: CANVAS,
            num_inference_steps: 8,
            ebook_id: book_id,
            step: `coloring_v2_interior_p${requestedPage}`,
            v2_book_id: book_id,
            purpose: `interior_p${String(requestedPage).padStart(2, "0")}_a${attempt}`,
            prompt_version: "v2_page_plan@1",
          });

          // Anatomy gate — refuse to upload deformed pages.
          const verdict = await checkPageAnatomy({
            bytes,
            mime: "image/jpeg",
            subject: plan.focal_subject || plan.scene || book.theme || "the subject",
            scene: plan.scene ?? "",
          });

          const isUnrecognizable = (verdict.defects || []).some((d) => String(d).startsWith("unrecognizable_subject"));
          if (verdict.degraded || isUnrecognizable) {
            // Verifier outage or subject not recognizable (abstract art,
            // mandalas, skylines, patterns) — upload with anatomy_unmeasured.
            // Owner law v7: verifier can't interpret → SKIP, don't park.
            console.warn(`[coloring-v2 render] anatomy skipped page ${requestedPage}: ${verdict.defects[0] ?? "degraded"}`);
            anatomyUnmeasured = true;
          } else if (!verdict.pass) {
            lastDefects = verdict.defects;
            const clause = defectsToNegativeClause(verdict.defects);
            extraNegative = clause || "deformed anatomy, malformed body, wrong number of parts";
            console.warn(`[coloring-v2 render] anatomy fail page ${requestedPage} attempt ${attempt}: score=${verdict.anatomy_score} defects=${verdict.defects.join("|")}`);
            // Do NOT upload — try next attempt with stronger negative.
            if (attempt < MAX_ATTEMPTS) continue;
            // Final attempt failed → park the book.
            try {
              await db().from("coloring_v2_qc_findings").insert({
                book_id,
                rule_id: "anatomy_deformity_persistent",
                severity: "hard",
                measured: {
                  page_number: requestedPage,
                  attempts: MAX_ATTEMPTS,
                  last_defects: verdict.defects,
                  last_score: verdict.anatomy_score,
                  named_subject: verdict.named_subject,
                  planned_subject: plan.focal_subject,
                  gate_version: "coloring_v2_anatomy_gate_v1",
                },
              });
            } catch (_) { /* best-effort */ }
            await db().from("coloring_v2_books").update({
              stage: "failed",
              generation_status: "failed",
              stage_updated_at: new Date().toISOString(),
              last_error: `anatomy_unrecoverable_page_${requestedPage}:${verdict.defects.slice(0, 3).join(",")}`,
            }).eq("id", book_id);
            await releaseColoringV2ProductionLock(book_id).catch(() => false);
            return json({
              ok: false,
              parked: true,
              reason: "anatomy_unrecoverable",
              page_number: requestedPage,
              defects: verdict.defects,
              attempts: MAX_ATTEMPTS,
            }, 200);
          }

          // Race guard: another invocation may have completed this page while
          // this one was waiting on the image/QC provider. Reuse it instead of
          // appending a duplicate logical page.
          const { data: racedRows } = await db().from("coloring_v2_assets")
            .select("id")
            .eq("book_id", book_id)
            .eq("page_number", requestedPage)
            .eq("kind", "interior")
            .order("created_at", { ascending: false })
            .limit(1);
          if (racedRows?.[0]?.id) {
            assetId = racedRows[0].id;
            lastErr = null;
            break;
          }

          const asset = await uploadAsset(book_id, "interior", bytes, "jpg",
            {
              attempt,
              prompt_len: plan.prompt.length,
              anatomy_score: verdict.anatomy_score,
              anatomy_pass: verdict.pass,
              anatomy_unmeasured: anatomyUnmeasured,
              anatomy_model: verdict.model ?? null,
              anatomy_gate_version: "coloring_v2_anatomy_gate_v1",
            }, requestedPage);
          assetId = asset.id;
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          // Provider quota / billing lock → do NOT burn attempts. Park the
          // book with a wake time at CF's next daily reset (00:00 UTC + jitter)
          // so the tick's `pickClosestColoringV2Book` filter skips it until
          // fresh quota is available. This is the permanent fix for the
          // "one book burns 95 attempts against a dry CF quota" regression.
          if (e instanceof FalBillingLockedError) {
            const wake = nextCfResetWake();
            await db().from("coloring_v2_books").update({
              stage_updated_at: wake.toISOString(),
              stage_attempt_count: 0,
              last_error: `awaiting_quota_reset:${String((e as Error).message ?? "cf_all_accounts_latched").slice(0, 240)}`,
              updated_at: new Date().toISOString(),
            }).eq("id", book_id);
            await releaseColoringV2ProductionLock(book_id).catch(() => false);
            return json({
              ok: true,
              parked: true,
              reason: "awaiting_quota_reset",
              wake_at: wake.toISOString(),
              page_number: requestedPage,
            }, 200);
          }
        }
      }
      if (!assetId) throw lastErr ?? new Error("render failed");
    }

    // Chain: next page or move to cover.
    const { data: allInteriors } = await db().from("coloring_v2_assets")
      .select("page_number").eq("book_id", book_id).eq("kind", "interior");
    const done = new Set((allInteriors ?? []).map((r: any) => Number(r.page_number)).filter((n: number) => Number.isFinite(n) && n >= 1 && n <= pageCount));
    const outOfRange = (allInteriors ?? []).some((r: any) => Number(r.page_number) > pageCount || Number(r.page_number) < 1);
    if (outOfRange) {
      await db().from("coloring_v2_books").update({
        stage: "failed",
        generation_status: "failed",
        stage_updated_at: new Date().toISOString(),
        last_error: `needs_code_fix:interior_asset_page_out_of_range:page_count=${pageCount}`,
      }).eq("id", book_id);
      await releaseColoringV2ProductionLock(book_id).catch(() => false);
      return json({ ok: false, parked: true, reason: "interior_asset_page_out_of_range", page_count: pageCount }, 200);
    }
    let nextPage: number | null = null;
    for (let p = 1; p <= pageCount; p++) if (!done.has(p)) { nextPage = p; break; }
    if (nextPage != null) {
      await fireStage("coloring-v2-render-page", { book_id, page_number: nextPage, chain_owner_book_id: book_id });
      return json({ ok: true, rendered: requestedPage, next_page: nextPage, interiors_done: done.size });
    }

    // All interiors done → cover stage
    await advance(book_id, "interior_render", "cover");
    await fireStage("coloring-v2-cover", { book_id, chain_owner_book_id: book_id });
    return json({ ok: true, rendered: requestedPage, next: "cover" });
  } catch (e: any) {
    await recordError(book_id, "interior_render", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
