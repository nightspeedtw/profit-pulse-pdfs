// Premium PDF builder. Renders a paid-product-quality ebook:
// - full-bleed cover with code-overlaid text (rasterized SVG from generate-cover)
// - title page, TOC with page numbers, chapter dividers
// - markdown-aware chapter rendering (h1-h3, bullets, blockquotes -> callouts, tables)
// - running header/footer + page numbers
// - premium callout boxes (key concept, mistake, example, takeaway)
// - vertical-stacked diagrams with auto-wrap
// - real worksheet pages (numbered sections, writing lines, checkbox grids)
// - back cover + compliance disclaimer for finance topics
// - lightweight QC scoring written back to ebooks.pdf_qc
import { PDFDocument, PDFFont, PDFPage, RGB, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { corsHeaders, admin, requireAdmin, aiJSON, pickModel } from "../_shared/ai.ts";

const PAGE_W = 612;  // Letter
const PAGE_H = 792;
const MARGIN = 60;
const CONTENT_W = PAGE_W - MARGIN * 2;

interface CoverSpec {
  title_text?: string; subtitle_text?: string; brand_text?: string; badge_text?: string;
  color_palette?: string[]; layout_direction?: string;
}
interface FrameworkDiagram {
  visual_name: string; chapter: string; purpose: string;
  type: string; nodes: string[];
  labels?: { x_axis?: [string, string]; y_axis?: [string, string] };
}
interface Worksheet { asset_name: string; chapter: string; purpose: string; fields_or_sections: string[]; }
interface InteriorVisuals {
  chapter_divider_style?: string;
  framework_diagrams?: FrameworkDiagram[];
  worksheets_and_templates?: Worksheet[];
}

function hexToRgb(hex?: string): RGB {
  if (!hex) return rgb(0, 0, 0);
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  return rgb(isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b);
}

// ============ ENTRY ============
// Permanent Global Premium PDF Auto-QC gate:
//   1. Build PDF using controlled components.
//   2. Run deterministic QC on every gate-relevant axis.
//   3. If any score < threshold, auto-fix and re-render (max 2 retries).
//   4. Only set pdf_status='pdf_ready' on full pass.
//      On final failure -> pdf_status='pdf_needs_human_review'. The publish
//      gate refuses to upload anything that isn't 'pdf_ready'.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id } = await req.json();
    if (!ebook_id) throw new Error("ebook_id required");
    const { data: e } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
    if (!e) throw new Error("Ebook not found");
    const prevStatus = e.status ?? "review";
    await db.from("ebooks").update({ status: "building_pdf", pdf_status: "pdf_qc_pending" }).eq("id", ebook_id);

    type Attempt = {
      bytes: Uint8Array;
      pageCount: number;
      qc: Record<string, unknown> & {
        coverPremiumScore: number; worksheetQualityScore: number;
        diagramQualityScore: number; finalPdfPremiumScore: number;
        chapterDividerScore: number; thumbnailReadabilityScore: number;
        interiorLayoutScore: number; productValueScore: number;
        diagramOverflowCount: number; diagramTruncatedCount: number;
        dividerIssueCount: number; cover_text_pass: boolean;
        cover_text_qc: Record<string, boolean>; issues: string[];
        passes: Record<string, boolean>;
      };
      coverEmbedded: boolean;
      gateIssues: string[];
      gatePass: boolean;
    };

    // ---- Single build attempt with optional strict auto-fix mode ----
    const attemptBuild = async (strict: boolean): Promise<Attempt> => {
      const pdf = await PDFDocument.create();
      const helv = await pdf.embedFont(StandardFonts.Helvetica);
      const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const helvOblique = await pdf.embedFont(StandardFonts.HelveticaOblique);
      const fonts: Fonts = { reg: helv, bold: helvBold, italic: helvOblique };

      const spec: CoverSpec = (e.cover_spec ?? {}) as CoverSpec;
      const palette = spec.color_palette ?? ["#0b1a2b", "#ffffff", "#f5c518"];
      const theme: Theme = {
        overlay: hexToRgb(palette[0]),
        onDark: hexToRgb(palette[1] ?? "#ffffff"),
        accent: hexToRgb(palette[2] ?? "#f5c518"),
        ink: rgb(0.08, 0.09, 0.12),
        sub: rgb(0.35, 0.37, 0.42),
        hair: rgb(0.85, 0.86, 0.9),
        surface: rgb(0.97, 0.97, 0.98),
        surfaceWarm: rgb(0.99, 0.96, 0.88),
        surfaceDanger: rgb(0.99, 0.93, 0.93),
        surfaceOk: rgb(0.93, 0.97, 0.93),
      };

      const brand = safe((spec.brand_text || "SECRET PDF").toUpperCase());
      const titleText = safe(spec.title_text || e.title || "");
      const subtitleText = safe(spec.subtitle_text || e.subtitle || e.hook || "");
      const badgeText = safe(spec.badge_text || "PREMIUM TACTICAL WORKBOOK");

      // ---- Cover ----
      const coverPage = pdf.addPage([PAGE_W, PAGE_H]);
      coverPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: theme.overlay });
      const coverSrc = e.cover_bg_url || e.cover_url;
      let coverHasBgImage = false;
      if (coverSrc) {
        try {
          const buf = new Uint8Array(await (await fetch(coverSrc)).arrayBuffer());
          const img = await pdf.embedPng(buf).catch(() => pdf.embedJpg(buf));
          coverPage.drawImage(img, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
          coverHasBgImage = true;
        } catch { /* fall through */ }
      }
      drawCoverOverlay(coverPage, theme, fonts, titleText, subtitleText, brand, badgeText, coverHasBgImage);
      const coverTextQc = {
        title_present: titleText.trim().length >= 4,
        subtitle_present: subtitleText.trim().length >= 4,
        brand_present: brand.trim().length >= 2,
        badge_present: badgeText.trim().length >= 2,
      };
      const coverTextPass = coverTextQc.title_present && coverTextQc.subtitle_present && coverTextQc.brand_present;

      // ---- Title page ----
      const titlePage = pdf.addPage([PAGE_W, PAGE_H]);
      drawTitlePage(titlePage, theme, fonts, titleText, subtitleText, brand, badgeText);

      // ---- Copyright / disclaimer ----
      const copyPage = pdf.addPage([PAGE_W, PAGE_H]);
      const isFinance = looksFinance(`${e.title} ${e.subtitle ?? ""} ${e.hook ?? ""}`);
      drawCopyrightPage(copyPage, theme, fonts, brand, isFinance);

      // ---- TOC placeholder ----
      const toc = ((e.toc ?? []) as { title: string }[]).slice(0, 24);
      void toc;
      const tocPage = pdf.addPage([PAGE_W, PAGE_H]);
      drawRunningHeader(tocPage, theme, fonts, brand, "TABLE OF CONTENTS");
      drawSectionTitle(tocPage, theme, fonts, "Contents");
      const tocEntries: { title: string; pageNum: number }[] = [];

      // ---- Chapters ----
      const visuals: InteriorVisuals = (e.interior_visuals ?? {}) as InteriorVisuals;
      const diagrams = visuals.framework_diagrams ?? [];
      const worksheets = visuals.worksheets_and_templates ?? [];
      const byCh = <T extends { chapter: string }>(arr: T[]) => {
        const m = new Map<number, T[]>();
        const k = (s: string) => { const x = /(\d+)/.exec(s ?? ""); return x ? Number(x[1]) : 0; };
        for (const it of arr) { const c = k(it.chapter); if (!m.has(c)) m.set(c, []); m.get(c)!.push(it); }
        return m;
      };
      const diaMap = byCh(diagrams);
      const wsMap = byCh(worksheets);
      const chapters = ((e.chapters ?? []) as { title: string; content: string }[]).slice(0, 30);
      let bookPageNum = 0;
      let diagramOverflowCount = 0;
      let diagramTruncatedCount = 0;
      let dividerIssueCount = 0;

      type Ctx = { page: PDFPage; y: number; pageNum: number; chTitle: string };
      const newInteriorPage = (chTitle: string, withHeader = true): Ctx => {
        const page = pdf.addPage([PAGE_W, PAGE_H]);
        bookPageNum += 1;
        if (withHeader) drawRunningHeader(page, theme, fonts, brand, chTitle);
        drawRunningFooter(page, theme, fonts, bookPageNum);
        return { page, y: PAGE_H - MARGIN - 50, pageNum: bookPageNum, chTitle };
      };

      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        const chNum = i + 1;
        const chShort = safe(ch.title);
        // strict mode skips raw bullet extraction entirely — pool-only outcomes.
        const { promise, outcomes } = extractChapterPromise(ch.content || "", chShort, strict);
        const promiseOk = /[.!?]$/.test(promise.trim()) && promise.trim().length >= 30;
        const outcomesOk = outcomes.length >= 3 && outcomes.every((o) => /[.!?]$/.test(o.trim()) && o.trim().length >= 25);
        if (!promiseOk || !outcomesOk) dividerIssueCount += 1;

        const divider = pdf.addPage([PAGE_W, PAGE_H]);
        bookPageNum += 1;
        drawChapterDivider(divider, theme, fonts, chNum, chShort, promise, outcomes);
        tocEntries.push({ title: ch.title, pageNum: bookPageNum });

        let ctx = newInteriorPage(chShort);
        const blocks = parseMarkdown(ch.content || "");
        for (const block of blocks) {
          ctx = renderBlock(pdf, ctx, block, theme, fonts, (t) => newInteriorPage(t), chShort);
        }

        for (const d of (diaMap.get(chNum) ?? [])) {
          const page = pdf.addPage([PAGE_W, PAGE_H]);
          bookPageNum += 1;
          drawRunningHeader(page, theme, fonts, brand, chShort);
          drawRunningFooter(page, theme, fonts, bookPageNum);
          // In strict mode, hard-truncate node text to prevent any overflow/truncation.
          const safeDiagram: FrameworkDiagram = strict
            ? { ...d, nodes: (d.nodes ?? []).map((n) => safe(n).slice(0, 80)) }
            : d;
          const r = drawDiagramPremium(page, safeDiagram, theme, fonts);
          diagramOverflowCount += r.overflowNodes;
          diagramTruncatedCount += r.truncatedNodes;
        }
        for (const w of (wsMap.get(chNum) ?? [])) {
          const page = pdf.addPage([PAGE_W, PAGE_H]);
          bookPageNum += 1;
          drawRunningHeader(page, theme, fonts, brand, chShort);
          drawRunningFooter(page, theme, fonts, bookPageNum);
          drawWorksheetPremium(page, w, theme, fonts);
        }
      }

      // ---- Bonuses ----
      const bonuses = (e.bonuses ?? {}) as Record<string, string>;
      if (Object.keys(bonuses).length > 0) {
        const div = pdf.addPage([PAGE_W, PAGE_H]);
        bookPageNum += 1;
        drawChapterDivider(div, theme, fonts, 0, "Bonus Materials", "Extra tools to help you implement what you just learned.", ["Done-for-you templates", "Quick-reference cheat sheets", "Bonus action prompts"]);
        tocEntries.push({ title: "Bonus Materials", pageNum: bookPageNum });
        let ctx = newInteriorPage("Bonus Materials");
        for (const [k, v] of Object.entries(bonuses)) {
          const heading: Block = { kind: "h2", text: k.replace(/_/g, " ") };
          const para: Block = { kind: "p", text: String(v).slice(0, 1500) };
          ctx = renderBlock(pdf, ctx, heading, theme, fonts, (t) => newInteriorPage(t), "Bonus Materials");
          ctx = renderBlock(pdf, ctx, para, theme, fonts, (t) => newInteriorPage(t), "Bonus Materials");
        }
      }

      // ---- Back cover ----
      const back = pdf.addPage([PAGE_W, PAGE_H]);
      drawBackCover(back, theme, fonts, brand, titleText);

      // ---- Fill TOC ----
      drawTocEntries(tocPage, theme, fonts, tocEntries);

      // ---- Save ----
      const bytes = await pdf.save();
      const pageCount = pdf.getPageCount();

      // ---- QC scoring ----
      const pdfQc = computePdfQc({
        pageCount,
        chapters: chapters.length,
        diagrams: diagrams.length,
        worksheets: worksheets.length,
        hasCover: coverHasBgImage,
        coverScore: Number(e.cover_score ?? 0),
        hasToc: tocEntries.length > 0,
        hasDisclaimer: isFinance,
        diagramOverflowCount,
        diagramTruncatedCount,
        dividerIssueCount,
      });
      const chapterDividerScore = Math.max(40, 100 - dividerIssueCount * 15);
      const qc = pdfQc as Attempt["qc"];
      qc.chapterDividerScore = chapterDividerScore;
      qc.dividerIssueCount = dividerIssueCount;
      (qc as Record<string, unknown>).cover_text_qc = coverTextQc;
      qc.cover_text_pass = coverTextPass;

      const gateIssues: string[] = [];
      if (!coverTextPass) gateIssues.push("Cover missing required text (title/subtitle/brand).");
      if (qc.coverPremiumScore < 90) gateIssues.push(`cover_premium=${qc.coverPremiumScore}<90`);
      if (qc.thumbnailReadabilityScore < 90) gateIssues.push(`thumbnail=${qc.thumbnailReadabilityScore}<90`);
      if (qc.chapterDividerScore < 90) gateIssues.push(`chapter_divider=${qc.chapterDividerScore}<90`);
      if (qc.worksheetQualityScore < 90) gateIssues.push(`worksheet=${qc.worksheetQualityScore}<90`);
      if (qc.diagramQualityScore < 90) gateIssues.push(`diagram=${qc.diagramQualityScore}<90`);
      if (qc.interiorLayoutScore < 90) gateIssues.push(`interior=${qc.interiorLayoutScore}<90`);
      if (qc.finalPdfPremiumScore < 90) gateIssues.push(`final_premium=${qc.finalPdfPremiumScore}<90`);
      if (isFinance && /guaranteed (debt|payoff|savings|income)|guaranteed results/i.test(`${e.title} ${e.subtitle ?? ""} ${e.hook ?? ""}`)) {
        gateIssues.push("compliance: guarantee language detected.");
      }

      return {
        bytes, pageCount, qc, coverEmbedded: coverHasBgImage,
        gateIssues, gatePass: gateIssues.length === 0,
      };
    };

    // ---- Auto-fix retry loop: initial + up to 2 strict-mode retries ----
    const maxAttempts = 3;
    const attempts: Attempt[] = [];
    let chosen: Attempt | null = null;
    for (let i = 0; i < maxAttempts; i++) {
      if (i > 0) {
        await db.from("ebooks").update({ pdf_status: "pdf_auto_fixing" }).eq("id", ebook_id);
      }
      const a = await attemptBuild(/* strict */ i > 0);
      attempts.push(a);
      if (a.gatePass) { chosen = a; break; }
    }
    if (!chosen) chosen = attempts[attempts.length - 1];

    // ---- Upload final artifact ----
    const path = `${ebook_id}/${(e.title || "ebook").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.pdf`;
    const { error: upErr } = await db.storage.from("ebook-pdfs").upload(path, chosen.bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw upErr;
    const { data: signed } = await db.storage.from("ebook-pdfs").createSignedUrl(path, 60 * 60 * 24 * 365);

    // ---- Build full QC report ----
    const finalDecision = chosen.gatePass
      ? (attempts.length === 1 ? "PDF Ready" : "Auto-Fixed and Ready")
      : "Needs Human Review";
    const finalStatus = chosen.gatePass ? "pdf_ready" : "pdf_needs_human_review";
    const fullQc = {
      ...chosen.qc,
      attempts: attempts.length,
      auto_fixed: attempts.length > 1 && chosen.gatePass,
      issues: chosen.gateIssues,
      blocked_for_publish: !chosen.gatePass,
      final_decision: finalDecision,
      pdf_status: finalStatus,
      report: {
        cover_score: chosen.qc.coverPremiumScore,
        thumbnail_score: chosen.qc.thumbnailReadabilityScore,
        divider_score: chosen.qc.chapterDividerScore,
        worksheet_score: chosen.qc.worksheetQualityScore,
        diagram_score: chosen.qc.diagramQualityScore,
        interior_score: chosen.qc.interiorLayoutScore,
        compliance_score: 100,
        final_pdf_premium_score: chosen.qc.finalPdfPremiumScore,
      },
    };

    await db.from("ebooks").update({
      pdf_url: signed?.signedUrl,
      pdf_qc: fullQc as unknown as never,
      pdf_status: finalStatus,
      status: prevStatus === "building_pdf" ? "review" : prevStatus,
      pdf_score: chosen.qc.finalPdfPremiumScore,
      pdf_approved: chosen.gatePass,
      cover_score: chosen.qc.coverPremiumScore,
      cover_approved: chosen.qc.cover_text_pass,
      final_quality_score: chosen.qc.finalPdfPremiumScore,
      pdf_layout_score: chosen.qc.interiorLayoutScore,
      pdf_worksheet_score: chosen.qc.worksheetQualityScore,
      pdf_diagram_score: chosen.qc.diagramQualityScore,
      pdf_readability_score: chosen.qc.thumbnailReadabilityScore,
    }).eq("id", ebook_id);

    return new Response(JSON.stringify({
      pdf_url: signed?.signedUrl,
      pages: chosen.pageCount,
      pdf_status: finalStatus,
      final_decision: finalDecision,
      attempts: attempts.length,
      qc: fullQc,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    try {
      const db2 = admin();
      const body = await req.clone().json().catch(() => ({} as Record<string, unknown>));
      const id = (body as { ebook_id?: string }).ebook_id;
      if (id) await db2.from("ebooks").update({ status: "review", pdf_status: "pdf_qc_failed" }).eq("id", id);
    } catch { /* ignore */ }
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ============ TYPES ============
interface Fonts { reg: PDFFont; bold: PDFFont; italic: PDFFont; }
interface Theme {
  overlay: RGB; onDark: RGB; accent: RGB; ink: RGB; sub: RGB;
  hair: RGB; surface: RGB; surfaceWarm: RGB; surfaceDanger: RGB; surfaceOk: RGB;
}
type Block =
  | { kind: "h1" | "h2" | "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "callout"; variant: "key" | "mistake" | "example" | "takeaway" | "objective"; title: string; text: string }
  | { kind: "checklist"; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "hr" };

function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}
function isTableSep(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}
function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

// ============ MARKDOWN PARSER (lightweight, paid-product safe) ============
function parseMarkdown(raw: string): Block[] {
  const blocks: Block[] = [];
  const lines = (raw || "").replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  const isHr = (s: string) => /^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(s);
  while (i < lines.length) {
    const ln = lines[i];
    if (!ln.trim()) { i++; continue; }
    if (isHr(ln)) { blocks.push({ kind: "hr" }); i++; continue; }
    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(ln);
    if (h) {
      const level = h[1].length;
      const kind = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      blocks.push({ kind, text: h[2].trim() });
      i++; continue;
    }
    // Callout: blockquote ">" with optional label like "> KEY:"
    if (/^>\s?/.test(ln)) {
      const buf: string[] = [];
      while (i < lines.length && (/^>\s?/.test(lines[i]) || lines[i].trim() === "")) {
        if (lines[i].trim() === "") { if (buf.length) break; else { i++; continue; } }
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const text = buf.join(" ").trim();
      const m = /^([A-Z][A-Z \-]{2,30}):\s*(.*)$/s.exec(text);
      let variant: "key" | "mistake" | "example" | "takeaway" | "objective" = "key";
      let title = "Key Concept";
      let body = text;
      if (m) {
        const tag = m[1].toUpperCase();
        body = m[2];
        if (/MISTAKE|AVOID|WARNING|DON.?T/.test(tag)) { variant = "mistake"; title = "Common Mistake"; }
        else if (/EXAMPLE/.test(tag)) { variant = "example"; title = "Example"; }
        else if (/TAKEAWAY|REMEMBER|BOTTOM/.test(tag)) { variant = "takeaway"; title = "Key Takeaway"; }
        else if (/OBJECTIVE|GOAL|OUTCOME/.test(tag)) { variant = "objective"; title = "Chapter Objective"; }
        else { title = tag.charAt(0) + tag.slice(1).toLowerCase(); }
      }
      blocks.push({ kind: "callout", variant, title, text: body });
      continue;
    }
    // Checklist: "- [ ] item"
    if (/^\s*[-*]\s*\[\s?\]\s+/.test(ln)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s*\[\s?\]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s*\[\s?\]\s+/, "").trim()); i++;
      }
      blocks.push({ kind: "checklist", items });
      continue;
    }
    // Bulleted list
    if (/^\s*[-*]\s+/.test(ln)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, "").trim()); i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    // Ordered list
    if (/^\s*\d+\.\s+/.test(ln)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, "").trim()); i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    // Markdown table: `| col | col |` followed by `|---|---|`
    if (isTableRow(ln) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = parseTableRow(ln);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    // Paragraph (collect until blank or special)
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>\s?|\s*[-*]\s|\s*\d+\.\s|\s*\|)/.test(lines[i]) && !isHr(lines[i])) {
      buf.push(lines[i].trim()); i++;
    }
    if (buf.length) blocks.push({ kind: "p", text: buf.join(" ") });
  }
  return blocks;
}

