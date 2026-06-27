// Build a styled PDF from ebook content using pdf-lib
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { corsHeaders, admin, requireAdmin } from "../_shared/ai.ts";

const PAGE_W = 612; // Letter
const PAGE_H = 792;
const MARGIN = 64;

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

    const black = rgb(0.05, 0.05, 0.05);
    const accent = rgb(0.95, 0.85, 0.3);

    // Cover page
    const coverPage = pdf.addPage([PAGE_W, PAGE_H]);
    coverPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: black });
    if (e.cover_url) {
      try {
        const res = await fetch(e.cover_url);
        const buf = new Uint8Array(await res.arrayBuffer());
        const img = await pdf.embedPng(buf).catch(() => pdf.embedJpg(buf));
        const w = PAGE_W - 80, h = w * 1.5;
        coverPage.drawImage(img, { x: 40, y: PAGE_H - h - 40, width: w, height: Math.min(h, PAGE_H - 240) });
      } catch { /* skip */ }
    }
    // Title block at bottom
    coverPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 200, color: accent });
    drawWrapped(coverPage, e.title.toUpperCase(), MARGIN, 140, PAGE_W - 2 * MARGIN, helvBold, 28, black);
    if (e.subtitle) drawWrapped(coverPage, e.subtitle, MARGIN, 70, PAGE_W - 2 * MARGIN, helvOblique, 13, black);

    // Who this is for / copyright page
    const introPage = pdf.addPage([PAGE_W, PAGE_H]);
    introPage.drawText(safe("WHO THIS IS FOR"), { x: MARGIN, y: PAGE_H - MARGIN, size: 10, font: helvBold, color: black });
    introPage.drawLine({ start: { x: MARGIN, y: PAGE_H - MARGIN - 8 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - MARGIN - 8 }, thickness: 2, color: black });
    drawWrapped(introPage, e.target_buyer ?? "Readers who want a practical, premium guide.", MARGIN, PAGE_H - MARGIN - 40, PAGE_W - 2 * MARGIN, helv, 12, black);
    if (e.hook) drawWrapped(introPage, `"${e.hook}"`, MARGIN, PAGE_H - MARGIN - 140, PAGE_W - 2 * MARGIN, helvOblique, 14, black);
    introPage.drawText(safe(`© ${new Date().getFullYear()} Printly. All rights reserved.`), { x: MARGIN, y: MARGIN, size: 9, font: helv, color: black });

    // Table of contents
    const toc = (e.toc ?? []) as { title: string }[];
    const tocPage = pdf.addPage([PAGE_W, PAGE_H]);
    tocPage.drawText(safe("CONTENTS"), { x: MARGIN, y: PAGE_H - MARGIN, size: 24, font: helvBold, color: black });
    tocPage.drawLine({ start: { x: MARGIN, y: PAGE_H - MARGIN - 12 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - MARGIN - 12 }, thickness: 2, color: black });
    let ty = PAGE_H - MARGIN - 50;
    toc.forEach((c, i) => {
      tocPage.drawText(safe(`${String(i + 1).padStart(2, "0")}.`), { x: MARGIN, y: ty, size: 11, font: helvBold, color: black });
      tocPage.drawText(c.title.slice(0, 70), { x: MARGIN + 36, y: ty, size: 11, font: helv, color: black });
      ty -= 22;
      if (ty < MARGIN) return;
    });

    // Chapter pages
    const chapters = (e.chapters ?? []) as { title: string; content: string }[];
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      let page = pdf.addPage([PAGE_W, PAGE_H]);
      page.drawText(safe(`CHAPTER ${String(i + 1).padStart(2, "0")}`), { x: MARGIN, y: PAGE_H - MARGIN, size: 10, font: helvBold, color: black });
      drawWrapped(page, ch.title.toUpperCase(), MARGIN, PAGE_H - MARGIN - 30, PAGE_W - 2 * MARGIN, helvBold, 20, black);
      page.drawLine({ start: { x: MARGIN, y: PAGE_H - MARGIN - 70 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - MARGIN - 70 }, thickness: 2, color: black });
      let y = PAGE_H - MARGIN - 95;
      const paras = ch.content.split(/\n\n+/);
      for (const p of paras) {
        const lines = wrap(p.replace(/^#+\s*/, "").replace(/[*_>]/g, ""), helv, 11, PAGE_W - 2 * MARGIN);
        for (const ln of lines) {
          if (y < MARGIN + 40) {
            page.drawText(safe(`${i + 1}`), { x: PAGE_W - MARGIN, y: MARGIN, size: 9, font: helv, color: black });
            page = pdf.addPage([PAGE_W, PAGE_H]);
            y = PAGE_H - MARGIN;
          }
          page.drawText(ln, { x: MARGIN, y, size: 11, font: helv, color: black });
          y -= 16;
        }
        y -= 8;
      }
      page.drawText(safe(`${i + 1}`), { x: PAGE_W - MARGIN, y: MARGIN, size: 9, font: helv, color: black });
    }

    // Bonus section
    const bonuses = (e.bonuses ?? {}) as Record<string, string>;
    if (Object.keys(bonuses).length > 0) {
      const bp = pdf.addPage([PAGE_W, PAGE_H]);
      bp.drawText(safe("BONUS MATERIALS"), { x: MARGIN, y: PAGE_H - MARGIN, size: 22, font: helvBold, color: black });
      bp.drawLine({ start: { x: MARGIN, y: PAGE_H - MARGIN - 12 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - MARGIN - 12 }, thickness: 2, color: black });
      let y = PAGE_H - MARGIN - 50;
      for (const [k, v] of Object.entries(bonuses)) {
        bp.drawText(k.toUpperCase().replace(/_/g, " "), { x: MARGIN, y, size: 12, font: helvBold, color: black });
        y -= 18;
        const lines = wrap(String(v).slice(0, 500), helv, 11, PAGE_W - 2 * MARGIN);
        for (const ln of lines) {
          if (y < MARGIN + 40) break;
          bp.drawText(ln, { x: MARGIN, y, size: 11, font: helv, color: black });
          y -= 14;
        }
        y -= 14;
      }
    }

    // Back cover
    const back = pdf.addPage([PAGE_W, PAGE_H]);
    back.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: black });
    back.drawText(safe("PRINTLY"), { x: MARGIN, y: PAGE_H - 100, size: 36, font: helvBold, color: accent });
    drawWrapped(back, "Premium printables and ebooks for people who want to actually finish what they start.", MARGIN, PAGE_H - 170, PAGE_W - 2 * MARGIN, helv, 13, accent);

    const bytes = await pdf.save();
    const path = `${ebook_id}/${e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.pdf`;
    const { error: upErr } = await db.storage.from("ebook-pdfs").upload(path, bytes, {
      contentType: "application/pdf", upsert: true,
    });
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

// Helpers
// pdf-lib's standard fonts only support WinAnsi (Latin-1 + a few extras).
// Normalize smart punctuation to ASCII and drop any other unsupported codepoints
// so non-Latin characters (e.g. Cyrillic) don't crash the encoder.
function safe(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    // Keep Latin-1 range + tab/newline; drop everything else (Cyrillic, CJK, emoji, etc.)
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "");
}
function wrap(text: string, font: import("npm:pdf-lib@1.17.1").PDFFont, size: number, maxW: number): string[] {
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
function drawWrapped(page: import("npm:pdf-lib@1.17.1").PDFPage, text: string, x: number, y: number, maxW: number, font: import("npm:pdf-lib@1.17.1").PDFFont, size: number, color: import("npm:pdf-lib@1.17.1").RGB) {
  const lines = wrap(text, font, size, maxW);
  let cy = y;
  for (const ln of lines) {
    page.drawText(ln, { x, y: cy, size, font, color });
    cy -= size * 1.3;
  }
}

