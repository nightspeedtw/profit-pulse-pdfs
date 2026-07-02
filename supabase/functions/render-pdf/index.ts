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
import { buildPdfHtml, buildHeaderTemplate, buildFooterTemplate, type PdfData, type WorksheetKind } from "../_shared/pdf-template.ts";
import {
  structuralChecks, scorePdfReadability,
  worksheetOverflowScore, visualFatigueScore, illustrationRelevanceScore,
  type PdfQcReport,
} from "../_shared/pdf-qc.ts";
import { lintChapters } from "../_shared/compliance.ts";
import { planIllustrations, type IllustrationPlan } from "../_shared/illustration-planner.ts";
import { logRun } from "../_shared/qc.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();
  const db = admin();

  try {
    const body = await req.json().catch(() => ({}));
    const ebookId: string | undefined = body.ebook_id;
    if (!ebookId) return json({ error: "ebook_id required" }, 400);

    const { data: ebook, error: eErr } = await db.from("ebooks").select("*").eq("id", ebookId).maybeSingle();
    if (eErr || !ebook) return json({ error: "ebook not found" }, 404);

    const { data: chapterRows, error: cErr } = await db.from("ebook_chapters")
      .select("*").eq("ebook_id", ebookId).order("chapter_index", { ascending: true });
    if (cErr) throw cErr;
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
    if (!chapters.length) return json({ error: "no chapters written yet" }, 400);

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
      plan = existingPlan?.entries?.length
        ? existingPlan
        : planIllustrations(chapters.map((c: any, i: number) => ({
            index: c.chapter_index ?? (i + 1),
            title: c.title ?? `Chapter ${i + 1}`,
            content: c.content ?? "",
          })));
      // Reuse existing images where present; generate the rest (best-effort).
      for (const entry of plan.entries) {
        if (entry.recommendation === "none") continue;
        const key = String(entry.chapter_index);
        const cached = existingImages[key];
        if (cached?.url) { illustrationsByChapter[entry.chapter_index] = cached; continue; }
        const url = await generateAndStoreIllustration(db, ebookId, entry.chapter_index, entry.prompt).catch((err) => {
          console.warn(`illustration ch${entry.chapter_index} failed:`, (err as Error).message);
          return null;
        });
        if (url) illustrationsByChapter[entry.chapter_index] = { url, caption: entry.caption };
      }
    } catch (err) {
      console.warn("illustration planner failed:", (err as Error).message);
    }

    // ---- Assemble PDF data ----
    const outline = (ebook.outline_json ?? {}) as any;
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
        const rawWs = meta.worksheet ?? c.worksheet ?? extractWorksheet(c.content ?? "", c.title ?? "");
        const wsKind: WorksheetKind = pickWorksheetKind(c.title ?? "", chIdx);
        return {
          index: chIdx,
          title: c.title ?? `Chapter ${i + 1}`,
          brief: c.brief ?? meta.brief ?? null,
          content: complianceContentByIndex.get(chIdx) ?? c.content ?? "",
          callouts: meta.callouts ?? c.callouts ?? extractCallouts(c.content ?? ""),
          worksheet: rawWs ? { ...rawWs, kind: rawWs.kind ?? wsKind } : null,
          checklist: meta.checklist ?? c.checklist ?? extractChecklist(c.content ?? "", c.title ?? ""),
          diagram: meta.diagram ?? c.diagram ?? null,
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
      return json({ error: "BROWSERLESS_TOKEN not configured. Set it in project secrets." }, 500);
    }

    const browserlessUrl = `https://production-sfo.browserless.io/pdf?token=${encodeURIComponent(token)}`;
    const pdfResp = await fetch(browserlessUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        html,
        options: {
          format: "Letter",
          width: "6in",
          height: "9in",
          printBackground: true,
          preferCSSPageSize: true,
          displayHeaderFooter: true,
          headerTemplate: headerTpl,
          footerTemplate: footerTpl,
          margin: { top: "0.7in", bottom: "0.85in", left: "0.7in", right: "0.7in" },
        },
        gotoOptions: { waitUntil: "networkidle0", timeout: 60000 },
      }),
    });

    if (!pdfResp.ok) {
      const detail = await pdfResp.text().catch(() => "");
      await db.from("ebooks").update({ pdf_status: "failed" }).eq("id", ebookId);
      await logRun(db, { ebook_id: ebookId, step: "render-pdf", status: "fail", error: `browserless ${pdfResp.status}: ${detail.slice(0, 400)}` });
      return json({ error: `Browserless render failed: ${pdfResp.status}`, detail: detail.slice(0, 400) }, 502);
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

    const coverScore = Number(ebook.cover_score ?? 0);
    const layoutScore = Math.round((struct.structure_score * 0.6) + (aiScores.layout_polish_score * 0.4));
    const finalPdfPremium = Math.round(
      (layoutScore * 0.30) +
      (aiScores.readability_score * 0.30) +
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
      final_pdf_premium_score: finalPdfPremium,
      checks: struct.checks,
      issues: [...struct.issues, ...(aiScores.issues ?? [])].slice(0, 12),
      page_count: pageCount,
    };

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
    const passed = finalPdfPremium >= 85 && layoutScore >= 80 && allCriticalPass && premiumGate;

    await db.from("ebooks").update({
      pdf_url: signedPdf?.signedUrl ?? null,
      pdf_html_url: signedHtml?.signedUrl ?? null,
      pdf_status: passed ? "rendered" : "needs_review",
      pdf_generated_at: new Date().toISOString(),
      pdf_qc: qc as unknown as Record<string, unknown>,
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

    return json({
      ok: true, passed, pdf_url: signedPdf?.signedUrl, html_url: signedHtml?.signedUrl,
      page_count: pageCount, qc,
    });
  } catch (e) {
    console.error("render-pdf failed:", e);
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

// Chapter-title-based picker for the type-aware worksheet renderer. If the
// upstream writer already emitted a `kind`, that takes precedence.
function pickWorksheetKind(chapterTitle: string, chapterIndex: number): WorksheetKind {
  const t = (chapterTitle ?? "").toLowerCase();
  if (/\bdebt|balance|tracker|forensic|audit\b/.test(t)) return "debt_tracker";
  if (/\bnegotiat|call|arbitrage|hardship\b/.test(t)) return "negotiation_script";
  if (/\bsprint|72[-\s]?hour|liquidity\b/.test(t)) return "sprint_timeline";
  if (/\bvelocity|stacking|payoff|snowball|avalanche|calculator\b/.test(t)) return "velocity_calculator";
  if (/\bautomat|defense|guardrail\b/.test(t)) return "automation_flow";
  if (/\bresilience|habit|mindset|motivation|milestone\b/.test(t)) return "resilience_scorecard";
  if (/\boperating|manual|permanent|debt-proof|long[-\s]?term\b/.test(t)) return "operating_manual";
  // Alternate for variety when title doesn't hint.
  return chapterIndex % 2 === 0 ? "prompts" : "debt_tracker";
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