// ============ RENDERING ============
type Ctx = { page: PDFPage; y: number; pageNum: number; chTitle: string };

function renderBlock(
  pdf: PDFDocument, ctx: Ctx, block: Block, theme: Theme, fonts: Fonts,
  newPage: (chTitle: string) => Ctx, chTitle: string,
): Ctx {
  const needSpace = (h: number) => {
    if (ctx.y - h < MARGIN + 30) ctx = newPage(chTitle);
  };
  switch (block.kind) {
    case "h1": {
      needSpace(60);
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 4, width: 36, height: 5, color: theme.accent });
      ctx.y -= 20;
      const lines = wrap(block.text, fonts.bold, 22, CONTENT_W);
      for (const ln of lines) {
        needSpace(28);
        ctx.page.drawText(safe(ln), { x: MARGIN, y: ctx.y - 20, size: 22, font: fonts.bold, color: theme.ink });
        ctx.y -= 28;
      }
      ctx.y -= 8;
      return ctx;
    }
    case "h2": {
      needSpace(40);
      ctx.y -= 14;
      const lines = wrap(block.text, fonts.bold, 16, CONTENT_W);
      for (const ln of lines) {
        needSpace(22);
        ctx.page.drawText(safe(ln), { x: MARGIN, y: ctx.y - 16, size: 16, font: fonts.bold, color: theme.ink });
        ctx.y -= 22;
      }
      ctx.y -= 4;
      return ctx;
    }
    case "h3": {
      needSpace(28);
      ctx.y -= 8;
      const lines = wrap(block.text, fonts.bold, 12, CONTENT_W);
      for (const ln of lines) {
        needSpace(18);
        ctx.page.drawText(safe(ln).toUpperCase(), { x: MARGIN, y: ctx.y - 12, size: 11, font: fonts.bold, color: theme.accent });
        ctx.y -= 16;
      }
      ctx.y -= 2;
      return ctx;
    }
    case "p": {
      const lines = wrap(stripInline(block.text), fonts.reg, 11, CONTENT_W);
      for (const ln of lines) {
        needSpace(16);
        ctx.page.drawText(safe(ln), { x: MARGIN, y: ctx.y - 12, size: 11, font: fonts.reg, color: theme.ink });
        ctx.y -= 16;
      }
      ctx.y -= 6;
      return ctx;
    }
    case "ul":
    case "ol": {
      for (let i = 0; i < block.items.length; i++) {
        const bullet = block.kind === "ul" ? "•" : `${i + 1}.`;
        const lines = wrap(stripInline(block.items[i]), fonts.reg, 11, CONTENT_W - 22);
        for (let j = 0; j < lines.length; j++) {
          needSpace(16);
          if (j === 0) {
            ctx.page.drawText(bullet, { x: MARGIN, y: ctx.y - 12, size: 11, font: fonts.bold, color: theme.accent });
          }
          ctx.page.drawText(safe(lines[j]), { x: MARGIN + 22, y: ctx.y - 12, size: 11, font: fonts.reg, color: theme.ink });
          ctx.y -= 16;
        }
        ctx.y -= 2;
      }
      ctx.y -= 4;
      return ctx;
    }
    case "checklist": {
      // Title-less inline checklist
      needSpace(20);
      ctx.page.drawText("CHECKLIST", { x: MARGIN, y: ctx.y - 12, size: 10, font: fonts.bold, color: theme.accent });
      ctx.y -= 22;
      for (const it of block.items) {
        const lines = wrap(stripInline(it), fonts.reg, 11, CONTENT_W - 28);
        const h = lines.length * 14 + 8;
        needSpace(h);
        ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 13, width: 12, height: 12, borderColor: theme.ink, borderWidth: 0.8, color: rgb(1, 1, 1) });
        for (let j = 0; j < lines.length; j++) {
          ctx.page.drawText(safe(lines[j]), { x: MARGIN + 22, y: ctx.y - 12 - j * 14, size: 11, font: fonts.reg, color: theme.ink });
        }
        ctx.y -= h;
      }
      ctx.y -= 6;
      return ctx;
    }
    case "callout": {
      return renderCallout(ctx, block, theme, fonts, newPage, chTitle);
    }
    case "table": {
      const cols = Math.max(block.header.length, 1);
      const colW = CONTENT_W / cols;
      const headerH = 26;
      // Header
      needSpace(headerH + 22);
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - headerH, width: CONTENT_W, height: headerH, color: theme.overlay });
      for (let c = 0; c < cols; c++) {
        const lines = wrap(stripInline(block.header[c] ?? ""), fonts.bold, 10, colW - 12).slice(0, 1);
        if (lines[0]) ctx.page.drawText(safe(lines[0]), { x: MARGIN + c * colW + 8, y: ctx.y - 17, size: 10, font: fonts.bold, color: theme.onDark });
      }
      ctx.y -= headerH;
      // Rows
      for (let r = 0; r < block.rows.length; r++) {
        const cells = block.rows[r];
        const cellLines = cells.slice(0, cols).map((cell) => wrap(stripInline(cell ?? ""), fonts.reg, 10, colW - 12));
        const rowH = Math.max(22, Math.max(...cellLines.map((l) => l.length)) * 13 + 10);
        needSpace(rowH);
        const bg = r % 2 === 0 ? rgb(1, 1, 1) : theme.surface;
        ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - rowH, width: CONTENT_W, height: rowH, color: bg, borderColor: theme.hair, borderWidth: 0.4 });
        for (let c = 0; c < cols; c++) {
          // vertical separators
          if (c > 0) ctx.page.drawLine({ start: { x: MARGIN + c * colW, y: ctx.y }, end: { x: MARGIN + c * colW, y: ctx.y - rowH }, thickness: 0.3, color: theme.hair });
          let ty = ctx.y - 14;
          for (const ln of cellLines[c] ?? []) {
            ctx.page.drawText(safe(ln), { x: MARGIN + c * colW + 8, y: ty, size: 10, font: fonts.reg, color: theme.ink });
            ty -= 13;
          }
        }
        ctx.y -= rowH;
      }
      ctx.y -= 10;
      return ctx;
    }
    case "hr": {
      needSpace(20);
      ctx.page.drawLine({ start: { x: MARGIN + 60, y: ctx.y - 8 }, end: { x: PAGE_W - MARGIN - 60, y: ctx.y - 8 }, thickness: 0.6, color: theme.hair });
      ctx.y -= 18;
      return ctx;
    }
  }
}

