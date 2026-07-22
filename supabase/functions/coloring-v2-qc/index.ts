// coloring-v2-qc — anatomy safety net + completeness/spelling gate.
//
// Anatomy safety net (coloring_v2_anatomy_gate_v1, 2026-07-22):
// The render step already runs the anatomy verifier per attempt. QC re-checks
// every uploaded interior in case renders slipped through (degraded verdicts,
// stale assets from before the gate shipped, manual reprocessing). Any real
// deformity rewinds the offending page to interior_render. Unmeasured pages
// force a re-measure — never a default pass score.
// @ts-nocheck
import { advance, corsHeaders, db, fetchBook, fireStage, json, recordError, signedUrl } from "../_shared/coloring-v2/state.ts";
import { checkPageAnatomy } from "../_shared/coloring-v2/anatomy-check.ts";

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

    // Interior completeness — latest asset per page_number.
    const { data: allInteriors } = await db().from("coloring_v2_assets")
      .select("id, storage_path, mime, page_number, meta, created_at")
      .eq("book_id", book_id).eq("kind", "interior")
      .order("created_at", { ascending: false });
    const byPage = new Map<number, any>();
    for (const r of (allInteriors ?? [])) if (!byPage.has(r.page_number)) byPage.set(r.page_number, r);
    const missing: number[] = [];
    for (let p = 1; p <= book.page_count; p++) if (!byPage.has(p)) missing.push(p);
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

    // Anatomy safety net — re-verify every interior. Rewind on real defects.
    const anatomyFailPages: Array<{ page: number; defects: string[]; score: number }> = [];
    const anatomyUnmeasured: number[] = [];
    let minAnatomyScore = 100;
    if (!missing.length) {
      // Load plan for subject/scene per page.
      const { data: plans } = await db().from("coloring_v2_page_plans")
        .select("page_number, focal_subject, scene").eq("book_id", book_id);
      const planByPage = new Map<number, any>();
      for (const p of (plans ?? [])) planByPage.set(p.page_number, p);

      for (const [pageNum, asset] of byPage.entries()) {
        // Trust a prior pass: if the render step recorded anatomy_pass=true
        // and no unmeasured flag, skip the re-check to save credits.
        const meta = (asset.meta ?? {}) as any;
        if (meta.anatomy_pass === true && meta.anatomy_unmeasured !== true) {
          if (typeof meta.anatomy_score === "number") {
            minAnatomyScore = Math.min(minAnatomyScore, meta.anatomy_score);
          }
          continue;
        }

        // Re-verify: download bytes, run checker.
        let bytes: Uint8Array;
        try {
          const { data: blob, error } = await db().storage.from("coloring-v2").download(asset.storage_path);
          if (error || !blob) throw error ?? new Error("empty_blob");
          bytes = new Uint8Array(await blob.arrayBuffer());
        } catch (e) {
          anatomyUnmeasured.push(pageNum);
          continue;
        }
        const plan = planByPage.get(pageNum);
        const verdict = await checkPageAnatomy({
          bytes,
          mime: asset.mime || "image/jpeg",
          subject: plan?.focal_subject || book.theme || "the subject",
          scene: plan?.scene ?? "",
        });
        // Persist verdict back onto the asset.
        await db().from("coloring_v2_assets").update({
          meta: {
            ...meta,
            anatomy_score: verdict.anatomy_score,
            anatomy_pass: verdict.pass,
            anatomy_unmeasured: verdict.degraded,
            anatomy_defects: verdict.defects.slice(0, 6),
            anatomy_gate_version: "coloring_v2_anatomy_gate_v1",
            anatomy_rechecked_at: new Date().toISOString(),
          },
        }).eq("id", asset.id).catch(() => {});

        if (verdict.degraded) {
          anatomyUnmeasured.push(pageNum);
          continue;
        }
        if (!verdict.pass) {
          anatomyFailPages.push({ page: pageNum, defects: verdict.defects, score: verdict.anatomy_score });
        }
        minAnatomyScore = Math.min(minAnatomyScore, verdict.anatomy_score);
      }
    }

    if (anatomyFailPages.length) {
      hardFail = true;
      findings.push({
        kind: "anatomy_deformity_detected",
        severity: "hard",
        detail: { pages: anatomyFailPages, gate_version: "coloring_v2_anatomy_gate_v1" },
      });
    }
    if (anatomyUnmeasured.length) {
      hardFail = true;
      findings.push({
        kind: "anatomy_unmeasured",
        severity: "hard",
        detail: { pages: anatomyUnmeasured },
      });
    }

    // Overall score = min measured anatomy score (never a default 92).
    const overall = hardFail ? 0 : Math.max(0, Math.min(100, Math.round(minAnatomyScore)));

    const { data: qcRun } = await db().from("coloring_v2_qc_runs").insert({
      book_id, scope: "book", overall_score: overall,
      status: hardFail ? "reject" : "pass",
      completed_at: new Date().toISOString(),
      meta: { findings, gate_version: "coloring_v2_anatomy_gate_v1" },
    }).select("id").single();

    if (findings.length && qcRun?.id) {
      await db().from("coloring_v2_qc_findings").insert(
        findings.map((f) => ({
          qc_run_id: qcRun.id, book_id, rule_id: f.kind, severity: f.severity, measured: f.detail ?? {},
        })),
      );
    }

    if (hardFail) {
      // Self-heal: for anatomy fails or missing interiors, rewind + re-render.
      const rewindPages = [
        ...missing,
        ...anatomyFailPages.map((p) => p.page),
      ].sort((a, b) => a - b);

      if (rewindPages.length && book.approved_cover_asset_id) {
        // Delete failing interior assets so render-page re-generates instead of skipping.
        for (const pageNum of anatomyFailPages.map((p) => p.page)) {
          await db().from("coloring_v2_assets")
            .delete().eq("book_id", book_id).eq("kind", "interior").eq("page_number", pageNum)
            .catch(() => {});
        }
        await db().from("coloring_v2_books").update({
          stage: "interior_render",
          stage_updated_at: new Date().toISOString(),
          last_error: `qc_rewind:${rewindPages.slice(0, 4).join(",")}`,
        }).eq("id", book_id);
        await fireStage("coloring-v2-render-page", { book_id, page_number: rewindPages[0] });
        return json({ ok: false, rewound: "interior_render", pages: rewindPages, findings });
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
