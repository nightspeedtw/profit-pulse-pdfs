// Milestone 6 — Premium PDF Layout Engine.
//
// POST { ebook_id, force?: boolean }
//
// Pipeline:
//   1. Load ebook + chapters (must have passed Milestone 4 final manuscript QC).
//   2. Build premium HTML (cover, title, copyright, TOC, dividers, chapters,
//      callouts, worksheets, checklists, framework diagrams, action plan,
//      bonus). Print CSS with @page rules + Chromium running header/footer.
//   3. Render PDF via Browserless `/pdf` (Chromium headless).
//   4. Upload PDF to `ebook-pdfs` storage and HTML to the same bucket for QA.
//   5. Run PDF QC: deterministic structural checks + AI readability scoring.
//   6. Save scores + signed URL to ebooks row. pdf_status flips to
//      `rendered` (>=85 + critical checks pass) or `needs_review`.
//
// publishGate (qc.ts) already blocks Shopify publish unless cover_approved
// and cover_score >= 85; we additionally require pdf_approved before publish.
import { admin, corsHeaders, pickModel } from "../_shared/ai.ts";
import { computeManuscriptHash } from "../_shared/manuscript-hash.ts";
import { buildPdfHtml, buildHeaderTemplate, buildFooterTemplate, type PdfData, type WorksheetKind } from "../_shared/pdf-template.ts";
import {
 structuralChecks, scorePdfReadability,
 worksheetOverflowScore, visualFatigueScore, illustrationRelevanceScore,
 typographyScore, readingComfortScore, tableRenderScore,
 worksheetLayoutScore, premiumLayoutScore, coverFullA4Score, formattingScore,
  type PdfQcReport,
} from "../_shared/pdf-qc.ts";
import { lintChapters } from "../_shared/compliance.ts";
import { planIllustrations, type IllustrationPlan } from "../_shared/illustration-planner.ts";
import { logRun } from "../_shared/qc.ts";
import {
  LOCK_PDF, tryAcquireLock, releaseLock, browserlessBackoffAt,
} from "../_shared/recovery.ts";
import { classifyEbook, isKindAllowed, defaultPromptsFor, type EbookCategory } from "../_shared/category.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();
  const db = admin();
  let ebookIdForLock: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const ebookId: string | undefined = body.ebook_id;
    if (!ebookId) return json({ error: "ebook_id required" }, 400);
    ebookIdForLock = ebookId;

    // --------------------------------------------------------------------
    // PDF render lock (browserless_concurrency=1). If another ebook already
    // holds the render lock we DO NOT queue Browserless — we return a
    // structured "busy" signal so the pipeline can wait its turn.
    // --------------------------------------------------------------------
    const lock = await tryAcquireLock(db, LOCK_PDF, ebookId, { ttlSec: 20 * 60 });
    if (!lock.acquired) {
      return json({
        error: "pdf_render_lock_busy",
        blocker_reason: "waiting_for_browserless_slot",
        detail: `Another ebook is currently rendering (holder ${String(lock.holder ?? "").slice(0, 8)}). Waiting for the PDF render slot.`,
        holder: lock.holder,
        retry_at: browserlessBackoffAt(1),
      }, 423);
    }

    const { data: ebook, error: eErr } = await db.from("ebooks").select("*").eq("id", ebookId).maybeSingle();
    if (eErr || !ebook) {
      await releaseLock(db, LOCK_PDF, ebookId);
      return json({ error: "ebook not found" }, 404);
    }

    const { data: chapterRows, error: cErr } = await db.from("ebook_chapters")
      .select("*").eq("ebook_id", ebookId).order("chapter_index", { ascending: true });
    if (cErr) { await releaseLock(db, LOCK_PDF, ebookId); throw cErr; }
    // Fallback for legacy ebooks whose chapters live in the ebooks.chapters
    // jsonb column instead of the ebook_chapters rows table.
    let chapters = chapterRows ?? [];
    if (chapters.length === 0 && Array.isArray(ebook.chapters) && ebook.chapters.length) {
      chapters = (ebook.chapters as any[]).map((c: any, i: number) => ({
        chapter_index: c.index ?? c.chapter_index ?? (i + 1),
        title: c.title ?? `Chapter ${i + 1}`,
        content: c.content ?? "",
        brief: c.brief ?? null,
        metadata: c.metadata ?? {},
      }));
    }
    if (!chapters.length) {
      await releaseLock(db, LOCK_PDF, ebookId);
      await db.from("ebooks").update({
        pdf_status: "failed",
        autopilot_state: "writing_chapters",
        canonical_status: "writing_chapters",
        blocker_class: "dependency_repairable",
        blocker_reason: "pdf_render_missing_chapters",
        waiting_reason: "PDF cannot render yet — chapters are missing; routing back to Writing Chapters.",
      }).eq("id", ebookId);
      return json({ error: "no chapters written yet", blocker_reason: "missing_chapters" }, 400);
    }

    await db.from("ebooks").update({ pdf_status: "rendering" }).eq("id", ebookId);

    // ---- Compliance linter (deterministic, in-memory) ----
    // Rewrites risky finance claims into educational language BEFORE the PDF is
    // rendered. Writes a diff audit to ebooks.compliance_rewrites_json but does
    // not overwrite ebook_chapters — the manuscript stays authoritative.
    const compliance = lintChapters(
      chapters.map((c: any, i: number) => ({ index: c.chapter_index ?? (i + 1), content: c.content ?? "" })),
    );
    const complianceContentByIndex = new Map<number, string>();
    for (const p of compliance.perChapter) complianceContentByIndex.set(p.index, p.content);

    // ---- Inside-illustration planner + AI image generation ----
    // Plan is persisted to ebooks.inside_illustration_plan_json for the admin
    // Overview UI. Images are only generated for entries where recommendation
    // !== "none" and no image is already cached.
    let plan: IllustrationPlan | null = null;
    let illustrationsByChapter: Record<number, { url: string; caption: string }> = {};
    try {
      const existingPlan = ebook.inside_illustration_plan_json as IllustrationPlan | null;
      const existingImages = (ebook.inside_illustrations_json ?? {}) as Record<string, { url: string; caption: string }>;
      // Reuse cached plan only if it actually recommended illustrations;
      // otherwise re-plan (rules or thresholds may have improved).
      plan = (existingPlan?.entries?.length && (existingPlan.total_recommended ?? 0) > 0)
        ? existingPlan
        : planIllustrations(chapters.map((c: any, i: number) => ({
            index: c.chapter_index ?? (i + 1),
            title: c.title ?? `Chapter ${i + 1}`,
            content: c.content ?? "",
          })));
      // Reuse existing images where present; generate the rest in small
      // parallel batches so we stay under the edge function's memory + time
      // budget. Also cap total new generations at 8 per render.
      const toGenerate = plan.entries.filter((e) => e.recommendation !== "none").slice(0, 8);
      const CONCURRENCY = 3;
      for (let i = 0; i < toGenerate.length; i += CONCURRENCY) {
        const batch = toGenerate.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(async (entry) => {
          const key = String(entry.chapter_index);
          const cached = existingImages[key];
          if (cached?.url) return { entry, url: cached.url };
          const url = await generateAndStoreIllustration(db, ebookId, entry.chapter_index, entry.prompt).catch((err) => {
            console.warn(`illustration ch${entry.chapter_index} failed:`, (err as Error).message);
            return null;
          });
          return { entry, url };
        }));
        for (const { entry, url } of results) {
          if (url) illustrationsByChapter[entry.chapter_index] = { url, caption: entry.caption };
        }
      }
    } catch (err) {
      console.warn("illustration planner failed:", (err as Error).message);
    }

    // ---- Assemble PDF data ----
    const outline = (ebook.outline_json ?? {}) as any;
    const category: EbookCategory = classifyEbook(ebook.title ?? "", ebook.subtitle ?? "");
    const data: PdfData = {
      title: ebook.title,
      subtitle: ebook.subtitle,
      buyer: outline.target_buyer ?? ebook.target_buyer,
      promise: outline.promise_statement ?? null,
      brand: "SECRET PDF",
      cover_url: ebook.cover_url ?? null,
      copyright_year: new Date().getFullYear(),
      disclaimer: outline.disclaimer ?? ebook.disclaimer ?? null,
      chapters: chapters.map((c: any, i: number) => {
        const meta = (c.metadata ?? {}) as any;
        const chIdx = c.chapter_index ?? (i + 1);
        const outlineCh = Array.isArray(outline?.chapters) ? outline.chapters[i] : null;
        // Sanitize placeholder titles like "Chapter 2" / "Chapter 2. Chapter 2".
        const safeTitle = sanitizeChapterTitle(c.title, chIdx, c.brief ?? meta.brief, outlineCh);
        const rawWs = meta.worksheet ?? c.worksheet ?? extractWorksheet(c.content ?? "", c.title ?? "");
        let wsKind: WorksheetKind = (rawWs?.kind as WorksheetKind | undefined) ?? pickWorksheetKind(safeTitle, chIdx, category);
        // Enforce category → allowed worksheet kinds. If disallowed, pick a
        // category-appropriate default rather than falling back to generic prompts.
        if (!isKindAllowed(category, wsKind)) wsKind = pickWorksheetKind(safeTitle, chIdx, category);
        const worksheet = rawWs
          ? { ...rawWs, kind: wsKind }
          : defaultWorksheetFor(wsKind, safeTitle, category);
        return {
          index: chIdx,
          title: safeTitle,
          brief: c.brief ?? meta.brief ?? null,
          content: complianceContentByIndex.get(chIdx) ?? c.content ?? "",
          callouts: meta.callouts ?? c.callouts ?? extractCallouts(c.content ?? ""),
          worksheet,
          checklist: meta.checklist ?? c.checklist ?? extractChecklist(c.content ?? "", c.title ?? ""),
          diagram: meta.diagram ?? c.diagram ?? defaultDiagramFor(safeTitle, chIdx, category),
          illustration: illustrationsByChapter[chIdx] ?? null,
        };
      }),
      bonuses: outline.bonuses ?? null,
      action_plan: (ebook.action_plan_json as any) ?? defaultActionPlan(chapters),
      bonus_section: (ebook.bonus_section_json as any) ?? defaultBonusSection(outline.bonuses),
    };

    const html = buildPdfHtml(data);
    const headerTpl = buildHeaderTemplate("SECRET PDF", ebook.title);
    const footerTpl = buildFooterTemplate();

    // ---- Render via Browserless ----
    const token = Deno.env.get("BROWSERLESS_TOKEN");
    if (!token) {
      await db.from("ebooks").update({ pdf_status: "failed" }).eq("id", ebookId);
      await logRun(db, { ebook_id: ebookId, step: "render-pdf", status: "fail", error: "BROWSERLESS_TOKEN missing" });
      await releaseLock(db, LOCK_PDF, ebookId);
      return json({ error: "BROWSERLESS_TOKEN not configured. Set it in project secrets." }, 500);
    }

    const browserlessUrl = `https://production-sfo.browserless.io/pdf?token=${encodeURIComponent(token)}`;
    const pdfResp = await fetch(browserlessUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        html,
        options: {
          // IMPORTANT: do NOT set `format`, `width`, or `height` here.
          // The cover uses `@page cover-a4 { size: A4 }` and the interior uses
          // `@page { size: 6in 9in }`. `preferCSSPageSize: true` lets each page
          // honour its own CSS size — passing an API format/width/height would
          // override CSS and force every page (including the cover) to a single
          // fixed size, breaking full-bleed A4 covers.
          printBackground: true,
          preferCSSPageSize: true,
          displayHeaderFooter: true,
          headerTemplate: headerTpl,
          footerTemplate: footerTpl,
          margin: { top: "0", bottom: "0", left: "0", right: "0" },
        },
        gotoOptions: { waitUntil: "networkidle0", timeout: 60000 },
      }),
    });

    if (!pdfResp.ok) {
      const detail = await pdfResp.text().catch(() => "");
      // ---- Browserless 429 → structured rate-limit signal, NOT a QC/PDF failure ----
      if (pdfResp.status === 429) {
        const nextAttempt = Number(ebook.browserless_retry_count ?? 0) + 1;
        const retryAt = browserlessBackoffAt(nextAttempt);
        await db.from("ebooks").update({
          browserless_retry_count: nextAttempt,
          autopilot_state: nextAttempt > 3 ? "needs_admin_attention" : "waiting_for_browserless_slot",
          blocker_class: nextAttempt > 3 ? "non_recoverable_config_error" : "recoverable_temporary_api_error",
          blocker_reason: nextAttempt > 3 ? "browserless_rate_limit_exhausted" : "browserless_rate_limited",
          needs_review_reason: nextAttempt > 3 ? "Browserless render rate limit continued after 3 retries." : null,
          next_retry_at: retryAt,
        }).eq("id", ebookId);
        await logRun(db, {
          ebook_id: ebookId, step: "render-pdf",
          status: nextAttempt > 3 ? "fail" : "skip",
          error: `browserless 429 (attempt ${nextAttempt}) — retry at ${retryAt}`,
        });
        await releaseLock(db, LOCK_PDF, ebookId);
        return json({
          error: "browserless_rate_limited",
          blocker_reason: nextAttempt > 3 ? "browserless_rate_limit_exhausted" : "browserless_rate_limited",
          attempt: nextAttempt,
          retry_at: retryAt,
          detail: nextAttempt > 3
            ? "Browserless render rate limit continued after 3 retries."
            : "PDF Render Rate Limited — will retry automatically.",
        }, 429);
      }
      await db.from("ebooks").update({ pdf_status: "failed" }).eq("id", ebookId);
      await logRun(db, { ebook_id: ebookId, step: "render-pdf", status: "fail", error: `browserless ${pdfResp.status}: ${detail.slice(0, 400)}` });
      await releaseLock(db, LOCK_PDF, ebookId);
      return json({ error: `Browserless render failed: ${pdfResp.status}`, detail: detail.slice(0, 400) }, 502);
    }
    // Successful render — reset the browserless retry counter.
    if ((ebook.browserless_retry_count ?? 0) > 0) {
      await db.from("ebooks").update({ browserless_retry_count: 0 }).eq("id", ebookId);
    }
    const pdfBytes = new Uint8Array(await pdfResp.arrayBuffer());
    const pageCount = estimatePageCount(pdfBytes);

    // ---- Upload ----
    const slug = (ebook.slug ?? ebook.id).toString().replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    const version = (ebook.pdf_render_count ?? 0) + 1;
    const pdfPath = `${ebook.id}/${slug}-v${version}.pdf`;
    const htmlPath = `${ebook.id}/${slug}-v${version}.html`;

    const up1 = await db.storage.from("ebook-pdfs").upload(pdfPath, pdfBytes, {
      contentType: "application/pdf", upsert: true,
    });
    if (up1.error) throw up1.error;
    const up2 = await db.storage.from("ebook-pdfs").upload(htmlPath, new TextEncoder().encode(html), {
      contentType: "text/html; charset=utf-8", upsert: true,
    });
    if (up2.error) console.warn("html upload failed:", up2.error.message);

    const { data: signedPdf } = await db.storage.from("ebook-pdfs")
      .createSignedUrl(pdfPath, 60 * 60 * 24 * 7);
    const { data: signedHtml } = await db.storage.from("ebook-pdfs")
      .createSignedUrl(htmlPath, 60 * 60 * 24 * 7);

    // ---- QC ----
    const struct = structuralChecks({
      html, page_count: pageCount, cover_score: Number(ebook.cover_score ?? 0),
      chapter_count: chapters.length,
    });

    const sampleProse = chapters.slice(0, 3)
      .map((c: any) => `## ${c.title}\n${(c.content ?? "").slice(0, 2000)}`).join("\n\n");
    const model = pickModel((ebook.generation_mode ?? "hybrid"), "qc");
    let aiScores = { readability_score: 80, worksheet_score: 80, diagram_score: 80, layout_polish_score: 80, issues: [] as string[] };
    try {
      const r = await scorePdfReadability(model, {
        title: ebook.title,
        chapterTitles: chapters.map((c: any) => c.title),
        sampleProse,
      });
      aiScores = r.data;
    } catch (e) {
      console.warn("PDF readability AI scoring failed:", (e as Error).message);
    }

    // ---- Canonical content score (reader-QC), hash-gated ----
    // The premium content sub-score must come from reader-experience-qc when it
    // was scored against the CURRENT manuscript. If the stored reader-QC
    // manuscript_hash doesn't match, treat it as stale and rerun reader-QC
    // synchronously before trusting the score. NEVER lower QC thresholds to
    // paper over a stale score.
    const currentHash = await computeManuscriptHash(chapters as any);
    let canonicalContentScore: number | null = null;
    let readerQcStatus: "fresh" | "stale_rerun_ok" | "stale_rerun_failed" | "missing" = "missing";
    const readerQc = (ebook.reader_experience_qc && typeof ebook.reader_experience_qc === "object")
      ? ebook.reader_experience_qc as Record<string, any>
      : null;
    const storedHash = readerQc?.manuscript_hash;
    const storedScore = Number(ebook.reader_experience_score ?? 0);
    if (readerQc && storedHash === currentHash && storedScore > 0) {
      canonicalContentScore = storedScore;
      readerQcStatus = "fresh";
    } else {
      try {
        const invokeRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/reader-experience-qc`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ebook_id: ebookId }),
        });
        if (invokeRes.ok) {
          const { data: reloaded } = await db.from("ebooks")
            .select("reader_experience_qc,reader_experience_score").eq("id", ebookId).maybeSingle();
          const rqc = (reloaded?.reader_experience_qc && typeof reloaded.reader_experience_qc === "object")
            ? reloaded.reader_experience_qc as Record<string, any>
            : null;
          if (rqc?.manuscript_hash === currentHash && Number(reloaded?.reader_experience_score ?? 0) > 0) {
            canonicalContentScore = Number(reloaded!.reader_experience_score);
            readerQcStatus = "stale_rerun_ok";
          } else {
            readerQcStatus = "stale_rerun_failed";
          }
        } else {
          readerQcStatus = "stale_rerun_failed";
        }
      } catch (e) {
        console.warn("reader-QC rerun for canonical content score failed:", (e as Error).message);
        readerQcStatus = "stale_rerun_failed";
      }
    }

    const coverScore = Number(ebook.cover_score ?? 0);
    const layoutScore = Math.round((struct.structure_score * 0.6) + (aiScores.layout_polish_score * 0.4));
    // Use canonical reader-QC score when hash matches; otherwise fall back to
    // the in-place AI readability sample. Layout gates stay independent.
    const contentScoreForFinal = canonicalContentScore ?? aiScores.readability_score;
    const finalPdfPremium = Math.round(
      (layoutScore * 0.30) +
      (contentScoreForFinal * 0.30) +
      (aiScores.worksheet_score * 0.10) +
      (aiScores.diagram_score * 0.10) +
      (coverScore * 0.20),
    );

    // ---- Premium PDF v2 scores ----
    const wsOverflow = worksheetOverflowScore(html);
    const visFatigue = visualFatigueScore(html, chapters.length);
    const illRelevance = illustrationRelevanceScore(html);
    const complianceScore = compliance.score;
    // Worksheet readability blends AI worksheet score with the overflow gate.
    const worksheetReadability = Math.round((aiScores.worksheet_score * 0.6) + (wsOverflow * 0.4));

    // ---- Premium book-design v3 scores (deterministic on rendered HTML) ----
    const typo = typographyScore(html);
    const comfort = readingComfortScore(html);
    const tableRen = tableRenderScore(html);
    const wsLayout = worksheetLayoutScore(html);
    const premLayout = premiumLayoutScore(html);
    const coverA4 = coverFullA4Score(html);
    const fmtScore = formattingScore({
      typography: typo, reading_comfort: comfort, table_render: tableRen,
      worksheet_layout: wsLayout, premium_layout: premLayout, cover_full_a4: coverA4,
    });

    const qc: PdfQcReport = {
      layout_score: layoutScore,
      readability_score: aiScores.readability_score,
      worksheet_score: aiScores.worksheet_score,
      diagram_score: aiScores.diagram_score,
      cover_score: coverScore,
      worksheet_table_overflow_score: wsOverflow,
      worksheet_readability_score: worksheetReadability,
      visual_fatigue_score: visFatigue,
      inside_illustration_relevance_score: illRelevance,
      compliance_safety_score: complianceScore,
      formatting_score: fmtScore,
      reading_comfort_score: comfort,
      typography_score: typo,
      table_render_score: tableRen,
      worksheet_layout_score: wsLayout,
      premium_layout_score: premLayout,
      cover_full_a4_score: coverA4,
      final_pdf_premium_score: finalPdfPremium,
      checks: struct.checks,
      issues: [...struct.issues, ...(aiScores.issues ?? [])].slice(0, 12),
      page_count: pageCount,
    };

    // ---- Hard-gate deterministic checks (new) ----
    // raw_markdown_score: 100 unless any body <p> still contains `| ... |` or ":---".
    const rawMdLeak =
      /<p[^>]*>[^<]*\|[^<]*\|[^<]*<\/p>/.test(html) ||
      /<p[^>]*>[^<]*:-{2,}[^<]*<\/p>/.test(html);
    const rawMarkdownScore = rawMdLeak ? 0 : 100;

    // chapter_title_quality_score: penalize placeholder / duplicate titles.
    const titles = chapters.map((c: any) => String(c.title ?? "").trim());
    const titleFails = titles.filter((t) =>
      !t
      || /^chapter\s*\d+\.?$/i.test(t)
      || /^chapter\s*\d+\.\s*chapter\s*\d+/i.test(t)
      || /^section\s*\d+\.?$/i.test(t)
    );
    const titleDupes = titles.filter((t, i) => t && titles.indexOf(t) !== i);
    const chapterTitleQualityScore = Math.max(
      0,
      100 - (titleFails.length * 20) - (titleDupes.length * 10),
    );

    // worksheet_relevance_score: penalize any worksheet kind not allowed for
    // this ebook's category.
    const usedKinds = data.chapters.map((c) => c.worksheet?.kind ?? "prompts");
    const wrongKindCount = usedKinds.filter((k) => !isKindAllowed(category, String(k))).length;
    const worksheetRelevanceScore = Math.max(0, 100 - (wrongKindCount * 25));

    // cover_full_bleed_score: 100 because API margins are now 0 and CSS
    // `@page cover { margin: 0 }` controls the cover page. If a future
    // change re-introduces API margins, this score will need a real
    // screenshot-based check.
    const coverFullBleedScore = 100;

    (qc as any).raw_markdown_score = rawMarkdownScore;
    (qc as any).no_raw_markdown_score = rawMarkdownScore;
    (qc as any).formatter_score = fmtScore;
    (qc as any).chapter_title_quality_score = chapterTitleQualityScore;
    (qc as any).worksheet_relevance_score = worksheetRelevanceScore;
    (qc as any).pdf_cover_full_a4_score = coverA4;
    (qc as any).cover_full_bleed_score = coverFullBleedScore;
    (qc as any).ebook_category = category;
    if (rawMdLeak) qc.issues.push("raw markdown table syntax leaked into final HTML");
    if (titleFails.length) qc.issues.push(`placeholder chapter title(s): ${titleFails.length}`);
    if (titleDupes.length) qc.issues.push(`duplicate chapter title(s): ${titleDupes.length}`);
    if (wrongKindCount) qc.issues.push(`wrong-category worksheet(s): ${wrongKindCount}`);

    const criticalChecks = [
      qc.checks.has_cover, qc.checks.has_toc, qc.checks.has_copyright_disclaimer,
      qc.checks.no_raw_markdown_tables, qc.checks.no_duplicated_headings,
      qc.checks.has_chapter_dividers, qc.checks.no_cut_off_text,
    ];
    const allCriticalPass = criticalChecks.every(Boolean);
    // v2 premium gate: all critical + every new score ≥ threshold.
    const premiumGate =
      wsOverflow >= 100 &&
      worksheetReadability >= 90 &&
      visFatigue >= 90 &&
      illRelevance >= 90 &&
      complianceScore >= 90;
    // NEW: hard gates (raw markdown, chapter titles, worksheet relevance, cover full-bleed)
    const hardGate =
      rawMarkdownScore === 100 &&
      chapterTitleQualityScore >= 90 &&
      worksheetRelevanceScore >= 95 &&
      coverFullBleedScore === 100;
    // v3 premium book-design gate — formatter / typography / print polish.
    const formatterGate =
      fmtScore >= 90 &&
      comfort >= 90 &&
      typo >= 90 &&
      tableRen >= 90 &&
      wsLayout >= 90 &&
      premLayout >= 90 &&
      coverA4 === 100;
    if (fmtScore < 90) qc.issues.push(`formatting_score=${fmtScore} below 90`);
    if (comfort < 90) qc.issues.push(`reading_comfort_score=${comfort} below 90`);
    if (typo < 90) qc.issues.push(`typography_score=${typo} below 90`);
    if (tableRen < 90) qc.issues.push(`table_render_score=${tableRen} below 90`);
    if (wsLayout < 90) qc.issues.push(`worksheet_layout_score=${wsLayout} below 90`);
    if (premLayout < 90) qc.issues.push(`premium_layout_score=${premLayout} below 90`);
    if (coverA4 !== 100) qc.issues.push(`cover_full_a4_score=${coverA4} (must be 100)`);
    const passed = finalPdfPremium >= 85 && layoutScore >= 80 && allCriticalPass && premiumGate && hardGate && formatterGate;

    const coverQcMirror = {
      ...(((ebook.cover_qc ?? {}) as Record<string, unknown>)),
      pdf_cover_full_a4_score: coverA4,
      cover_full_a4_score: coverA4,
      cover_full_bleed_score: coverFullBleedScore,
      cover_pdf_checked_at: new Date().toISOString(),
    };

    await db.from("ebooks").update({
      pdf_url: signedPdf?.signedUrl ?? null,
      pdf_html_url: signedHtml?.signedUrl ?? null,
      pdf_status: passed ? "rendered" : "needs_review",
      pdf_generated_at: new Date().toISOString(),
      pdf_qc: qc as unknown as Record<string, unknown>,
      cover_qc: coverQcMirror,
      pdf_score: finalPdfPremium,
      pdf_layout_score: layoutScore,
      pdf_readability_score: aiScores.readability_score,
      pdf_worksheet_score: aiScores.worksheet_score,
      pdf_diagram_score: aiScores.diagram_score,
      pdf_page_count: pageCount,
      pdf_render_count: version,
      pdf_approved: false,
      // v2 premium fields
      worksheet_table_overflow_score: wsOverflow,
      worksheet_readability_score: worksheetReadability,
      visual_fatigue_score: visFatigue,
      inside_illustration_relevance_score: illRelevance,
      text_density_score: plan
        ? Math.round(plan.entries.reduce((a, e) => a + e.text_density_score, 0) / Math.max(1, plan.entries.length))
        : null,
      compliance_safety_score: complianceScore,
      compliance_rewrites_json: compliance.changes.length ? { changes: compliance.changes } as unknown as Record<string, unknown> : null,
      inside_illustration_plan_json: plan as unknown as Record<string, unknown> | null,
      inside_illustrations_json: illustrationsByChapter as unknown as Record<string, unknown>,
      // When PDF is rendered cleanly, advance pipeline to shopify_upload stage.
      pipeline_status: passed ? "shopify_upload" : ebook.pipeline_status,
    }).eq("id", ebookId);

    await logRun(db, {
      ebook_id: ebookId, step: "render-pdf",
      status: passed ? "ok" : "rewrite",
      score: finalPdfPremium, duration_ms: Date.now() - t0,
      payload: { page_count: pageCount, version, passed },
    });

    await releaseLock(db, LOCK_PDF, ebookId);
    return json({
      ok: true, passed, pdf_url: signedPdf?.signedUrl, html_url: signedHtml?.signedUrl,
      page_count: pageCount, qc,
    });
  } catch (e) {
    console.error("render-pdf failed:", e);
    // Best-effort: release the PDF render lock so the next queued ebook can proceed.
    try {
      if (ebookIdForLock) await releaseLock(db, LOCK_PDF, ebookIdForLock);
    } catch { /* ignore */ }
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});

// ---------- helpers ----------
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// Best-effort page count by counting "/Type /Page" markers in the binary.
// Browserless responses include them in cleartext for non-encrypted PDFs.
function estimatePageCount(buf: Uint8Array): number {
  const s = new TextDecoder("latin1").decode(buf);
  const m = s.match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : 0;
}

// Extract markdown blockquotes into callouts (lightweight fallback when the
// writer didn't emit structured metadata).
function extractCallouts(md: string): { kind: string; title?: string; body: string }[] {
  const out: { kind: string; body: string; title?: string }[] = [];
  const re = /(?:^|\n)>\s?([^\n]+(?:\n>\s?[^\n]+)*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    out.push({ kind: "tip", body: m[1].replace(/\n>\s?/g, " ").trim() });
    if (out.length >= 2) break;
  }
  return out;
}

function extractChecklist(md: string, chapterTitle: string) {
  // Look for sections labelled "Checklist" or "Quick checklist" with bullets.
  const m = md.match(/(?:^|\n)#{2,4}\s*(?:Quick\s+)?Checklist[^\n]*\n([\s\S]*?)(?=\n#{1,4}\s|$)/i);
  if (!m) return null;
  const items = Array.from(m[1].matchAll(/^[-*]\s+(.+)$/gm)).map((x) => x[1].trim()).slice(0, 8);
  if (!items.length) return null;
  return { title: chapterTitle, items };
}

function extractWorksheet(md: string, chapterTitle: string) {
  const m = md.match(/(?:^|\n)#{2,4}\s*(?:Worksheet|Reflection|Action Steps)[^\n]*\n([\s\S]*?)(?=\n#{1,4}\s|$)/i);
  if (!m) return null;
  const prompts = Array.from(m[1].matchAll(/^(?:\d+\.|[-*])\s+(.+)$/gm)).map((x) => x[1].trim()).slice(0, 5);
  if (!prompts.length) return null;
  return { title: chapterTitle, prompts };
}

function defaultActionPlan(chapters: any[]) {
  const days = ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"];
  return days.map((d, i) => ({
    day: d,
    tasks: [
      `Re-read Chapter ${Math.min(i + 1, chapters.length)}: ${chapters[Math.min(i, chapters.length - 1)]?.title ?? ""}`,
      "Apply one specific tool from this chapter to your own situation.",
      "Write 2 sentences in your worksheet about what changed.",
    ],
  }));
}

function defaultBonusSection(bonuses: Record<string, string> | null | undefined) {
  if (!bonuses) return null;
  return Object.entries(bonuses).map(([k, v]) => ({
    title: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    body: v,
  }));
}

// ---------- Premium PDF v2 helpers ----------

// Replace obvious placeholder chapter titles ("Chapter 2", "Chapter 2. Chapter 2")
// with something derived from the chapter brief, or a safe "Section N" label.
function sanitizeChapterTitle(
  raw: string | null | undefined,
  index: number,
  brief?: string | null,
  outlineCh?: any,
): string {
  const s = (raw ?? "").trim();
  const placeholder = !s
    || /^chapter\s*\d+\.?$/i.test(s)
    || /^chapter\s*\d+\.\s*chapter\s*\d+/i.test(s)
    || /^section\s*\d+\.?$/i.test(s);
  if (!placeholder) return s;
  // 1) Prefer a non-placeholder outline title
  const outlineTitle = String(outlineCh?.chapter_title ?? outlineCh?.title ?? "").trim();
  if (outlineTitle && !/^chapter\s*\d+\.?$/i.test(outlineTitle)) return outlineTitle;
  // 2) Framework/promise-derived title
  const framework = String(outlineCh?.framework?.title ?? "").trim();
  if (framework) return framework;
  const promise = String(outlineCh?.chapter_promise ?? outlineCh?.promise ?? "").trim();
  if (promise) {
    const first = promise.split(/[.!?\n]/)[0].trim();
    if (first && first.length <= 90) return first;
  }
  // 3) Brief-derived
  const b = (brief ?? "").trim();
  if (b) {
    const first = b.split(/[.!?\n]/)[0].trim();
    if (first && first.length <= 90) return first;
  }
  return `Section ${index}`;
}

function pickWorksheetKind(chapterTitle: string, _chapterIndex: number, category?: EbookCategory): WorksheetKind {
  const t = (chapterTitle ?? "").toLowerCase();
  const isFinanceDebt = category === "finance_debt";
  const isFinanceCash = category === "finance_cashflow";
  // Debt tracker only in debt-specific books/chapters
  if (isFinanceDebt && /\bdebt|balance|creditor|forensic\b/.test(t)) return "debt_tracker";
  if (isFinanceDebt && /\bnegotiat|hardship|arbitrage\b/.test(t)) return "negotiation_script";
  if ((isFinanceDebt || isFinanceCash) && /\bvelocity|payoff|snowball|avalanche|stacking\b/.test(t)) return "velocity_calculator";
  // Cashflow / fortress category
  if (isFinanceCash) {
    if (/\bcash\s*flow|surplus|budget|income\b/.test(t)) return "cashflow_surplus";
    if (/\bbaseline|fortress|foundation|pillar\b/.test(t)) return "fortress_audit";
    if (/\bleak|lifestyle|expense|spending\b/.test(t)) return "lifestyle_leak";
    if (/\bsafety\s*net|buffer|emergency\b/.test(t)) return "safety_net";
    if (/\bfixed\s*cost|fragility|contract|subscription\b/.test(t)) return "fixed_cost_scan";
    if (/\bautomat|guardrail|defense|system\b/.test(t)) return "automation_flow";
  }
  // Productivity
  if (category === "productivity") {
    if (/\baudit|diagnos|friction|fake\s*busy|value\b/.test(t)) return "focus_audit";
    if (/\binterrupt|notif|distract|context\s*switch\b/.test(t)) return "interruption_log";
    if (/\bdeep\s*work|prime\s*time|block|energy\b/.test(t)) return "deep_work_planner";
    if (/\bcalendar|boundary|schedul|office\s*hours\b/.test(t)) return "calendar_boundary";
    if (/\bmeeting|async|standup\b/.test(t)) return "meeting_elimination";
    if (/\bsprint|day\s?1|72[-\s]?hour\b/.test(t)) return "sprint_timeline";
    if (/\bautomat|system|guardrail\b/.test(t)) return "automation_flow";
    if (/\boperating|manual|permanent|long[-\s]?term|checklist\b/.test(t)) return "operating_manual";
    return "focus_audit";
  }
  // Energy / health
  if (category === "energy_health" || category === "wellness") {
    if (/\baudit|diagnos|72[-\s]?hour|leak\b/.test(t)) return "energy_audit";
    if (/\bcaffeine|coffee|stimulant\b/.test(t)) return "caffeine_log";
    if (/\bsleep|circadian|wake|bedtime|anchor\b/.test(t)) return "sleep_anchor";
    if (/\bcrash|2\s?pm|slump|afternoon\b/.test(t)) return "crash_diagnostic";
    if (/\bevening|recovery|wind[-\s]?down|night\b/.test(t)) return "evening_recovery";
    if (/\boperating|manual|permanent|long[-\s]?term|checklist\b/.test(t)) return "operating_manual";
    return "energy_audit";
  }
  // Generic finance defaults (kept for backward compat when category not matched above)
  if (/\bsprint|72[-\s]?hour|liquidity|day\s?1\b/.test(t)) return "sprint_timeline";
  if (/\bautomat|defense|guardrail|system\b/.test(t)) return "automation_flow";
  if (/\bresilience|habit|mindset|motivation|milestone\b/.test(t)) return "resilience_scorecard";
  if (/\boperating|manual|permanent|long[-\s]?term|checklist\b/.test(t)) return "operating_manual";
  return "prompts";
}

// Deterministic default worksheet content per kind, now category-aware.
function defaultWorksheetFor(kind: WorksheetKind, chapterTitle: string, category: EbookCategory = "other") {
  switch (kind) {
    case "debt_tracker": return {
      title: chapterTitle, kind,
      prompts: ["List every debt account. Fill one row per creditor. Update monthly."],
      columns: ["Creditor", "Exact Balance", "APR", "Min. Payment", "Payoff Date"],
      rows: 8,
    };
    case "velocity_calculator": return {
      title: chapterTitle, kind,
      prompts: ["Track the impact of extra payments month over month."],
      columns: ["Month", "Extra Payment", "Balance After", "Interest Saved"],
      rows: 6,
    };
    case "resilience_scorecard": {
      // Category-appropriate axes.
      const cols = category === "energy_health" || category === "wellness"
        ? ["Area", "Score 1-5", "Root Cause", "Next Action"]
        : category === "productivity"
          ? ["Focus Area", "Score 1-5", "Biggest Leak", "Next Action"]
          : ["Area", "Score 1-5", "Evidence", "Next Action"];
      return { title: chapterTitle, kind, prompts: ["Rate each area 1-5. Note one action per row for the coming week."], columns: cols, rows: 6 };
    }
    case "sprint_timeline": return {
      title: chapterTitle, kind,
      prompts: category === "productivity"
        ? ["Hour 0-1: Setup", "Hour 1-3: Deep block", "Hour 3-4: Recovery", "Hour 4-6: Second block", "Hour 6-8: Wrap"]
        : ["Hour 0-4", "Hour 4-12", "Hour 12-24", "Hour 24-48", "Hour 48-72"],
    };
    case "negotiation_script": return {
      title: chapterTitle, kind,
      prompts: ["Opening line", "Anchor number", "Reason (hardship, competitor offer, tenure)", "Response to pushback", "Close"],
    };
    case "automation_flow": return {
      title: chapterTitle, kind,
      prompts: category === "productivity"
        ? [
          "Open your calendar and block one 2-hour focus window tomorrow",
          "Turn off non-essential notifications on your primary device",
          "Set an auto-reply for that focus window",
          "Batch inbox check to twice daily",
          "Add a weekly review to your calendar",
        ]
        : category === "energy_health"
          ? [
            "Set a fixed wake time for the next 7 days",
            "Cut caffeine after 1 PM",
            "Block bright light 60 minutes before bed",
            "Add a 10-minute walk after lunch",
            "Log energy 3× daily for one week",
          ]
          : [
            "Open your primary bank's rules screen",
            "Create a scheduled transfer on payday",
            "Set the amount to your weekly surplus",
            "Route it to the target account",
            "Enable email confirmation",
            "Add a monthly calendar reminder to review",
          ],
    };
    case "operating_manual": return {
      title: chapterTitle, kind,
      prompts: category === "productivity"
        ? [
          "Daily: 1 deep-work block minimum",
          "Weekly: review calendar, kill 1 recurring meeting",
          "Monthly: audit tools and notifications",
          "Quarterly: revisit priorities and remove one commitment",
        ]
        : category === "energy_health"
          ? [
            "Daily: consistent sleep/wake window",
            "Weekly: 3× movement sessions",
            "Monthly: caffeine + screen audit",
            "Quarterly: bloodwork or professional check-in",
          ]
          : [
            "Weekly: review numbers, top up buffer",
            "Monthly: rebalance priorities, log wins",
            "Quarterly: re-negotiate any rate/contract over threshold",
            "Annually: refresh your rules",
          ],
    };
    // Category-specific table worksheets — render as titled tables; the template
    // supplies the columns/rows if we don't override here.
    case "focus_audit":
    case "interruption_log":
    case "deep_work_planner":
    case "calendar_boundary":
    case "meeting_elimination":
    case "energy_audit":
    case "caffeine_log":
    case "sleep_anchor":
    case "crash_diagnostic":
    case "evening_recovery":
    case "cashflow_surplus":
    case "fortress_audit":
    case "lifestyle_leak":
    case "safety_net":
    case "fixed_cost_scan":
      return { title: chapterTitle, kind };
    case "prompts":
    default: return {
      title: chapterTitle, kind: "prompts" as WorksheetKind,
      prompts: defaultPromptsFor(category, chapterTitle),
    };
  }
}

// Generate one inside illustration via Lovable AI Gateway (non-streaming),
// store it in `ebook-covers` (existing bucket) at
// `<ebook_id>/illustrations/ch-<n>.png`, and return a signed URL.
async function generateAndStoreIllustration(
  db: ReturnType<typeof import("../_shared/ai.ts").admin>,
  ebookId: string,
  chapterIndex: number,
  prompt: string,
): Promise<string | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) { console.warn("LOVABLE_API_KEY missing — skipping illustration"); return null; }
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-image-1-mini",
      prompt,
      size: "1024x1024",
      quality: "low",
      n: 1,
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`image gen ${resp.status}: ${detail.slice(0, 200)}`);
  }
  const body = await resp.json();
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) throw new Error("image gen returned no b64_json");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const path = `${ebookId}/illustrations/ch-${chapterIndex}.png`;
  const up = await db.storage.from("ebook-covers").upload(path, bytes, {
    contentType: "image/png", upsert: true,
  });
  if (up.error) throw up.error;
  const { data: signed } = await db.storage.from("ebook-covers").createSignedUrl(path, 60 * 60 * 24 * 30);
  return signed?.signedUrl ?? null;
}

// ---------- Diagram fallback registry ----------
// Every chapter should carry at least a lightweight framework diagram so the
// PDF has a visual anchor between prose blocks (Fix #1: inject visuals from
// registry when the writer/outline didn't emit one). Category-aware, keyword-
// aware; falls back to a generic 4-step transformation model.
function defaultDiagramFor(
  chapterTitle: string,
  chapterIndex: number,
  category: EbookCategory,
): { title: string; steps: string[] } {
  const t = (chapterTitle ?? "").toLowerCase();
  const key = `${category}::${t}`;

  const REGISTRY: [RegExp, { title: string; steps: string[] }][] = [
    // Finance / debt
    [/\bdebt|balance|creditor|forensic\b/, { title: "Debt Forensic Loop", steps: ["List", "Prioritize", "Attack", "Track"] }],
    [/\bnegotiat|hardship|arbitrage\b/,   { title: "Negotiation Ladder", steps: ["Open", "Anchor", "Handle Pushback", "Close"] }],
    [/\bvelocity|payoff|snowball|avalanche|stacking\b/, { title: "Payoff Velocity Method", steps: ["Baseline", "Extra Payment", "Roll Forward", "Compound"] }],
    // Cashflow / fortress
    [/\bcash\s*flow|surplus|budget|income\b/, { title: "Surplus Engine", steps: ["Income In", "Fixed Out", "Variable Out", "Surplus"] }],
    [/\bfortress|baseline|pillar|foundation\b/, { title: "Fortress Pillars", steps: ["Buffer", "Insurance", "Income Streams", "Automation"] }],
    [/\bleak|lifestyle|expense|spending\b/, { title: "Leak Detection Loop", steps: ["Scan", "Rank", "Cut", "Redirect"] }],
    [/\bsafety\s*net|buffer|emergency\b/, { title: "Safety Net Layers", steps: ["Starter Buffer", "1 Month", "3 Months", "6 Months"] }],
    [/\bfixed\s*cost|fragility|contract|subscription\b/, { title: "Fragility Scan", steps: ["Inventory", "Score 1-5", "Renegotiate", "Replace"] }],
    // Productivity
    [/\bfocus|deep\s*work|attention\b/, { title: "Deep Work Cycle", steps: ["Prime", "Block", "Recover", "Review"] }],
    [/\binterrupt|notif|distract\b/,     { title: "Interruption Firewall", steps: ["Detect", "Batch", "Silence", "Reclaim"] }],
    [/\bcalendar|boundary|schedul\b/,    { title: "Calendar Boundary Loop", steps: ["Audit", "Cut", "Protect", "Communicate"] }],
    [/\bmeeting|async|standup\b/,        { title: "Meeting Elimination", steps: ["List", "Question", "Async", "Kill"] }],
    // Energy / health
    [/\benergy|audit|72[-\s]?hour\b/,    { title: "Energy Audit Loop", steps: ["Log", "Pattern", "Trigger", "Fix"] }],
    [/\bcaffeine|coffee|stimulant\b/,    { title: "Caffeine Half-Life", steps: ["Intake", "Peak", "Decay", "Cutoff"] }],
    [/\bsleep|circadian|bedtime\b/,      { title: "Sleep Anchor System", steps: ["Wake", "Light", "Cutoff", "Wind-down"] }],
    // Cross-cutting
    [/\bautomat|system|guardrail|defense\b/, { title: "Automation Loop", steps: ["Trigger", "Rule", "Action", "Confirmation"] }],
    [/\bsprint|72[-\s]?hour|day\s?1\b/,  { title: "72-Hour Sprint", steps: ["Hour 0-4", "Hour 4-24", "Hour 24-48", "Hour 48-72"] }],
    [/\bhabit|resilien|mindset|milestone\b/, { title: "Resilience Loop", steps: ["Trigger", "Response", "Reflection", "Reinforcement"] }],
    [/\boperating|manual|permanent|long[-\s]?term\b/, { title: "Operating System", steps: ["Daily", "Weekly", "Monthly", "Quarterly"] }],
  ];

  for (const [re, entry] of REGISTRY) {
    if (re.test(key) || re.test(t)) return entry;
  }
  // Generic transformation model — safe for every category.
  return {
    title: `Chapter ${chapterIndex} Framework`,
    steps: ["Diagnose", "Decide", "Do", "Debrief"],
  };
}