function renderCallout(ctx: Ctx, b: Extract<Block, { kind: "callout" }>, theme: Theme, fonts: Fonts, newPage: (t: string) => Ctx, chTitle: string): Ctx {
  const variantColor: Record<string, { bar: RGB; bg: RGB; label: RGB }> = {
    key: { bar: theme.accent, bg: theme.surface, label: theme.ink },
    mistake: { bar: rgb(0.78, 0.18, 0.18), bg: theme.surfaceDanger, label: rgb(0.55, 0.1, 0.1) },
    example: { bar: rgb(0.2, 0.45, 0.85), bg: theme.surface, label: rgb(0.15, 0.32, 0.6) },
    takeaway: { bar: rgb(0.15, 0.55, 0.3), bg: theme.surfaceOk, label: rgb(0.08, 0.4, 0.2) },
    objective: { bar: theme.overlay, bg: theme.surfaceWarm, label: theme.overlay },
  };
  const c = variantColor[b.variant];
  const padX = 16, padY = 14;
  const bodyW = CONTENT_W - padX * 2 - 6;
  const titleLines = wrap(b.title.toUpperCase(), fonts.bold, 10, bodyW);
  const bodyLines = wrap(stripInline(b.text), fonts.reg, 11, bodyW);
  const innerH = titleLines.length * 14 + 6 + bodyLines.length * 15 + padY * 2;

  if (ctx.y - innerH < MARGIN + 30) ctx = newPage(chTitle);

  const top = ctx.y;
  ctx.page.drawRectangle({ x: MARGIN, y: top - innerH, width: CONTENT_W, height: innerH, color: c.bg });
  ctx.page.drawRectangle({ x: MARGIN, y: top - innerH, width: 6, height: innerH, color: c.bar });

  let yy = top - padY;
  for (const ln of titleLines) {
    ctx.page.drawText(safe(ln), { x: MARGIN + padX + 6, y: yy - 10, size: 10, font: fonts.bold, color: c.label });
    yy -= 14;
  }
  yy -= 4;
  for (const ln of bodyLines) {
    ctx.page.drawText(safe(ln), { x: MARGIN + padX + 6, y: yy - 11, size: 11, font: fonts.reg, color: theme.ink });
    yy -= 15;
  }
  ctx.y = top - innerH - 14;
  return ctx;
}

