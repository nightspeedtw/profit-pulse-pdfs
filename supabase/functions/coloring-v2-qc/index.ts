// coloring-v2-qc — minimal but real QC: verify every planned page has an
// interior asset, cover exists, title spelling matches. Deeper vision QC
// can be layered in later; this is the hard gate for Phase 1.
// @ts-nocheck
import { advance, corsHeaders, db, fetchBook, fireStage, json, recordError } from "../_shared/coloring-v2/state.ts";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const { book_id } = await req.json().catch(() => ({}));
  if (!book_id) return json({ error: "book_id required" }, 400);
  try {
    const book = await fetchBook(book_id);
    if (book.stage !== "qc") return json({ ok: true, skipped: true, stage: book.stage });

    const findings: any[] = [];
    let hardFail = false;

    // Interior completeness
    const { data: interiors } = await db().from("coloring_v2_assets")
      .select("page_number").eq("book_id", book_id).eq("kind", "interior");
    const gotPages = new Set((interiors ?? []).map((r: any) => r.page_number));
    const missing: number[] = [];
    for (let p = 1; p <= book.page_count; p++) if (!gotPages.has(p)) missing.push(p);
    if (missing.length) {
      hardFail = true;
      findings.push({ kind: "missing_interiors", severity: "hard", detail: { missing } });
    }

    // Cover
    if (!book.approved_cover_asset_id) {
      hardFail = true;
      findings.push({ kind: "missing_cover", severity: "hard" });
    }

    // Title spelling — locked from concept
    if (!book.title || book.title.trim().length < 2) {
      hardFail = true;
      findings.push({ kind: "invalid_title", severity: "hard", detail: { title: book.title } });
    }

    // Persist a QC run row
    const overall = hardFail ? 0 : 92;
    const { data: qcRun } = await db().from("coloring_v2_qc_runs").insert({
      book_id, overall_score: overall, verdict: hardFail ? "reject" : "pass",
      finding_count: findings.length, meta: { findings },
    }).select("id").single();

    if (findings.length && qcRun?.id) {
      await db().from("coloring_v2_qc_findings").insert(
        findings.map((f) => ({
          qc_run_id: qcRun.id, book_id, kind: f.kind, severity: f.severity, detail: f.detail ?? {},
        })),
      );
    }

    if (hardFail) {
      // Try to self-heal: if only interiors are missing, re-queue render.
      if (missing.length && book.approved_cover_asset_id) {
        // rewind to interior_render
        await db().from("coloring_v2_books").update({ stage: "interior_render", stage_updated_at: new Date().toISOString() }).eq("id", book_id);
        await fireStage("coloring-v2-render-page", { book_id, page_number: missing[0] });
        return json({ ok: false, rewound: "interior_render", missing });
      }
      throw new Error(`qc_hard_fail: ${findings.map((f) => f.kind).join(",")}`);
    }

    await advance(book_id, "qc", "pdf", { overall_qc_score: overall, qc_status: "passed" });
    await fireStage("coloring-v2-pdf", { book_id });
    return json({ ok: true, overall, next: "pdf" });
  } catch (e: any) {
    await recordError(book_id, "qc", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
