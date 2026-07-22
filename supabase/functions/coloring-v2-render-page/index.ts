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
import { advance, corsHeaders, db, fetchBook, fireStage, json, recordError, uploadAsset } from "../_shared/coloring-v2/state.ts";
import { INTERIOR_NEGATIVE_PROMPT } from "../_shared/coloring-v2/prompts.ts";
import { renderImageWithFallback } from "../_shared/coloring-v2/image-fallback.ts";
import { checkPageAnatomy, defectsToNegativeClause } from "../_shared/coloring-v2/anatomy-check.ts";

declare const Deno: any;

const IDEOGRAM_MODEL = "ideogram:4@1";
const CANVAS = 1024;
const MAX_ATTEMPTS = 3;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const { book_id, page_number } = await req.json().catch(() => ({}));
  if (!book_id || !page_number) return json({ error: "book_id + page_number required" }, 400);
  try {
    const book = await fetchBook(book_id);
    if (book.stage !== "interior_render") return json({ ok: true, skipped: true, stage: book.stage });

    const { data: plan, error: planErr } = await db().from("coloring_v2_page_plans")
      .select("*").eq("book_id", book_id).eq("page_number", page_number).single();
    if (planErr) throw planErr;

    // Skip if this page is already rendered.
    const { data: existing } = await db().from("coloring_v2_assets")
      .select("id").eq("book_id", book_id).eq("page_number", page_number).eq("kind", "interior").maybeSingle();

    let assetId = existing?.id;
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
            step: `coloring_v2_interior_p${page_number}`,
            v2_book_id: book_id,
            purpose: `interior_p${String(page_number).padStart(2, "0")}_a${attempt}`,
            prompt_version: "v2_page_plan@1",
          });

          // Anatomy gate — refuse to upload deformed pages.
          const verdict = await checkPageAnatomy({
            bytes,
            mime: "image/jpeg",
            subject: plan.focal_subject || plan.scene || book.theme || "the subject",
            scene: plan.scene ?? "",
          });

          if (verdict.degraded) {
            // Verifier outage — upload but flag for QC safety net.
            console.warn(`[coloring-v2 render] anatomy verifier degraded page ${page_number}: ${verdict.defects[0] ?? "unknown"}`);
            anatomyUnmeasured = true;
          } else if (!verdict.pass) {
            lastDefects = verdict.defects;
            const clause = defectsToNegativeClause(verdict.defects);
            extraNegative = clause || "deformed anatomy, malformed body, wrong number of parts";
            console.warn(`[coloring-v2 render] anatomy fail page ${page_number} attempt ${attempt}: score=${verdict.anatomy_score} defects=${verdict.defects.join("|")}`);
            // Do NOT upload — try next attempt with stronger negative.
            if (attempt < MAX_ATTEMPTS) continue;
            // Final attempt failed → park the book.
            await db().from("coloring_v2_qc_findings").insert({
              book_id,
              rule_id: "anatomy_deformity_persistent",
              severity: "hard",
              measured: {
                page_number,
                attempts: MAX_ATTEMPTS,
                last_defects: verdict.defects,
                last_score: verdict.anatomy_score,
                named_subject: verdict.named_subject,
                planned_subject: plan.focal_subject,
                gate_version: "coloring_v2_anatomy_gate_v1",
              },
            }).catch(() => {});
            await db().from("coloring_v2_books").update({
              stage: "failed",
              generation_status: "failed",
              stage_updated_at: new Date().toISOString(),
              last_error: `anatomy_unrecoverable_page_${page_number}:${verdict.defects.slice(0, 3).join(",")}`,
            }).eq("id", book_id);
            return json({
              ok: false,
              parked: true,
              reason: "anatomy_unrecoverable",
              page_number,
              defects: verdict.defects,
              attempts: MAX_ATTEMPTS,
            }, 200);
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
            }, page_number);
          assetId = asset.id;
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!assetId) throw lastErr ?? new Error("render failed");
    }

    // Chain: next page or move to cover.
    const nextPage = page_number + 1;
    if (nextPage <= book.page_count) {
      await fireStage("coloring-v2-render-page", { book_id, page_number: nextPage });
      return json({ ok: true, rendered: page_number, next_page: nextPage });
    }

    // All interiors done → cover stage
    await advance(book_id, "interior_render", "cover");
    await fireStage("coloring-v2-cover", { book_id });
    return json({ ok: true, rendered: page_number, next: "cover" });
  } catch (e: any) {
    await recordError(book_id, "interior_render", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