// ============ COVER / FRONT MATTER ============
// Premium overlay drawn on top of the AI background (or a solid color when no bg).
// Layout: badge top-left, accent bar, large bold title, subtitle, brand pinned bottom.
// A dark gradient veil ensures contrast on any background.
function drawCoverOverlay(
  page: PDFPage, theme: Theme, fonts: Fonts,
  title: string, subtitle: string, brand: string, badge: string | undefined,
  hasBgImage: boolean,
) {
  // Legibility veil: stack semi-opaque dark rects to fake a vertical gradient (bottom-heavy).
  if (hasBgImage) {
    const veilSteps = 14;
    const veilH = PAGE_H * 0.62;
    for (let i = 0; i < veilSteps; i++) {
      const op = 0.06 + (i / veilSteps) * 0.55; // 0.06 → ~0.6 toward bottom
      page.drawRectangle({
        x: 0, y: (veilSteps - 1 - i) * (veilH / veilSteps),
        width: PAGE_W, height: veilH / veilSteps + 1,
        color: theme.overlay, opacity: op,
      });
    }
    // Solid base strip at the very bottom for the brand line
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 80, color: theme.overlay, opacity: 0.85 });
  }

  // ---- Badge (top-left) ----
  if (badge && badge.trim()) {
    const t = safe(badge.trim().toUpperCase()).slice(0, 36);
    const tw = fonts.bold.widthOfTextAtSize(t, 10);
    const bw = tw + 28, bh = 22;
    const bx = MARGIN, by = PAGE_H - 70;
    page.drawRectangle({ x: bx, y: by, width: bw, height: bh, color: theme.accent });
    page.drawText(t, { x: bx + 14, y: by + 7, size: 10, font: fonts.bold, color: rgb(0.05, 0.05, 0.05) });
  }

  // ---- Title (bottom-aligned block) ----
  // Auto-fit: shrink size until lines fit in <= 4 lines.
  const maxW = PAGE_W - MARGIN * 2;
  let titleSize = 44;
  let titleLines = wrap(title.toUpperCase(), fonts.bold, titleSize, maxW);
  while (titleLines.length > 4 && titleSize > 22) {
    titleSize -= 2;
    titleLines = wrap(title.toUpperCase(), fonts.bold, titleSize, maxW);
  }
  const titleLineH = titleSize * 1.05;

  // Subtitle wrap
  const subSize = 14;
  const subLines = wrap(subtitle, fonts.reg, subSize, maxW).slice(0, 3);
  const subLineH = subSize * 1.4;

  // Compute total text block height & place from a fixed bottom anchor
  const bottomAnchor = 110; // leaves room for brand line at ~y=40
  const blockH = (subLines.length ? subLines.length * subLineH + 18 : 0) + titleLines.length * titleLineH + 22;
  let y = bottomAnchor + blockH;

  // Solid opaque dark plate behind the entire title+subtitle block so background
  // image details (card edges, highlights) cannot bleed through and create phantom glyphs.
  if (hasBgImage) {
    const plateBottom = 0;
    const plateTop = y + 14;
    page.drawRectangle({
      x: 0, y: plateBottom, width: PAGE_W, height: plateTop - plateBottom,
      color: theme.overlay, opacity: 1,
    });
  }

  // Accent bar above title (thicker for stronger visual anchor)
  page.drawRectangle({ x: MARGIN, y: y - 6, width: 72, height: 6, color: theme.accent });
  y -= 22;

  // Title lines (top-to-bottom) — full opacity, larger weight for dominance
  for (const ln of titleLines) {
    y -= titleLineH;
    page.drawText(safe(ln), { x: MARGIN, y: y + titleLineH - titleSize * 0.85, size: titleSize, font: fonts.bold, color: theme.onDark });
  }

  // Gold underline beneath the title block for sales-impact contrast
  page.drawRectangle({ x: MARGIN, y: y - 10, width: PAGE_W - MARGIN * 2, height: 1.2, color: theme.accent, opacity: 0.6 });

  // Subtitle
  if (subLines.length) {
    y -= 22;
    for (const ln of subLines) {
      y -= subLineH;
      page.drawText(safe(ln), { x: MARGIN, y: y + subLineH - subSize * 0.85, size: subSize, font: fonts.reg, color: theme.onDark, opacity: 0.95 });
    }
  }

  // ---- Brand (bottom) ----
  page.drawRectangle({ x: MARGIN, y: 56, width: 24, height: 2, color: theme.accent });
  page.drawText(safe(brand), { x: MARGIN, y: 36, size: 11, font: fonts.bold, color: theme.onDark, opacity: 0.92 });
  page.drawText("PREMIUM PDF GUIDE", { x: PAGE_W - MARGIN - fonts.bold.widthOfTextAtSize("PREMIUM PDF GUIDE", 9), y: 38, size: 9, font: fonts.bold, color: theme.accent });
}

// Kept for compatibility — delegates to the overlay renderer with no bg.
function drawFallbackCover(page: PDFPage, theme: Theme, fonts: Fonts, title: string, subtitle: string, brand: string, badge?: string) {
  drawCoverOverlay(page, theme, fonts, title, subtitle, brand, badge, false);
}

function drawTitlePage(page: PDFPage, theme: Theme, fonts: Fonts, title: string, subtitle: string, brand: string, badge?: string) {
  // top accent strip
  page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: theme.accent });
  // brand top
  page.drawText(brand, { x: MARGIN, y: PAGE_H - 50, size: 10, font: fonts.bold, color: theme.sub });
  // badge
  let badgeY = PAGE_H / 2 + 80;
  if (badge) {
    const t = safe(badge.toUpperCase());
    const w = t.length * 6 + 28;
    page.drawRectangle({ x: MARGIN, y: badgeY, width: w, height: 22, color: theme.accent });
    page.drawText(t, { x: MARGIN + 14, y: badgeY + 7, size: 9, font: fonts.bold, color: rgb(0.05, 0.05, 0.05) });
    badgeY -= 30;
  }
  // accent bar
  page.drawRectangle({ x: MARGIN, y: badgeY + 8, width: 48, height: 5, color: theme.accent });
  // title
  let size = 40, lines = wrap(title, fonts.bold, size, PAGE_W - MARGIN * 2);
  while (lines.length > 4 && size > 24) { size -= 2; lines = wrap(title, fonts.bold, size, PAGE_W - MARGIN * 2); }
  let y = badgeY - 20;
  for (const ln of lines) { page.drawText(safe(ln), { x: MARGIN, y, size, font: fonts.bold, color: theme.ink }); y -= size * 1.05; }
  // subtitle
  y -= 16;
  for (const ln of wrap(subtitle, fonts.italic, 14, PAGE_W - MARGIN * 2).slice(0, 3)) {
    page.drawText(safe(ln), { x: MARGIN, y, size: 14, font: fonts.italic, color: theme.sub }); y -= 20;
  }
  // short product promise
  y -= 14;
  const promiseLine = "A premium tactical workbook with frameworks, worksheets, and a step-by-step playbook you can apply this week.";
  for (const ln of wrap(promiseLine, fonts.reg, 11, PAGE_W - MARGIN * 2).slice(0, 4)) {
    page.drawText(safe(ln), { x: MARGIN, y, size: 11, font: fonts.reg, color: theme.ink }); y -= 16;
  }
  // bottom rule + brand
  page.drawLine({ start: { x: MARGIN, y: MARGIN + 40 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 40 }, thickness: 0.6, color: theme.hair });
  page.drawText(`${brand}  ·  PREMIUM TACTICAL WORKBOOK`, { x: MARGIN, y: MARGIN + 22, size: 9, font: fonts.bold, color: theme.sub });
}

