// Real illustrated picture-book PDF builder using pdf-lib.
//
// Produces:
//   - 1 cover page (full-bleed cover image)
//   - 1 title page (title + subtitle text, real embedded font)
//   - N interior spreads: each has one interior illustration on top and
//     the story caption text below, using WinAnsi-safe normalization.
//   - 1 closing "The End" page.
//
// All glyphs are normalized to StandardFont-safe ASCII BEFORE encoding so
// the QC glyph-mangling rule never trips on curly quotes / em-dashes.

import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

export interface PicturePdfInput {
  title: string;
  subtitle?: string | null;
  authorLine?: string;
  coverPng: Uint8Array;
  spreads: Array<{
    caption: string;      // 1–3 sentences of body text for this spread
    imagePng: Uint8Array; // interior illustration bytes
  }>;
}

// WinAnsi/StandardFont-safe normalization. Must match pdf-preflight glyph check.
export function normalizeText(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[^\x20-\x7E\n]/g, "");
}

function wrapLines(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    const words = para.split(/\s+/);
    let line = "";
    for (const w of words) {
      if ((line + " " + w).trim().length > maxChars) {
        if (line) out.push(line);
        line = w;
      } else {
        line = (line ? line + " " : "") + w;
      }
    }
    if (line) out.push(line);
    out.push("");
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

export async function buildPicturePdf(input: PicturePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 612;   // 8.5in
  const pageH = 792;   // 11in

  // -- Cover page -----------------------------------------------------------
  const coverImg = await doc.embedPng(input.coverPng);
  const coverPage = doc.addPage([pageW, pageH]);
  // full-bleed
  const cscale = Math.max(pageW / coverImg.width, pageH / coverImg.height);
  const cw = coverImg.width * cscale;
  const ch = coverImg.height * cscale;
  coverPage.drawImage(coverImg, {
    x: (pageW - cw) / 2,
    y: (pageH - ch) / 2,
    width: cw,
    height: ch,
  });

  // -- Title page -----------------------------------------------------------
  const titlePage = doc.addPage([pageW, pageH]);
  const titleText = normalizeText(input.title);
  const subtitleText = input.subtitle ? normalizeText(input.subtitle) : "";
  const titleSize = 32;
  const subSize = 18;
  const tw = titleFont.widthOfTextAtSize(titleText, titleSize);
  titlePage.drawText(titleText, {
    x: (pageW - tw) / 2,
    y: pageH / 2 + 20,
    size: titleSize,
    font: titleFont,
    color: rgb(0.1, 0.1, 0.15),
  });
  if (subtitleText) {
    const sw = bodyFont.widthOfTextAtSize(subtitleText, subSize);
    titlePage.drawText(subtitleText, {
      x: (pageW - sw) / 2,
      y: pageH / 2 - 20,
      size: subSize,
      font: bodyFont,
      color: rgb(0.35, 0.35, 0.4),
    });
  }
  if (input.authorLine) {
    const al = normalizeText(input.authorLine);
    const aw = bodyFont.widthOfTextAtSize(al, 12);
    titlePage.drawText(al, {
      x: (pageW - aw) / 2, y: 80, size: 12, font: bodyFont, color: rgb(0.4, 0.4, 0.45),
    });
  }

  // -- Interior spreads -----------------------------------------------------
  for (const spread of input.spreads) {
    const page = doc.addPage([pageW, pageH]);
    // Illustration occupies top ~60% with padding.
    const img = await doc.embedPng(spread.imagePng);
    const boxW = pageW - 72;
    const boxH = pageH * 0.58;
    const scale = Math.min(boxW / img.width, boxH / img.height);
    const iw = img.width * scale;
    const ih = img.height * scale;
    page.drawImage(img, {
      x: (pageW - iw) / 2,
      y: pageH - 72 - ih,
      width: iw,
      height: ih,
    });

    // Caption below, wrapped, 16pt Helvetica.
    const caption = normalizeText(spread.caption);
    const size = 16;
    const lineHeight = size * 1.35;
    const maxChars = 60;
    const lines = wrapLines(caption, maxChars);
    let y = pageH - 72 - ih - 36;
    for (const line of lines) {
      if (y < 60) break;
      const lw = bodyFont.widthOfTextAtSize(line, size);
      page.drawText(line, {
        x: (pageW - lw) / 2,
        y,
        size,
        font: bodyFont,
        color: rgb(0.12, 0.12, 0.18),
      });
      y -= lineHeight;
    }
  }

  // -- Closing page ---------------------------------------------------------
  const endPage = doc.addPage([pageW, pageH]);
  const end = "The End";
  const ew = titleFont.widthOfTextAtSize(end, 40);
  endPage.drawText(end, {
    x: (pageW - ew) / 2,
    y: pageH / 2,
    size: 40,
    font: titleFont,
    color: rgb(0.15, 0.15, 0.2),
  });

  return await doc.save();
}

// Split a manuscript into N caption blocks (paragraph-based grouping).
export function splitManuscriptForSpreads(md: string, n: number): string[] {
  const paras = md.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paras.length === 0) return Array(n).fill("");
  const chunkSize = Math.max(1, Math.ceil(paras.length / n));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const chunk = paras.slice(i * chunkSize, (i + 1) * chunkSize).join(" ");
    out.push(chunk || `Page ${i + 1}`);
  }
  return out;
}
