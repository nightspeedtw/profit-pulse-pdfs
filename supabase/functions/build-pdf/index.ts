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
import { corsHeaders, admin, requireAdmin } from "../_shared/ai.ts";

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
    await db.from("ebooks").update({ status: "building_pdf" }).eq("id", ebook_id);

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
    const subtitleText = safe(spec.subtitle_text || e.subtitle || "");

    // ============ 1) COVER (full-bleed image, no extra overlay — image already has text) ============
    const coverPage = pdf.addPage([PAGE_W, PAGE_H]);
    coverPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: theme.overlay });
    const coverSrc = e.cover_url || e.cover_bg_url;
    let coverEmbedded = false;
    if (coverSrc) {
      try {
        const buf = new Uint8Array(await (await fetch(coverSrc)).arrayBuffer());
        const img = await pdf.embedPng(buf).catch(() => pdf.embedJpg(buf));
        coverPage.drawImage(img, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
        coverEmbedded = true;
      } catch { /* fallback below */ }
    }
    if (!coverEmbedded) {
      // Code-rendered fallback cover so PDF still looks premium
      drawFallbackCover(coverPage, theme, fonts, titleText, subtitleText, brand, spec.badge_text);
    }

    // ============ 2) TITLE PAGE ============
    const titlePage = pdf.addPage([PAGE_W, PAGE_H]);
    drawTitlePage(titlePage, theme, fonts, titleText, subtitleText, brand, spec.badge_text);

    // ============ 3) COPYRIGHT / DISCLAIMER ============
    const copyPage = pdf.addPage([PAGE_W, PAGE_H]);
    const isFinance = looksFinance(`${e.title} ${e.subtitle ?? ""} ${e.hook ?? ""}`);
    drawCopyrightPage(copyPage, theme, fonts, brand, isFinance);

    // ============ 4) TOC (will fill in page numbers in a 2nd pass) ============
    const toc = ((e.toc ?? []) as { title: string }[]).slice(0, 24);
    const tocPage = pdf.addPage([PAGE_W, PAGE_H]);
    drawRunningHeader(tocPage, theme, fonts, brand, "TABLE OF CONTENTS");
    drawSectionTitle(tocPage, theme, fonts, "Contents");
    // placeholder, real page nums injected later
    const tocEntries: { title: string; pageNum: number }[] = [];

    // We'll defer drawing TOC entries until chapter pages are emitted; collect their page indexes.
    // ============ 5) CHAPTERS ============
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
    const chapterStartIndex: number[] = []; // 1-based "book page numbers"
    let bookPageNum = 0; // count from after-cover-after-title-after-copy-after-toc = chapter 1 page 1
    let diagramOverflowCount = 0;
    let diagramTruncatedCount = 0;

    // Helper to add an interior page with header+footer and increment counter
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

      // -- Chapter divider page --
      const divider = pdf.addPage([PAGE_W, PAGE_H]);
      bookPageNum += 1;
      drawChapterDivider(divider, theme, fonts, chNum, chShort);
      chapterStartIndex.push(bookPageNum);
      tocEntries.push({ title: ch.title, pageNum: bookPageNum });

      // -- Chapter content --
      let ctx = newInteriorPage(chShort);
      const blocks = parseMarkdown(ch.content || "");
      for (const block of blocks) {
        ctx = renderBlock(pdf, ctx, block, theme, fonts, (t) => newInteriorPage(t), chShort);
      }

      // -- Diagrams for chapter --
      for (const d of (diaMap.get(chNum) ?? [])) {
        const page = pdf.addPage([PAGE_W, PAGE_H]);
        bookPageNum += 1;
        drawRunningHeader(page, theme, fonts, brand, chShort);
        drawRunningFooter(page, theme, fonts, bookPageNum);
        const r = drawDiagramPremium(page, d, theme, fonts);
        diagramOverflowCount += r.overflowNodes;
        diagramTruncatedCount += r.truncatedNodes;
      }
      // -- Worksheets for chapter --
      for (const w of (wsMap.get(chNum) ?? [])) {
        const page = pdf.addPage([PAGE_W, PAGE_H]);
        bookPageNum += 1;
        drawRunningHeader(page, theme, fonts, brand, chShort);
        drawRunningFooter(page, theme, fonts, bookPageNum);
        drawWorksheetPremium(page, w, theme, fonts);
      }
    }

    // ============ 6) BONUSES ============
    const bonuses = (e.bonuses ?? {}) as Record<string, string>;
    if (Object.keys(bonuses).length > 0) {
      const div = pdf.addPage([PAGE_W, PAGE_H]);
      bookPageNum += 1;
      drawChapterDivider(div, theme, fonts, 0, "Bonus Materials");
      tocEntries.push({ title: "Bonus Materials", pageNum: bookPageNum });
      let ctx = newInteriorPage("Bonus Materials");
      for (const [k, v] of Object.entries(bonuses)) {
        const heading: Block = { kind: "h2", text: k.replace(/_/g, " ") };
        const para: Block = { kind: "p", text: String(v).slice(0, 1500) };
        ctx = renderBlock(pdf, ctx, heading, theme, fonts, (t) => newInteriorPage(t), "Bonus Materials");
        ctx = renderBlock(pdf, ctx, para, theme, fonts, (t) => newInteriorPage(t), "Bonus Materials");
      }
    }

    // ============ 7) BACK COVER ============
    const back = pdf.addPage([PAGE_W, PAGE_H]);
    drawBackCover(back, theme, fonts, brand, titleText);

    // ============ 8) Now render TOC entries on the TOC page ============
    drawTocEntries(tocPage, theme, fonts, tocEntries);

    // ============ 9) Save & upload ============
    const bytes = await pdf.save();
    const path = `${ebook_id}/${(e.title || "ebook").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.pdf`;
    const { error: upErr } = await db.storage.from("ebook-pdfs").upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw upErr;
    const { data: signed } = await db.storage.from("ebook-pdfs").createSignedUrl(path, 60 * 60 * 24 * 365);

    // ============ 10) Lightweight PDF QC scoring ============
    const pageCount = pdf.getPageCount();
    const pdfQc = computePdfQc({
      pageCount,
      chapters: chapters.length,
      diagrams: diagrams.length,
      worksheets: worksheets.length,
      hasCover: coverEmbedded,
      coverScore: Number(e.cover_score ?? 0),
      hasToc: tocEntries.length > 0,
      hasDisclaimer: isFinance,
      diagramOverflowCount,
      diagramTruncatedCount,
    });

    await db.from("ebooks").update({
      pdf_url: signed?.signedUrl,
      pdf_qc: pdfQc as unknown as never,
      status: prevStatus === "building_pdf" ? "review" : prevStatus,
    }).eq("id", ebook_id);

    return new Response(JSON.stringify({ pdf_url: signed?.signedUrl, pages: pageCount, qc: pdfQc }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    try {
      const db2 = admin();
      const body = await req.clone().json().catch(() => ({} as Record<string, unknown>));
      const id = (body as { ebook_id?: string }).ebook_id;
      if (id) await db2.from("ebooks").update({ status: "review" }).eq("id", id);
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
function drawFallbackCover(page: PDFPage, theme: Theme, fonts: Fonts, title: string, subtitle: string, brand: string, badge?: string) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: theme.overlay });
  // accent bar
  page.drawRectangle({ x: MARGIN, y: PAGE_H - 200, width: 60, height: 6, color: theme.accent });
  // title
  let size = 38;
  let lines = wrap(title.toUpperCase(), fonts.bold, size, PAGE_W - MARGIN * 2);
  while (lines.length > 4 && size > 22) { size -= 2; lines = wrap(title.toUpperCase(), fonts.bold, size, PAGE_W - MARGIN * 2); }
  let y = PAGE_H - 240;
  for (const ln of lines) { page.drawText(safe(ln), { x: MARGIN, y, size, font: fonts.bold, color: theme.onDark }); y -= size * 1.05; }
  // subtitle
  y -= 20;
  for (const ln of wrap(subtitle, fonts.reg, 14, PAGE_W - MARGIN * 2).slice(0, 3)) {
    page.drawText(safe(ln), { x: MARGIN, y, size: 14, font: fonts.reg, color: theme.onDark }); y -= 20;
  }
  // brand bottom
  page.drawText(brand, { x: MARGIN, y: MARGIN + 12, size: 11, font: fonts.bold, color: theme.accent });
  if (badge) {
    page.drawRectangle({ x: MARGIN, y: PAGE_H - 80, width: badge.length * 6 + 24, height: 22, color: theme.accent });
    page.drawText(safe(badge.toUpperCase()), { x: MARGIN + 12, y: PAGE_H - 73, size: 10, font: fonts.bold, color: rgb(0.05, 0.05, 0.05) });
  }
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
  // bottom rule + brand
  page.drawLine({ start: { x: MARGIN, y: MARGIN + 40 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 40 }, thickness: 0.6, color: theme.hair });
  page.drawText(`${brand}  ·  PREMIUM PDF GUIDE`, { x: MARGIN, y: MARGIN + 22, size: 9, font: fonts.bold, color: theme.sub });
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

function drawChapterDivider(page: PDFPage, theme: Theme, fonts: Fonts, chNum: number, chTitle: string) {
  // top band
  page.drawRectangle({ x: 0, y: PAGE_H - 200, width: PAGE_W, height: 200, color: theme.overlay });
  page.drawRectangle({ x: 0, y: PAGE_H - 206, width: PAGE_W, height: 6, color: theme.accent });
  const tag = chNum > 0 ? `CHAPTER ${String(chNum).padStart(2, "0")}` : "SECTION";
  page.drawText(tag, { x: MARGIN, y: PAGE_H - 90, size: 11, font: fonts.bold, color: theme.accent });
  let size = 32;
  let lines = wrap(chTitle, fonts.bold, size, PAGE_W - MARGIN * 2);
  while (lines.length > 3 && size > 20) { size -= 2; lines = wrap(chTitle, fonts.bold, size, PAGE_W - MARGIN * 2); }
  let y = PAGE_H - 130;
  for (const ln of lines) { page.drawText(safe(ln), { x: MARGIN, y, size, font: fonts.bold, color: theme.onDark }); y -= size * 1.05; }
  // bottom accent square
  page.drawRectangle({ x: PAGE_W - MARGIN - 40, y: MARGIN + 20, width: 40, height: 4, color: theme.accent });
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
      const size = Math.min(CONTENT_W, areaH);
      const x0 = (PAGE_W - size) / 2;
      const y0 = bottom + (areaH - size) / 2;
      const half = size / 2;
      const cells = [
        { x: x0, y: y0 + half, fill: theme.surfaceOk },
        { x: x0 + half, y: y0 + half, fill: theme.surface },
        { x: x0, y: y0, fill: theme.surfaceDanger },
        { x: x0 + half, y: y0, fill: theme.surfaceWarm },
      ];
      cells.forEach((c, i) => {
        page.drawRectangle({ x: c.x, y: c.y, width: half, height: half, color: c.fill, borderColor: theme.hair, borderWidth: 0.6 });
        const lines = wrap(nodes[i] ?? "", fonts.bold, 11, half - 20).slice(0, 4);
        let ty = c.y + half - 16;
        for (const ln of lines) { page.drawText(safe(ln), { x: c.x + 10, y: ty, size: 11, font: fonts.bold, color: theme.ink }); ty -= 14; }
      });
      if (d.labels?.x_axis) {
        page.drawText(safe(d.labels.x_axis[0]), { x: x0, y: y0 - 14, size: 9, font: fonts.reg, color: theme.sub });
        const t = safe(d.labels.x_axis[1]);
        const tw = fonts.reg.widthOfTextAtSize(t, 9);
        page.drawText(t, { x: x0 + size - tw, y: y0 - 14, size: 9, font: fonts.reg, color: theme.sub });
      }
      if (d.labels?.y_axis) {
        page.drawText(safe(d.labels.y_axis[1]), { x: x0 - 50, y: y0 + size - 10, size: 9, font: fonts.reg, color: theme.sub });
        page.drawText(safe(d.labels.y_axis[0]), { x: x0 - 50, y: y0 + 4, size: 9, font: fonts.reg, color: theme.sub });
      }
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
  page.drawText(safe(w.asset_name || "").slice(0, 80), { x: MARGIN, y: PAGE_H - 160, size: 14, font: fonts.bold, color: theme.ink });
  // Purpose card
  let y = PAGE_H - 180;
  if (w.purpose) {
    const lines = wrap(w.purpose, fonts.italic, 10, CONTENT_W - 24).slice(0, 3);
    const h = lines.length * 14 + 16;
    page.drawRectangle({ x: MARGIN, y: y - h, width: CONTENT_W, height: h, color: theme.surfaceWarm });
    page.drawRectangle({ x: MARGIN, y: y - h, width: 5, height: h, color: theme.accent });
    let ly = y - 12;
    for (const ln of lines) { page.drawText(safe(ln), { x: MARGIN + 14, y: ly, size: 10, font: fonts.italic, color: theme.ink }); ly -= 14; }
    y -= h + 18;
  }

  // Instructions hint
  page.drawText("FILL IN THE FIELDS BELOW · PRINT OR USE DIGITALLY", { x: MARGIN, y, size: 8, font: fonts.bold, color: theme.sub });
  y -= 14;

  const fields = (w.fields_or_sections ?? []).slice(0, 10);
  const bottomLimit = MARGIN + 30;
  const sectionGap = 8;
  // Distribute remaining space among fields
  const totalH = Math.max(40, y - bottomLimit);
  const perH = Math.max(80, Math.floor((totalH - sectionGap * fields.length) / Math.max(fields.length, 1)));
  const lineGap = 22;

  for (let i = 0; i < fields.length; i++) {
    if (y - perH < bottomLimit) break;
    const label = safe(fields[i]).slice(0, 80);
    // numbered badge
    page.drawRectangle({ x: MARGIN, y: y - 18, width: 22, height: 18, color: theme.overlay });
    const num = String(i + 1);
    const nw = fonts.bold.widthOfTextAtSize(num, 11);
    page.drawText(num, { x: MARGIN + 11 - nw / 2, y: y - 14, size: 11, font: fonts.bold, color: theme.accent });
    page.drawText(label, { x: MARGIN + 30, y: y - 14, size: 11, font: fonts.bold, color: theme.ink });
    y -= 28;
    // writing lines, fill the rest of allocated space
    const lineCount = Math.max(2, Math.floor((perH - 30) / lineGap));
    for (let j = 0; j < lineCount; j++) {
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.4, color: theme.hair });
      y -= lineGap;
    }
    y -= sectionGap;
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
}) {
  const coverPremiumScore = x.hasCover ? Math.min(100, Math.round(60 + x.coverScore * 0.4)) : 50;
  const thumbnailReadabilityScore = Math.min(100, Math.max(70, Math.round(x.coverScore || 80)));
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