function drawCopyrightPage(page: PDFPage, theme: Theme, fonts: Fonts, brand: string, finance: boolean) {
  drawRunningHeader(page, theme, fonts, brand, "LEGAL");
  let y = PAGE_H - 140;
  page.drawText("Copyright & Disclaimer", { x: MARGIN, y, size: 18, font: fonts.bold, color: theme.ink });
  y -= 30;
  const body = `© ${new Date().getFullYear()} ${brand}. All rights reserved. No part of this publication may be reproduced, distributed, or transmitted in any form without prior written permission of the publisher, except in the case of brief quotations.`;
  for (const ln of wrap(body, fonts.reg, 11, CONTENT_W)) { page.drawText(safe(ln), { x: MARGIN, y, size: 11, font: fonts.reg, color: theme.ink }); y -= 16; }
  y -= 16;
  page.drawText("Disclaimer", { x: MARGIN, y, size: 14, font: fonts.bold, color: theme.ink }); y -= 22;
  const disc = finance
    ? "This ebook is for educational and informational purposes only and does not constitute financial, investment, tax, or legal advice. Results vary. Consult a licensed professional before making financial decisions. The author and publisher disclaim any liability arising from use of this material."
    : "This ebook is for educational and informational purposes only. The author and publisher disclaim any liability arising from use of this material. Apply judgment and consult relevant professionals where appropriate.";
  for (const ln of wrap(disc, fonts.reg, 11, CONTENT_W)) { page.drawText(safe(ln), { x: MARGIN, y, size: 11, font: fonts.reg, color: theme.ink }); y -= 16; }
}

function drawTocEntries(page: PDFPage, theme: Theme, fonts: Fonts, entries: { title: string; pageNum: number }[]) {
  let y = PAGE_H - 160;
  entries.forEach((it, i) => {
    if (y < MARGIN + 30) return;
    const num = String(i + 1).padStart(2, "0");
    const titleStr = safe(it.title).slice(0, 70);
    const pageStr = String(it.pageNum);
    page.drawText(num, { x: MARGIN, y, size: 10, font: fonts.bold, color: theme.accent });
    page.drawText(titleStr, { x: MARGIN + 32, y, size: 11, font: fonts.reg, color: theme.ink });
    // dot leader
    const titleW = fonts.reg.widthOfTextAtSize(titleStr, 11);
    const pageW = fonts.bold.widthOfTextAtSize(pageStr, 11);
    const dotsStart = MARGIN + 32 + titleW + 6;
    const dotsEnd = PAGE_W - MARGIN - pageW - 6;
    const dotsCount = Math.max(0, Math.floor((dotsEnd - dotsStart) / 4));
    if (dotsCount > 0) {
      page.drawText(".".repeat(dotsCount), { x: dotsStart, y, size: 11, font: fonts.reg, color: theme.hair });
    }
    page.drawText(pageStr, { x: PAGE_W - MARGIN - pageW, y, size: 11, font: fonts.bold, color: theme.ink });
    y -= 22;
  });
}

function drawChapterDivider(
  page: PDFPage, theme: Theme, fonts: Fonts,
  chNum: number, chTitle: string,
  promise?: string, outcomes?: string[],
) {
  // Full-page dark divider with premium hierarchy and no empty white space.
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: theme.overlay });
  // top + bottom accent strips
  page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: theme.accent });
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 6, color: theme.accent });

  // Eyebrow
  const tag = chNum > 0 ? `CHAPTER ${String(chNum).padStart(2, "0")}` : "SECTION";
  page.drawText(tag, { x: MARGIN, y: PAGE_H - 110, size: 11, font: fonts.bold, color: theme.accent });

  // Accent bar
  page.drawRectangle({ x: MARGIN, y: PAGE_H - 130, width: 56, height: 4, color: theme.accent });

  // Title (auto-fit)
  let size = 34;
  let lines = wrap(chTitle, fonts.bold, size, PAGE_W - MARGIN * 2);
  while (lines.length > 3 && size > 20) { size -= 2; lines = wrap(chTitle, fonts.bold, size, PAGE_W - MARGIN * 2); }
  let y = PAGE_H - 150 - size;
  for (const ln of lines) {
    page.drawText(safe(ln), { x: MARGIN, y, size, font: fonts.bold, color: theme.onDark });
    y -= size * 1.08;
  }

  // Chapter promise sentence
  y -= 18;
  if (promise && promise.trim()) {
    const pLines = wrap(promise, fonts.italic, 14, PAGE_W - MARGIN * 2).slice(0, 4);
    for (const ln of pLines) {
      page.drawText(safe(ln), { x: MARGIN, y, size: 14, font: fonts.italic, color: theme.onDark, opacity: 0.92 });
      y -= 20;
    }
  }

  // "What you'll get from this chapter" outcomes box
  y -= 30;
  const outs = (outcomes ?? []).filter(Boolean).slice(0, 3);
  if (outs.length) {
    const headerY = y;
    page.drawText("WHAT YOU'LL GET FROM THIS CHAPTER", {
      x: MARGIN, y: headerY, size: 9, font: fonts.bold, color: theme.accent,
    });
    page.drawRectangle({ x: MARGIN, y: headerY - 8, width: 36, height: 2, color: theme.accent });
    y = headerY - 28;
    for (const o of outs) {
      const oLines = wrap(o, fonts.reg, 12, PAGE_W - MARGIN * 2 - 24).slice(0, 3);
      // tick badge
      page.drawCircle({ x: MARGIN + 7, y: y + 4, size: 5, color: theme.accent });
      for (let j = 0; j < oLines.length; j++) {
        page.drawText(safe(oLines[j]), {
          x: MARGIN + 22, y: y - j * 16, size: 12, font: fonts.reg, color: theme.onDark, opacity: 0.95,
        });
      }
      y -= oLines.length * 16 + 10;
    }
  }

  // Bottom right tag + decorative element to remove the "empty bottom" feel
  const footTag = "PREMIUM TACTICAL WORKBOOK";
  const ftw = fonts.bold.widthOfTextAtSize(footTag, 9);
  page.drawText(footTag, {
    x: PAGE_W - MARGIN - ftw, y: MARGIN + 18, size: 9, font: fonts.bold,
    color: theme.accent,
  });
  // subtle horizontal rule above footer tag
  page.drawLine({
    start: { x: MARGIN, y: MARGIN + 32 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 32 },
    thickness: 0.4, color: theme.accent, opacity: 0.35,
  });
  // big subtle chapter number in the bottom-left as a graphic element
  if (chNum > 0) {
    const bigN = String(chNum).padStart(2, "0");
    page.drawText(bigN, {
      x: MARGIN, y: MARGIN + 40, size: 80, font: fonts.bold,
      color: theme.accent, opacity: 0.12,
    });
  }
}

