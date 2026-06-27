// Build a styled premium PDF: cover page with text overlay on bg image,
// chapter dividers, framework diagrams, worksheets/checklists rendered as pdf-lib shapes.
import { PDFDocument, PDFFont, PDFPage, RGB, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { corsHeaders, admin, requireAdmin } from "../_shared/ai.ts";

const PAGE_W = 612; // Letter
const PAGE_H = 792;
const MARGIN = 64;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id } = await req.json();
    if (!ebook_id) throw new Error("ebook_id required");
    const { data: e } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
    if (!e) throw new Error("Ebook not found");

    const pdf = await PDFDocument.create();
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const helvOblique = await pdf.embedFont(StandardFonts.HelveticaOblique);

    const spec: CoverSpec = (e.cover_spec ?? {}) as CoverSpec;
    const palette = spec.color_palette ?? ["#0b1a2b", "#ffffff", "#f5c518"];
    const overlay = hexToRgb(palette[0]);
    const textColor = hexToRgb(palette[1] ?? "#ffffff");
    const accent = hexToRgb(palette[2] ?? "#f5c518");
    const layout = (spec.layout_direction || "bottom").toLowerCase();

    // ============ COVER ============
    const coverPage = pdf.addPage([PAGE_W, PAGE_H]);
    coverPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: overlay });
    // Background image (text-free) — prefer cover_bg_url, fallback to cover_url
    const bgSrc = e.cover_bg_url || e.cover_url;
    if (bgSrc) {
      try {
        const res = await fetch(bgSrc);
        const buf = new Uint8Array(await res.arrayBuffer());
        const img = await pdf.embedPng(buf).catch(() => pdf.embedJpg(buf));
        // full bleed cover
        coverPage.drawImage(img, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
      } catch { /* skip */ }
    }
    // Text panel
    const panelH = layout === "top" ? 240 : layout === "center" ? 280 : 280;
    const panelY = layout === "top" ? PAGE_H - panelH : layout === "center" ? (PAGE_H - panelH) / 2 : 0;
    // semi-transparent overlay panel
    coverPage.drawRectangle({ x: 0, y: panelY, width: PAGE_W, height: panelH, color: overlay, opacity: 0.82 });
    // Accent bar
    coverPage.drawRectangle({ x: MARGIN, y: panelY + panelH - 30, width: 50, height: 5, color: accent });
    // Badge
    if (spec.badge_text) {
      const bw = Math.min(spec.badge_text.length * 7 + 24, 300);
      coverPage.drawRectangle({ x: MARGIN, y: PAGE_H - 60, width: bw, height: 26, color: accent });
      coverPage.drawText(safe(spec.badge_text.toUpperCase()), {
        x: MARGIN + 12, y: PAGE_H - 52, size: 10, font: helvBold, color: rgb(0.05, 0.05, 0.05),
      });
    }
    const title = safe((spec.title_text || e.title || "").toUpperCase());
    const subtitle = safe(spec.subtitle_text || e.subtitle || "");
    const brand = safe((spec.brand_text || "SECRET PDF").toUpperCase());
    drawWrapped(coverPage, title, MARGIN, panelY + panelH - 60, PAGE_W - 2 * MARGIN, helvBold, 28, textColor);
    if (subtitle) drawWrapped(coverPage, subtitle, MARGIN, panelY + 80, PAGE_W - 2 * MARGIN, helv, 12, textColor);
    coverPage.drawText(brand, { x: MARGIN, y: panelY + 24, size: 9, font: helvBold, color: textColor });

    // ============ INTRO / WHO THIS IS FOR ============
    const introPage = pdf.addPage([PAGE_W, PAGE_H]);
    drawSectionHeader(introPage, "WHO THIS IS FOR", helvBold, accent);
    drawWrapped(introPage, e.target_buyer ?? "Readers who want a practical, premium guide.", MARGIN, PAGE_H - MARGIN - 60, PAGE_W - 2 * MARGIN, helv, 12, rgb(0.05, 0.05, 0.05));
    if (e.hook) drawWrapped(introPage, `"${e.hook}"`, MARGIN, PAGE_H - MARGIN - 160, PAGE_W - 2 * MARGIN, helvOblique, 14, rgb(0.05, 0.05, 0.05));
    introPage.drawText(safe(`© ${new Date().getFullYear()} Secret PDF. All rights reserved.`), { x: MARGIN, y: MARGIN, size: 9, font: helv, color: rgb(0.3, 0.3, 0.3) });

    // ============ TOC ============
    const toc = (e.toc ?? []) as { title: string }[];
    const tocPage = pdf.addPage([PAGE_W, PAGE_H]);
    drawSectionHeader(tocPage, "CONTENTS", helvBold, accent);
    let ty = PAGE_H - MARGIN - 60;
    toc.forEach((c, i) => {
      tocPage.drawText(safe(`${String(i + 1).padStart(2, "0")}.`), { x: MARGIN, y: ty, size: 11, font: helvBold, color: accent });
      tocPage.drawText(safe(c.title.slice(0, 70)), { x: MARGIN + 36, y: ty, size: 11, font: helv, color: rgb(0.05, 0.05, 0.05) });
      ty -= 22;
    });

    // ============ CHAPTERS with dividers + interior visuals ============
    const visuals: InteriorVisuals = (e.interior_visuals ?? {}) as InteriorVisuals;
    const diagrams = visuals.framework_diagrams ?? [];
    const worksheets = visuals.worksheets_and_templates ?? [];
    const diagramByChapter = new Map<number, FrameworkDiagram[]>();
    const wsByChapter = new Map<number, Worksheet[]>();
    const parseCh = (s: string) => { const m = /(\d+)/.exec(s ?? ""); return m ? Number(m[1]) : 0; };
    for (const d of diagrams) {
      const k = parseCh(d.chapter);
      if (!diagramByChapter.has(k)) diagramByChapter.set(k, []);
      diagramByChapter.get(k)!.push(d);
    }
    for (const w of worksheets) {
      const k = parseCh(w.chapter);
      if (!wsByChapter.has(k)) wsByChapter.set(k, []);
      wsByChapter.get(k)!.push(w);
    }

    const chapters = (e.chapters ?? []) as { title: string; content: string }[];
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      // Chapter divider page
      const div = pdf.addPage([PAGE_W, PAGE_H]);
      div.drawRectangle({ x: 0, y: PAGE_H / 2 - 40, width: PAGE_W, height: 80, color: overlay });
      div.drawText(safe(`CHAPTER ${String(i + 1).padStart(2, "0")}`), { x: MARGIN, y: PAGE_H / 2 + 10, size: 12, font: helvBold, color: accent });
      drawWrapped(div, safe(ch.title.toUpperCase()), MARGIN, PAGE_H / 2 - 20, PAGE_W - 2 * MARGIN, helvBold, 22, textColor);

      // Chapter content
      let page = pdf.addPage([PAGE_W, PAGE_H]);
      page.drawText(safe(`${ch.title}`.slice(0, 50)), { x: MARGIN, y: PAGE_H - 40, size: 9, font: helv, color: rgb(0.45, 0.45, 0.45) });
      page.drawLine({ start: { x: MARGIN, y: PAGE_H - 48 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - 48 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
      let y = PAGE_H - 70;
      const paras = ch.content.split(/\n\n+/);
      for (const p of paras) {
        const lines = wrap(p.replace(/^#+\s*/, "").replace(/[*_>]/g, ""), helv, 11, PAGE_W - 2 * MARGIN);
        for (const ln of lines) {
          if (y < MARGIN + 40) {
            page.drawText(safe(`${i + 1}`), { x: PAGE_W - MARGIN, y: MARGIN - 10, size: 9, font: helv, color: rgb(0.45, 0.45, 0.45) });
            page = pdf.addPage([PAGE_W, PAGE_H]);
            y = PAGE_H - MARGIN;
          }
          page.drawText(ln, { x: MARGIN, y, size: 11, font: helv, color: rgb(0.05, 0.05, 0.05) });
          y -= 16;
        }
        y -= 8;
      }
      page.drawText(safe(`${i + 1}`), { x: PAGE_W - MARGIN, y: MARGIN - 10, size: 9, font: helv, color: rgb(0.45, 0.45, 0.45) });

      // Diagrams for this chapter
      for (const d of (diagramByChapter.get(i + 1) ?? [])) {
        const dp = pdf.addPage([PAGE_W, PAGE_H]);
        drawDiagram(dp, d, helv, helvBold, accent, overlay);
      }
      // Worksheets for this chapter
      for (const w of (wsByChapter.get(i + 1) ?? [])) {
        const wp = pdf.addPage([PAGE_W, PAGE_H]);
        drawWorksheet(wp, w, helv, helvBold, accent);
      }
    }

    // ============ BONUSES ============
    const bonuses = (e.bonuses ?? {}) as Record<string, string>;
    if (Object.keys(bonuses).length > 0) {
      const bp = pdf.addPage([PAGE_W, PAGE_H]);
      drawSectionHeader(bp, "BONUS MATERIALS", helvBold, accent);
      let y = PAGE_H - MARGIN - 60;
      for (const [k, v] of Object.entries(bonuses)) {
        bp.drawText(safe(k.toUpperCase().replace(/_/g, " ")), { x: MARGIN, y, size: 12, font: helvBold, color: accent });
        y -= 18;
        const lines = wrap(String(v).slice(0, 500), helv, 11, PAGE_W - 2 * MARGIN);
        for (const ln of lines) {
          if (y < MARGIN + 40) break;
          bp.drawText(ln, { x: MARGIN, y, size: 11, font: helv, color: rgb(0.05, 0.05, 0.05) });
          y -= 14;
        }
        y -= 14;
      }
    }

    // ============ BACK COVER ============
    const back = pdf.addPage([PAGE_W, PAGE_H]);
    back.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: overlay });
    back.drawText(safe((spec.brand_text || "SECRET PDF").toUpperCase()), { x: MARGIN, y: PAGE_H - 100, size: 32, font: helvBold, color: accent });
    drawWrapped(back, "Premium PDF guides, frameworks, and playbooks for people who want to actually finish what they start.", MARGIN, PAGE_H - 170, PAGE_W - 2 * MARGIN, helv, 13, textColor);

    const bytes = await pdf.save();
    const path = `${ebook_id}/${e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.pdf`;
    const { error: upErr } = await db.storage.from("ebook-pdfs").upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw upErr;
    const { data: signed } = await db.storage.from("ebook-pdfs").createSignedUrl(path, 60 * 60 * 24 * 365);
    await db.from("ebooks").update({ pdf_url: signed?.signedUrl }).eq("id", ebook_id);

    return new Response(JSON.stringify({ pdf_url: signed?.signedUrl, pages: pdf.getPageCount() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ============ Helpers ============
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
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = safe(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW) {
      if (line) lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function drawWrapped(page: PDFPage, text: string, x: number, y: number, maxW: number, font: PDFFont, size: number, color: RGB) {
  const lines = wrap(text, font, size, maxW);
  let cy = y;
  for (const ln of lines) {
    page.drawText(ln, { x, y: cy, size, font, color });
    cy -= size * 1.3;
  }
}
function drawSectionHeader(page: PDFPage, label: string, font: PDFFont, accent: RGB) {
  page.drawRectangle({ x: MARGIN, y: PAGE_H - MARGIN + 12, width: 30, height: 4, color: accent });
  page.drawText(safe(label), { x: MARGIN, y: PAGE_H - MARGIN - 14, size: 22, font, color: rgb(0.05, 0.05, 0.05) });
  page.drawLine({ start: { x: MARGIN, y: PAGE_H - MARGIN - 24 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - MARGIN - 24 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
}

function drawDiagram(page: PDFPage, d: FrameworkDiagram, helv: PDFFont, helvBold: PDFFont, accent: RGB, overlay: RGB) {
  drawSectionHeader(page, `FRAMEWORK · ${safe(d.visual_name || "").toUpperCase().slice(0, 50)}`, helvBold, accent);
  if (d.purpose) drawWrapped(page, d.purpose, MARGIN, PAGE_H - MARGIN - 50, PAGE_W - 2 * MARGIN, helv, 10, rgb(0.35, 0.35, 0.35));

  const ink = rgb(0.05, 0.05, 0.05);
  const muted = rgb(0.93, 0.93, 0.93);
  const top = PAGE_H - MARGIN - 110;
  const areaH = top - MARGIN - 40;
  const nodes = (d.nodes ?? []).map((n) => safe(n));

  switch (d.type) {
    case "process_flow": {
      const n = Math.max(nodes.length, 1);
      const boxH = Math.min(60, areaH / (n + 1) - 10);
      let y = top - boxH;
      for (let i = 0; i < n; i++) {
        page.drawRectangle({ x: MARGIN, y, width: PAGE_W - 2 * MARGIN, height: boxH, color: muted, borderColor: ink, borderWidth: 1 });
        page.drawRectangle({ x: MARGIN, y, width: 6, height: boxH, color: accent });
        page.drawText(safe(`${i + 1}`), { x: MARGIN + 16, y: y + boxH / 2 - 6, size: 12, font: helvBold, color: ink });
        drawWrapped(page, nodes[i], MARGIN + 40, y + boxH - 18, PAGE_W - 2 * MARGIN - 60, helv, 11, ink);
        y -= boxH + 14;
        if (i < n - 1) {
          page.drawLine({ start: { x: PAGE_W / 2, y: y + boxH + 14 }, end: { x: PAGE_W / 2, y: y + boxH + 2 }, thickness: 1, color: ink });
        }
      }
      break;
    }
    case "pyramid": {
      const n = Math.max(nodes.length, 1);
      const layerH = areaH / n;
      for (let i = 0; i < n; i++) {
        const w = ((i + 1) / n) * (PAGE_W - 2 * MARGIN);
        const x = (PAGE_W - w) / 2;
        const y = MARGIN + 40 + i * layerH;
        page.drawRectangle({ x, y, width: w, height: layerH - 6, color: i % 2 === 0 ? muted : rgb(0.85, 0.85, 0.85), borderColor: ink, borderWidth: 1 });
        page.drawText(safe(nodes[i].slice(0, 60)), { x: x + 12, y: y + layerH / 2 - 6, size: 11, font: helvBold, color: ink });
      }
      break;
    }
    case "matrix_2x2": {
      const size = Math.min(PAGE_W - 2 * MARGIN, areaH);
      const x0 = (PAGE_W - size) / 2;
      const y0 = MARGIN + 40;
      page.drawRectangle({ x: x0, y: y0, width: size, height: size, borderColor: ink, borderWidth: 1, color: rgb(1, 1, 1) });
      page.drawLine({ start: { x: x0 + size / 2, y: y0 }, end: { x: x0 + size / 2, y: y0 + size }, thickness: 1, color: ink });
      page.drawLine({ start: { x: x0, y: y0 + size / 2 }, end: { x: x0 + size, y: y0 + size / 2 }, thickness: 1, color: ink });
      const cells = [
        { x: x0 + 8, y: y0 + size - 14 - 11 }, // top left
        { x: x0 + size / 2 + 8, y: y0 + size - 14 - 11 },
        { x: x0 + 8, y: y0 + size / 2 - 14 - 11 },
        { x: x0 + size / 2 + 8, y: y0 + size / 2 - 14 - 11 },
      ];
      for (let i = 0; i < Math.min(4, nodes.length); i++) {
        drawWrapped(page, nodes[i], cells[i].x, cells[i].y, size / 2 - 16, helvBold, 11, ink);
      }
      if (d.labels?.x_axis) {
        page.drawText(safe(d.labels.x_axis[0]), { x: x0, y: y0 - 14, size: 9, font: helv, color: rgb(0.4, 0.4, 0.4) });
        page.drawText(safe(d.labels.x_axis[1]), { x: x0 + size - 80, y: y0 - 14, size: 9, font: helv, color: rgb(0.4, 0.4, 0.4) });
      }
      if (d.labels?.y_axis) {
        page.drawText(safe(d.labels.y_axis[1]), { x: x0 - 50, y: y0 + size - 10, size: 9, font: helv, color: rgb(0.4, 0.4, 0.4) });
        page.drawText(safe(d.labels.y_axis[0]), { x: x0 - 50, y: y0, size: 9, font: helv, color: rgb(0.4, 0.4, 0.4) });
      }
      break;
    }
    case "circle_cycle": {
      const cx = PAGE_W / 2;
      const cy = MARGIN + 40 + areaH / 2;
      const r = Math.min(areaH, PAGE_W - 2 * MARGIN) / 2 - 50;
      const n = Math.max(nodes.length, 1);
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
        const nx = cx + r * Math.cos(angle);
        const ny = cy + r * Math.sin(angle);
        page.drawCircle({ x: nx, y: ny, size: 36, color: muted, borderColor: ink, borderWidth: 1 });
        page.drawText(safe(`${i + 1}`), { x: nx - 4, y: ny - 5, size: 14, font: helvBold, color: ink });
        drawWrapped(page, nodes[i], nx - 60, ny - 50, 120, helv, 9, ink);
      }
      page.drawCircle({ x: cx, y: cy, size: r - 50, borderColor: accent, borderWidth: 1.5, color: rgb(1, 1, 1), opacity: 0 });
      break;
    }
    case "before_after": {
      const colW = (PAGE_W - 2 * MARGIN - 20) / 2;
      const h = Math.min(areaH - 20, 360);
      const y = MARGIN + 40;
      page.drawRectangle({ x: MARGIN, y, width: colW, height: h, color: muted, borderColor: ink, borderWidth: 1 });
      page.drawText("BEFORE", { x: MARGIN + 12, y: y + h - 24, size: 12, font: helvBold, color: rgb(0.5, 0.1, 0.1) });
      drawWrapped(page, nodes[0] ?? "", MARGIN + 12, y + h - 50, colW - 24, helv, 11, ink);
      page.drawRectangle({ x: MARGIN + colW + 20, y, width: colW, height: h, color: rgb(0.93, 0.97, 0.93), borderColor: ink, borderWidth: 1 });
      page.drawText("AFTER", { x: MARGIN + colW + 32, y: y + h - 24, size: 12, font: helvBold, color: rgb(0.1, 0.4, 0.1) });
      drawWrapped(page, nodes[1] ?? "", MARGIN + colW + 32, y + h - 50, colW - 24, helv, 11, ink);
      break;
    }
    case "comparison_table": {
      const cols = 2;
      const rows = Math.ceil(nodes.length / cols);
      const colW = (PAGE_W - 2 * MARGIN) / cols;
      const rowH = Math.min(50, areaH / Math.max(rows, 1));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (idx >= nodes.length) break;
          const x = MARGIN + c * colW;
          const y = top - (r + 1) * rowH;
          page.drawRectangle({ x, y, width: colW, height: rowH, borderColor: ink, borderWidth: 0.5, color: r === 0 ? muted : rgb(1, 1, 1) });
          drawWrapped(page, nodes[idx], x + 8, y + rowH - 14, colW - 16, r === 0 ? helvBold : helv, 10, ink);
        }
      }
      break;
    }
    case "checklist":
    default: {
      let y = top - 20;
      for (let i = 0; i < nodes.length; i++) {
        if (y < MARGIN + 30) break;
        page.drawRectangle({ x: MARGIN, y: y - 4, width: 14, height: 14, borderColor: ink, borderWidth: 1, color: rgb(1, 1, 1) });
        drawWrapped(page, nodes[i], MARGIN + 24, y + 5, PAGE_W - 2 * MARGIN - 24, helv, 11, ink);
        y -= 26;
      }
      break;
    }
  }
}

function drawWorksheet(page: PDFPage, w: Worksheet, helv: PDFFont, helvBold: PDFFont, accent: RGB) {
  drawSectionHeader(page, `WORKSHEET · ${safe(w.asset_name || "").toUpperCase().slice(0, 50)}`, helvBold, accent);
  if (w.purpose) drawWrapped(page, w.purpose, MARGIN, PAGE_H - MARGIN - 50, PAGE_W - 2 * MARGIN, helv, 10, rgb(0.35, 0.35, 0.35));
  const ink = rgb(0.05, 0.05, 0.05);
  const muted = rgb(0.9, 0.9, 0.9);
  let y = PAGE_H - MARGIN - 100;
  for (const field of (w.fields_or_sections ?? [])) {
    if (y < MARGIN + 60) break;
    page.drawText(safe(field).slice(0, 80), { x: MARGIN, y, size: 11, font: helvBold, color: ink });
    y -= 16;
    // 3 ruled lines
    for (let i = 0; i < 3; i++) {
      page.drawLine({ start: { x: MARGIN, y: y - i * 18 }, end: { x: PAGE_W - MARGIN, y: y - i * 18 }, thickness: 0.5, color: muted });
    }
    y -= 70;
  }
}