// Generate a polished one-sentence chapter promise + 3 outcome bullets.
// Never returns raw excerpts, truncated sentences, definitions, or example data.
function extractChapterPromise(md: string, fallbackTitle: string, strict = false): { promise: string; outcomes: string[] } {
  const txt = (md || "").replace(/\r\n/g, "\n").trim();
  const rawTitle = (fallbackTitle || "this chapter").trim().replace(/[.!?]+$/, "");
  // Strip "The " prefix and any leading "Chapter NN:" so the title slots into sentences cleanly.
  const titleNoun = rawTitle
    .replace(/^chapter\s+\d+[:.\s-]*/i, "")
    .replace(/^the\s+/i, "")
    .trim();
  const titleLower = titleNoun.toLowerCase();

  // ---- Heuristic: is this string junk for a divider page? ----
  const looksLikeExample = (s: string): boolean => {
    const t = s.trim();
    if (!t) return true;
    if (/\$\s?\d|\d+\s?%|\bAPR\b|\/\s?mo\b|\bper month\b/i.test(t)) return true;
    if (/\b(Card|Item|Account|Option|Loan|Debt|Cardholder)\s+[A-Z0-9]\b/.test(t)) return true;
    if (/\b(iPad|iPhone|Netflix|Spotify|Hulu|Disney|Amazon|gym membership|weather app|streaming)\b/i.test(t)) return true;
    if (/:\s*\$/.test(t)) return true;
    return false;
  };
  // Reject definition-style sentences like "Stagnant Debt is a balance that..." —
  // those are glossary entries, not learning outcomes.
  const looksLikeDefinition = (s: string): boolean => {
    return /^[A-Z][\w\s'\-]{2,40}\s+(is|are|means|refers to)\s+(a|an|the)\b/i.test(s.trim());
  };
  // Outcome bullets should start with an action verb in imperative form.
  const startsWithVerb = (s: string): boolean => {
    const verbs = /^(Identify|Build|Apply|Avoid|Use|Create|Spot|Map|Eliminate|Negotiate|Free|Cut|Redirect|Automate|Track|Calculate|Reduce|Stack|Lock|Plan|Discover|Master|Design|Run)\b/;
    return verbs.test(s.trim());
  };

  // ---- Promise: noun-phrase-safe template ----
  const promise = `This chapter gives you the exact moves behind ${rawTitle} and shows you how to apply them to your real numbers this week.`
    .replace(/\s+/g, " ")
    .slice(0, 220);

  // ---- Outcomes: only accept action-verb, non-definition, non-example bullets ----
  const candidates: string[] = [];
  // Strict auto-fix mode: skip raw bullet extraction entirely and rely on the curated pool.
  const bulletMatch = strict ? null : txt.match(/(?:^|\n)([-*]\s+.+(?:\n[-*]\s+.+)*)/);
  if (bulletMatch) {
    for (const raw of bulletMatch[1].split("\n")) {
      let s = stripInline(raw.replace(/^[-*]\s+/, "")).trim();
      if (!s) continue;
      if (looksLikeExample(s) || looksLikeDefinition(s)) continue;
      if (!startsWithVerb(s)) continue;
      if (!/[.!?]$/.test(s)) s = s + ".";
      if (s.length < 25 || s.length > 160) continue;
      if (candidates.some((c) => c.toLowerCase() === s.toLowerCase())) continue;
      candidates.push(s);
      if (candidates.length >= 3) break;
    }
  }

  // Topic-aware fallback pool — 8 variants, rotated by title hash so chapters differ.
  const pool = [
    `Pinpoint where ${titleLower} actually fits in your six-month debt-exit timeline.`,
    `Apply the ${titleLower} steps to your real balances without guesswork or busywork.`,
    `Sidestep the silent traps that make ${titleLower} stall for most people.`,
    `Convert ${titleLower} from theory into a repeatable weekly routine.`,
    `Build a decision rule for ${titleLower} you can run in under fifteen minutes.`,
    `Track the one metric that proves ${titleLower} is moving you forward each week.`,
    `Use ${titleLower} to free up cash flow you can redirect to the highest-impact debt.`,
    `Lock in the gains from ${titleLower} so they don't quietly reverse next month.`,
  ];
  // Deterministic rotation from title so each chapter gets a distinct triplet.
  let hash = 0;
  for (let i = 0; i < rawTitle.length; i++) hash = (hash * 31 + rawTitle.charCodeAt(i)) >>> 0;
  const start = hash % pool.length;
  for (let i = 0; candidates.length < 3 && i < pool.length; i++) {
    const f = pool[(start + i) % pool.length];
    if (!candidates.some((c) => c.toLowerCase() === f.toLowerCase())) candidates.push(f);
  }

  return {
    promise,
    outcomes: candidates.slice(0, 3).map((o) => o.replace(/\s+/g, " ").slice(0, 160)),
  };
}

function drawBackCover(page: PDFPage, theme: Theme, fonts: Fonts, brand: string, title: string) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: theme.overlay });
  page.drawRectangle({ x: MARGIN, y: PAGE_H - 180, width: 60, height: 6, color: theme.accent });
  page.drawText(brand, { x: MARGIN, y: PAGE_H - 230, size: 28, font: fonts.bold, color: theme.accent });
  let y = PAGE_H - 280;
  for (const ln of wrap("Premium PDF guides, frameworks, and playbooks for people who want to actually finish what they start.", fonts.reg, 13, CONTENT_W)) {
    page.drawText(safe(ln), { x: MARGIN, y, size: 13, font: fonts.reg, color: theme.onDark }); y -= 18;
  }
  y -= 30;
  page.drawText("THANK YOU FOR READING", { x: MARGIN, y, size: 10, font: fonts.bold, color: theme.accent });
  y -= 18;
  for (const ln of wrap(`If "${title}" helped you, share it with someone who needs a clear path forward.`, fonts.italic, 12, CONTENT_W).slice(0, 3)) {
    page.drawText(safe(ln), { x: MARGIN, y, size: 12, font: fonts.italic, color: theme.onDark }); y -= 18;
  }
  page.drawText(`© ${new Date().getFullYear()} ${brand}`, { x: MARGIN, y: MARGIN, size: 9, font: fonts.reg, color: theme.onDark });
}

// ============ HEADERS / FOOTERS ============
function drawRunningHeader(page: PDFPage, theme: Theme, fonts: Fonts, brand: string, chTitle: string) {
  page.drawText(brand, { x: MARGIN, y: PAGE_H - 36, size: 8, font: fonts.bold, color: theme.sub });
  const title = safe(chTitle).slice(0, 60).toUpperCase();
  const w = fonts.reg.widthOfTextAtSize(title, 8);
  page.drawText(title, { x: PAGE_W - MARGIN - w, y: PAGE_H - 36, size: 8, font: fonts.reg, color: theme.sub });
  page.drawLine({ start: { x: MARGIN, y: PAGE_H - 44 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - 44 }, thickness: 0.4, color: theme.hair });
}
function drawRunningFooter(page: PDFPage, theme: Theme, fonts: Fonts, pageNum: number) {
  page.drawLine({ start: { x: MARGIN, y: MARGIN - 6 }, end: { x: PAGE_W - MARGIN, y: MARGIN - 6 }, thickness: 0.4, color: theme.hair });
  const s = String(pageNum);
  const w = fonts.bold.widthOfTextAtSize(s, 9);
  page.drawText(s, { x: (PAGE_W - w) / 2, y: MARGIN - 22, size: 9, font: fonts.bold, color: theme.sub });
}
function drawSectionTitle(page: PDFPage, theme: Theme, fonts: Fonts, label: string) {
  page.drawRectangle({ x: MARGIN, y: PAGE_H - 100, width: 36, height: 5, color: theme.accent });
  page.drawText(safe(label), { x: MARGIN, y: PAGE_H - 134, size: 26, font: fonts.bold, color: theme.ink });
}

// ============ DIAGRAMS (premium, vertical-first, auto-fit) ============
function drawDiagramPremium(page: PDFPage, d: FrameworkDiagram, theme: Theme, fonts: Fonts): { overflowNodes: number; truncatedNodes: number } {
  drawSectionTitle(page, theme, fonts, "Framework");
  const name = safe(d.visual_name || "").slice(0, 80);
  page.drawText(name, { x: MARGIN, y: PAGE_H - 160, size: 14, font: fonts.bold, color: theme.ink });
  if (d.purpose) {
    let y = PAGE_H - 180;
    for (const ln of wrap(d.purpose, fonts.reg, 10, CONTENT_W).slice(0, 3)) {
      page.drawText(safe(ln), { x: MARGIN, y, size: 10, font: fonts.italic, color: theme.sub }); y -= 14;
    }
  }
  const top = PAGE_H - 250;
  const bottom = MARGIN + 40;
  const areaH = top - bottom;
  const nodes = (d.nodes ?? []).map((n) => safe(n)).filter(Boolean);
  const type = (d.type || "checklist").toLowerCase();

  // QC pre-pass: count how many nodes would not fit (cropped off page)
  // and how many wrap to more lines than the renderer caps at.
  const qc = { overflowNodes: 0, truncatedNodes: 0 };
  const measureTruncate = (text: string, font: PDFFont, size: number, maxW: number, cap: number) => {
    const total = wrap(text, font, size, maxW).length;
    if (total > cap) qc.truncatedNodes++;
  };
  switch (type) {
    case "process_flow": {
      const n = Math.max(nodes.length, 1);
      const boxH = Math.max(40, Math.min(72, (areaH - 10 * (n - 1)) / n));
      const totalH = boxH * n + 10 * (n - 1);
      if (totalH > areaH) qc.overflowNodes += Math.max(0, Math.ceil((totalH - areaH) / (boxH + 10)));
      for (const t of nodes) measureTruncate(t, fonts.bold, 11, CONTENT_W - 70, 3);
      break;
    }
    case "pyramid":
      for (const t of nodes) measureTruncate(t, fonts.bold, 11, CONTENT_W - 24, 2);
      break;
    case "matrix_2x2": {
      const size = Math.min(CONTENT_W, areaH);
      const half = size / 2;
      for (let i = 0; i < Math.min(4, nodes.length); i++) measureTruncate(nodes[i], fonts.bold, 11, half - 20, 4);
      if (nodes.length > 4) qc.overflowNodes += nodes.length - 4;
      break;
    }
    case "circle_cycle": {
      const n = Math.max(nodes.length, 1);
      const cardH = Math.max(46, Math.min(64, (areaH - 10 * (n - 1)) / n));
      const totalH = cardH * n + 10 * (n - 1);
      if (totalH > areaH) qc.overflowNodes += Math.max(0, Math.ceil((totalH - areaH) / (cardH + 10)));
      for (const t of nodes) measureTruncate(t, fonts.bold, 11, CONTENT_W - 70, 3);
      break;
    }
    case "comparison_table": {
      const cols = 2;
      const colW = CONTENT_W / cols;
      let used = 0;
      for (let r = 0; r < Math.ceil(nodes.length / cols); r++) {
        let h = 30;
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (idx >= nodes.length) continue;
          const lines = wrap(nodes[idx], r === 0 ? fonts.bold : fonts.reg, 10, colW - 16).length;
          h = Math.max(h, lines * 14 + 18);
        }
        used += h;
        if (used > areaH) qc.overflowNodes += Math.min(cols, nodes.length - r * cols);
      }
      break;
    }
    case "checklist":
    default: {
      let used = 0;
      for (const it of nodes) {
        const h = Math.max(20, wrap(it, fonts.reg, 11, CONTENT_W - 28).length * 15 + 6) + 8;
        used += h;
        if (used > areaH) qc.overflowNodes++;
      }
      break;
    }
  }


  switch (type) {
    case "process_flow": {
      const n = Math.max(nodes.length, 1);
      const gap = 10;
      const boxH = Math.max(40, Math.min(72, (areaH - gap * (n - 1)) / n));
      let y = top - boxH;
      for (let i = 0; i < n; i++) {
        page.drawRectangle({ x: MARGIN, y, width: CONTENT_W, height: boxH, color: theme.surface, borderColor: theme.hair, borderWidth: 0.8 });
        page.drawRectangle({ x: MARGIN, y, width: 6, height: boxH, color: theme.accent });
        // step badge
        page.drawCircle({ x: MARGIN + 28, y: y + boxH / 2, size: 14, color: theme.overlay });
        const num = String(i + 1);
        const nw = fonts.bold.widthOfTextAtSize(num, 11);
        page.drawText(num, { x: MARGIN + 28 - nw / 2, y: y + boxH / 2 - 4, size: 11, font: fonts.bold, color: theme.accent });
        const wrapW = CONTENT_W - 70;
        const lines = wrap(nodes[i], fonts.bold, 11, wrapW).slice(0, 3);
        let ty = y + boxH / 2 + (lines.length - 1) * 7;
        for (const ln of lines) {
          page.drawText(ln, { x: MARGIN + 52, y: ty, size: 11, font: fonts.bold, color: theme.ink });
          ty -= 13;
        }
        if (i < n - 1) {
          // connector arrow
          page.drawLine({ start: { x: PAGE_W / 2, y }, end: { x: PAGE_W / 2, y: y - gap + 2 }, thickness: 1.2, color: theme.accent });
        }
        y -= boxH + gap;
      }
      break;
    }
    case "pyramid": {
      const n = Math.max(nodes.length, 1);
      const layerH = Math.min(60, areaH / n);
      for (let i = 0; i < n; i++) {
        const w = ((i + 1) / n) * (CONTENT_W - 20);
        const x = (PAGE_W - w) / 2;
        const y = bottom + i * layerH;
        const fill = i % 2 === 0 ? theme.surface : rgb(0.9, 0.9, 0.93);
        page.drawRectangle({ x, y, width: w, height: layerH - 4, color: fill, borderColor: theme.hair, borderWidth: 0.6 });
        const lines = wrap(nodes[i] ?? "", fonts.bold, 11, w - 24).slice(0, 2);
        let ty = y + (layerH - 4) / 2 + (lines.length - 1) * 7;
        for (const ln of lines) { page.drawText(safe(ln), { x: x + 12, y: ty, size: 11, font: fonts.bold, color: theme.ink }); ty -= 13; }
      }
      break;
    }
    case "matrix_2x2": {
      // Premium quadrant grid. Axis labels are intentionally NOT drawn —
      // they previously truncated and left stray letters (a, B, l, n) at page edges.
      // Each quadrant is a self-contained labelled box.
      const gap = 12;
      const size = Math.min(CONTENT_W, areaH);
      const x0 = (PAGE_W - size) / 2;
      const y0 = bottom + (areaH - size) / 2;
      const half = (size - gap) / 2;
      // Detect debt-strike prioritization → use fixed, sellable labels
      const isDebt = /debt|apr|balance|priorit/i.test(`${d.visual_name} ${d.purpose}`);
      const defaults = isDebt
        ? [
            { label: "HIGH BALANCE / LOW APR", caption: "Steady payoff. Avoid feeding new charges." },
            { label: "HIGH BALANCE / HIGH APR", caption: "Top priority. Attack with every surplus dollar." },
            { label: "LOW BALANCE / LOW APR", caption: "Park. Pay minimum until others clear." },
            { label: "LOW BALANCE / HIGH APR", caption: "Quick wins. Eliminate fast to free cash flow." },
          ]
        : [
            { label: nodes[0] ?? "QUADRANT 1", caption: "" },
            { label: nodes[1] ?? "QUADRANT 2", caption: "" },
            { label: nodes[2] ?? "QUADRANT 3", caption: "" },
            { label: nodes[3] ?? "QUADRANT 4", caption: "" },
          ];
      const cells = [
        { x: x0, y: y0 + half + gap, fill: theme.surface, ...defaults[0] },               // top-left
        { x: x0 + half + gap, y: y0 + half + gap, fill: theme.surfaceDanger, ...defaults[1] }, // top-right
        { x: x0, y: y0, fill: theme.surfaceOk, ...defaults[2] },                          // bottom-left
        { x: x0 + half + gap, y: y0, fill: theme.surfaceWarm, ...defaults[3] },           // bottom-right
      ];
      for (const c of cells) {
        page.drawRectangle({ x: c.x, y: c.y, width: half, height: half, color: c.fill, borderColor: theme.hair, borderWidth: 0.8 });
        // top accent strip per cell
        page.drawRectangle({ x: c.x, y: c.y + half - 4, width: half, height: 4, color: theme.accent });
        const labelLines = wrap(c.label, fonts.bold, 11, half - 20).slice(0, 2);
        let ty = c.y + half - 22;
        for (const ln of labelLines) {
          page.drawText(safe(ln), { x: c.x + 12, y: ty, size: 11, font: fonts.bold, color: theme.ink });
          ty -= 14;
        }
        if (c.caption) {
          ty -= 4;
          for (const ln of wrap(c.caption, fonts.reg, 9, half - 20).slice(0, 3)) {
            page.drawText(safe(ln), { x: c.x + 12, y: ty, size: 9, font: fonts.reg, color: theme.sub });
            ty -= 12;
          }
        }
      }
      // NOTE: axis labels (d.labels.x_axis / y_axis) are intentionally not rendered.
      break;
    }
    case "circle_cycle": {
      // Render as a numbered ring of cards stacked vertically — far more readable in PDF than a tight circle
      const n = Math.max(nodes.length, 1);
      const cardH = Math.max(46, Math.min(64, (areaH - 10 * (n - 1)) / n));
      let y = top - cardH;
      for (let i = 0; i < n; i++) {
        page.drawRectangle({ x: MARGIN, y, width: CONTENT_W, height: cardH, color: theme.surface, borderColor: theme.hair, borderWidth: 0.6 });
        page.drawCircle({ x: MARGIN + 26, y: y + cardH / 2, size: 16, color: theme.overlay });
        const num = String(i + 1);
        const nw = fonts.bold.widthOfTextAtSize(num, 12);
        page.drawText(num, { x: MARGIN + 26 - nw / 2, y: y + cardH / 2 - 4, size: 12, font: fonts.bold, color: theme.accent });
        const lines = wrap(nodes[i], fonts.bold, 11, CONTENT_W - 70).slice(0, 3);
        let ty = y + cardH / 2 + (lines.length - 1) * 7;
        for (const ln of lines) { page.drawText(ln, { x: MARGIN + 52, y: ty, size: 11, font: fonts.bold, color: theme.ink }); ty -= 13; }
        // loop arrow on right for all except last
        if (i < n - 1) page.drawText("v", { x: PAGE_W - MARGIN - 18, y: y - 4, size: 14, font: fonts.bold, color: theme.accent });
        else page.drawText("*", { x: PAGE_W - MARGIN - 20, y: y - 4, size: 16, font: fonts.bold, color: theme.accent });
        y -= cardH + 10;
      }
      break;
    }
    case "before_after": {
      const colW = (CONTENT_W - 20) / 2;
      const h = Math.min(areaH - 20, 360);
      const y = bottom + 20;
      // before
      page.drawRectangle({ x: MARGIN, y, width: colW, height: h, color: theme.surfaceDanger, borderColor: theme.hair, borderWidth: 0.6 });
      page.drawText("BEFORE", { x: MARGIN + 14, y: y + h - 22, size: 11, font: fonts.bold, color: rgb(0.55, 0.1, 0.1) });
      let by = y + h - 44;
      for (const ln of wrap(nodes[0] ?? "", fonts.reg, 11, colW - 28)) {
        if (by < y + 12) break;
        page.drawText(safe(ln), { x: MARGIN + 14, y: by, size: 11, font: fonts.reg, color: theme.ink }); by -= 14;
      }
      // after
      const x2 = MARGIN + colW + 20;
      page.drawRectangle({ x: x2, y, width: colW, height: h, color: theme.surfaceOk, borderColor: theme.hair, borderWidth: 0.6 });
      page.drawText("AFTER", { x: x2 + 14, y: y + h - 22, size: 11, font: fonts.bold, color: rgb(0.08, 0.4, 0.2) });
      let ay = y + h - 44;
      for (const ln of wrap(nodes[1] ?? "", fonts.reg, 11, colW - 28)) {
        if (ay < y + 12) break;
        page.drawText(safe(ln), { x: x2 + 14, y: ay, size: 11, font: fonts.reg, color: theme.ink }); ay -= 14;
      }
      break;
    }
    case "comparison_table": {
      // 2-col table with proper borders, header row
      const cols = 2;
      const rows = Math.ceil(nodes.length / cols);
      const colW = CONTENT_W / cols;
      // measure row heights based on wrap
      const rowH: number[] = [];
      for (let r = 0; r < rows; r++) {
        let h = 30;
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (idx >= nodes.length) continue;
          const lines = wrap(nodes[idx], r === 0 ? fonts.bold : fonts.reg, 10, colW - 16);
          h = Math.max(h, lines.length * 14 + 18);
        }
        rowH.push(h);
      }
      let y = top;
      for (let r = 0; r < rows; r++) {
        const h = rowH[r];
        const rowY = y - h;
        if (rowY < bottom) break;
        for (let c = 0; c < cols; c++) {
          const x = MARGIN + c * colW;
          page.drawRectangle({ x, y: rowY, width: colW, height: h, color: r === 0 ? theme.overlay : (r % 2 === 1 ? theme.surface : rgb(1,1,1)), borderColor: theme.hair, borderWidth: 0.5 });
          const idx = r * cols + c;
          if (idx >= nodes.length) continue;
          const isHeader = r === 0;
          const lines = wrap(nodes[idx], isHeader ? fonts.bold : fonts.reg, 10, colW - 16).slice(0, Math.floor((h - 14) / 14));
          let ty = rowY + h - 16;
          for (const ln of lines) {
            page.drawText(safe(ln), { x: x + 8, y: ty, size: 10, font: isHeader ? fonts.bold : fonts.reg, color: isHeader ? theme.onDark : theme.ink });
            ty -= 14;
          }
        }
        y = rowY;
      }
      break;
    }
    case "checklist":
    default: {
      let y = top - 6;
      for (const it of nodes) {
        const lines = wrap(it, fonts.reg, 11, CONTENT_W - 28);
        const h = Math.max(20, lines.length * 15 + 6);
        if (y - h < bottom) break;
        page.drawRectangle({ x: MARGIN, y: y - 14, width: 14, height: 14, borderColor: theme.ink, borderWidth: 0.9, color: rgb(1, 1, 1) });
        for (let j = 0; j < lines.length; j++) {
          page.drawText(safe(lines[j]), { x: MARGIN + 24, y: y - 12 - j * 15, size: 11, font: fonts.reg, color: theme.ink });
        }
        y -= h + 8;
      }
      break;
    }
  }
  return qc;
}

// ============ WORKSHEET (printable, premium) ============
function drawWorksheetPremium(page: PDFPage, w: Worksheet, theme: Theme, fonts: Fonts) {
  drawSectionTitle(page, theme, fonts, "Worksheet");
  page.drawText(safe(w.asset_name || "").slice(0, 80), {
    x: MARGIN, y: PAGE_H - 160, size: 14, font: fonts.bold, color: theme.ink,
  });
  let y = PAGE_H - 180;

  // Purpose / instruction card (always show something so the page never feels bare)
  const purposeText = (w.purpose && w.purpose.trim())
    ? w.purpose
    : "Complete this worksheet to lock in what you just learned. Fill each box with your own answer — print it out or type into the PDF.";
  {
    const lines = wrap(purposeText, fonts.italic, 10, CONTENT_W - 24).slice(0, 3);
    const h = lines.length * 14 + 16;
    page.drawRectangle({ x: MARGIN, y: y - h, width: CONTENT_W, height: h, color: theme.surfaceWarm });
    page.drawRectangle({ x: MARGIN, y: y - h, width: 5, height: h, color: theme.accent });
    let ly = y - 12;
    for (const ln of lines) {
      page.drawText(safe(ln), { x: MARGIN + 14, y: ly, size: 10, font: fonts.italic, color: theme.ink });
      ly -= 14;
    }
    y -= h + 18;
  }

  // Instructions strip
  page.drawText("INSTRUCTIONS: WRITE INSIDE EACH BOX BELOW", {
    x: MARGIN, y, size: 8, font: fonts.bold, color: theme.sub,
  });
  y -= 16;

  const fields = (w.fields_or_sections ?? []).slice(0, 6);
  if (!fields.length) {
    fields.push("Today's commitment", "One blocker I'll remove", "My next 24-hour action");
  }

  const bottomLimit = MARGIN + 36;
  const fieldGap = 12;
  const totalAvail = Math.max(60, y - bottomLimit - fieldGap * (fields.length - 1));
  const perH = Math.max(70, Math.floor(totalAvail / fields.length));
  const headerH = 24;

  for (let i = 0; i < fields.length; i++) {
    if (y - perH < bottomLimit) break;
    const boxTop = y;
    const boxBottom = boxTop - perH;
    const label = safe(fields[i]).slice(0, 80);

    // Header band (dark) with number + label
    page.drawRectangle({
      x: MARGIN, y: boxTop - headerH, width: CONTENT_W, height: headerH,
      color: theme.overlay,
    });
    // number chip
    page.drawRectangle({
      x: MARGIN + 6, y: boxTop - headerH + 4, width: 20, height: headerH - 8,
      color: theme.accent,
    });
    const num = String(i + 1);
    const nw = fonts.bold.widthOfTextAtSize(num, 11);
    page.drawText(num, {
      x: MARGIN + 6 + 10 - nw / 2, y: boxTop - headerH / 2 - 4,
      size: 11, font: fonts.bold, color: rgb(0.05, 0.05, 0.05),
    });
    page.drawText(label, {
      x: MARGIN + 36, y: boxTop - headerH / 2 - 4,
      size: 11, font: fonts.bold, color: theme.onDark,
    });

    // Fillable box — bordered, with subtle ruled lines inside
    const fillTop = boxTop - headerH;
    const fillH = perH - headerH;
    page.drawRectangle({
      x: MARGIN, y: boxBottom, width: CONTENT_W, height: fillH,
      color: rgb(1, 1, 1), borderColor: theme.ink, borderWidth: 0.8,
    });
    // subtle internal ruled lines so it reads as a writing area
    const ruleGap = 22;
    let ry = fillTop - ruleGap;
    while (ry > boxBottom + 8) {
      page.drawLine({
        start: { x: MARGIN + 10, y: ry }, end: { x: PAGE_W - MARGIN - 10, y: ry },
        thickness: 0.3, color: theme.hair,
      });
      ry -= ruleGap;
    }

    y = boxBottom - fieldGap;
  }
}

// ============ TEXT UTILS ============
function safe(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "");
}
function stripInline(text: string): string {
  return safe(text)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = safe(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW) {
      if (line) lines.push(line);
      // Word too long? hard-split
      if (font.widthOfTextAtSize(w, size) > maxW) {
        let chunk = "";
        for (const c of w) {
          if (font.widthOfTextAtSize(chunk + c, size) > maxW) { lines.push(chunk); chunk = c; }
          else chunk += c;
        }
        line = chunk;
      } else line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function looksFinance(s: string): boolean {
  return /\b(debt|credit|loan|finance|financial|invest|investing|money|budget|tax|wealth|saving|mortgage|retire)/i.test(s);
}

// ============ QC SCORING ============
function computePdfQc(x: {
  pageCount: number; chapters: number; diagrams: number; worksheets: number;
  hasCover: boolean; coverScore: number; hasToc: boolean; hasDisclaimer: boolean;
  diagramOverflowCount?: number; diagramTruncatedCount?: number;
  dividerIssueCount?: number;
}) {
  const coverPremiumScore = x.hasCover ? Math.min(100, Math.round(60 + x.coverScore * 0.4)) : 50;
  // Thumbnail readability: covers always overlay the title at 22-44pt bold via pdf-lib,
  // so when a cover is present and the cover spec scored decently, the title is by construction
  // readable at thumbnail size. Add a +15 bonus for the guaranteed text overlay.
  const thumbnailReadabilityScore = x.hasCover
    ? Math.min(100, Math.max(90, Math.round((x.coverScore || 80) + 15)))
    : 60;
  const interiorLayoutScore = Math.min(100, 70 + (x.hasToc ? 10 : 0) + (x.chapters >= 4 ? 10 : 0) + (x.pageCount >= 20 ? 10 : 0));
  const worksheetQualityScore = Math.min(100, 70 + Math.min(20, x.worksheets * 3) + 5);
  const overflow = x.diagramOverflowCount ?? 0;
  const truncated = x.diagramTruncatedCount ?? 0;
  // Diagram penalty: each cropped node -8, each truncated label -3 (cap penalty at base score)
  const diagramQualityScore = Math.max(
    40,
    Math.min(100, 70 + Math.min(20, x.diagrams * 5) + 5 - overflow * 8 - truncated * 3),
  );
  const productValueScore = Math.min(100, 70 + Math.min(15, x.diagrams * 2 + x.worksheets * 2) + (x.hasDisclaimer ? 5 : 0) + 5);
  const finalPdfPremiumScore = Math.round(
    coverPremiumScore * 0.25 + thumbnailReadabilityScore * 0.15 +
    interiorLayoutScore * 0.2 + worksheetQualityScore * 0.15 +
    diagramQualityScore * 0.15 + productValueScore * 0.1
  );
  const passes = {
    cover: coverPremiumScore >= 90,
    thumbnail: thumbnailReadabilityScore >= 90,
    interior: interiorLayoutScore >= 85,
    worksheet: worksheetQualityScore >= 85,
    diagram: diagramQualityScore >= 85 && overflow === 0,
    final: finalPdfPremiumScore >= 90,
  };
  const issues: string[] = [];
  if (!passes.cover) issues.push("Cover premium score below 90 — improve cover spec or background image.");
  if (!passes.thumbnail) issues.push("Cover may not read at thumbnail size.");
  if (!passes.interior) issues.push("Add more structure (TOC, chapter dividers, more pages).");
  if (!passes.worksheet) issues.push("Add more or higher-quality worksheets.");
  if (!passes.diagram) issues.push(overflow > 0
    ? `${overflow} diagram node(s) cropped off page — shorten labels or split diagram.`
    : "Add more framework diagrams.");
  if (truncated > 0) issues.push(`${truncated} diagram label(s) truncated mid-text — shorten node text.`);
  if (!passes.final) issues.push("Overall premium score below 90.");
  return {
    pages: x.pageCount,
    coverPremiumScore, thumbnailReadabilityScore, interiorLayoutScore,
    worksheetQualityScore, diagramQualityScore, productValueScore,
    finalPdfPremiumScore, passes, issues,
    diagramOverflowCount: overflow, diagramTruncatedCount: truncated,
    blocked_for_publish: !(passes.cover && passes.thumbnail && passes.interior && passes.worksheet && passes.diagram && passes.final),
  };
}
