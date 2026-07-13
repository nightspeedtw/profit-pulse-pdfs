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

import { PDFDocument, PDFImage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

// Auto-detect PNG vs JPEG magic bytes so callers can pass either.
async function embedImageSmart(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return await doc.embedPng(bytes);
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return await doc.embedJpg(bytes);
  }
  // Try PNG first, fall back to JPEG.
  try { return await doc.embedPng(bytes); } catch { return await doc.embedJpg(bytes); }
}

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
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/[\u0192\uFFFD]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function wrapLines(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of normalizeText(text).split(/\n+/)) {
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

function safePdfText(text: string): string {
  return normalizeText(text);
}

export async function buildPicturePdf(input: PicturePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 612;   // 8.5in
  const pageH = 792;   // 11in

  // -- Cover page -----------------------------------------------------------
  const coverImg = await embedImageSmart(doc, input.coverPng);
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
  const titleText = safePdfText(input.title);
  const subtitleText = input.subtitle ? safePdfText(input.subtitle) : "";
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
    const al = safePdfText(input.authorLine);
    const aw = bodyFont.widthOfTextAtSize(al, 12);
    titlePage.drawText(al, {
      x: (pageW - aw) / 2, y: 80, size: 12, font: bodyFont, color: rgb(0.4, 0.4, 0.45),
    });
  }

  // -- Interior spreads -----------------------------------------------------
  for (const spread of input.spreads) {
    const page = doc.addPage([pageW, pageH]);
    // Illustration occupies top ~60% with padding.
    const img = await embedImageSmart(doc, spread.imagePng);
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
    const caption = safePdfText(spread.caption);
    const size = 16;
    const lineHeight = size * 1.35;
    const maxChars = 60;
    const lines = wrapLines(caption, maxChars);
    let y = pageH - 72 - ih - 36;
    for (const line of lines) {
      if (y < 60) break;
      const safeLine = safePdfText(line);
      const lw = bodyFont.widthOfTextAtSize(safeLine, size);
      page.drawText(safeLine, {
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
  const end = safePdfText("The End");
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

// ---- Incremental builders (memory-safe multi-stage) ---------------------
// Used by kids-build-picture-pdf to keep each Edge invocation under the
// worker memory limit. Each stage loads the prior PDF bytes, appends a few
// pages, and re-serializes. pdf-lib preserves already-embedded image objects
// across load/save, so images are not re-decoded per stage.

const PAGE_W = 612;
const PAGE_H = 792;

export async function startPicturePdf(input: { title: string; subtitle?: string | null; authorLine?: string; coverPng: Uint8Array }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const coverImg = await embedImageSmart(doc, input.coverPng);
  const coverPage = doc.addPage([PAGE_W, PAGE_H]);
  const cscale = Math.max(PAGE_W / coverImg.width, PAGE_H / coverImg.height);
  const cw = coverImg.width * cscale;
  const ch = coverImg.height * cscale;
  coverPage.drawImage(coverImg, { x: (PAGE_W - cw) / 2, y: (PAGE_H - ch) / 2, width: cw, height: ch });

  const titlePage = doc.addPage([PAGE_W, PAGE_H]);
  const titleText = safePdfText(input.title);
  const subtitleText = input.subtitle ? safePdfText(input.subtitle) : "";
  const titleSize = 32;
  const tw = titleFont.widthOfTextAtSize(titleText, titleSize);
  titlePage.drawText(titleText, { x: (PAGE_W - tw) / 2, y: PAGE_H / 2 + 20, size: titleSize, font: titleFont, color: rgb(0.1, 0.1, 0.15) });
  if (subtitleText) {
    const sw = bodyFont.widthOfTextAtSize(subtitleText, 18);
    titlePage.drawText(subtitleText, { x: (PAGE_W - sw) / 2, y: PAGE_H / 2 - 20, size: 18, font: bodyFont, color: rgb(0.35, 0.35, 0.4) });
  }
  if (input.authorLine) {
    const al = safePdfText(input.authorLine);
    const aw = bodyFont.widthOfTextAtSize(al, 12);
    titlePage.drawText(al, { x: (PAGE_W - aw) / 2, y: 80, size: 12, font: bodyFont, color: rgb(0.4, 0.4, 0.45) });
  }
  return await doc.save();
}

export async function appendSpreadsToPdf(existing: Uint8Array, spreads: Array<{ caption: string; imagePng: Uint8Array }>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(existing);
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  for (const spread of spreads) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const img = await embedImageSmart(doc, spread.imagePng);
    const boxW = PAGE_W - 72;
    const boxH = PAGE_H * 0.58;
    const scale = Math.min(boxW / img.width, boxH / img.height);
    const iw = img.width * scale;
    const ih = img.height * scale;
    page.drawImage(img, { x: (PAGE_W - iw) / 2, y: PAGE_H - 72 - ih, width: iw, height: ih });
    const caption = safePdfText(spread.caption);
    const size = 16;
    const lineHeight = size * 1.35;
    const lines = wrapLines(caption, 60);
    let y = PAGE_H - 72 - ih - 36;
    for (const line of lines) {
      if (y < 60) break;
      const safeLine = safePdfText(line);
      const lw = bodyFont.widthOfTextAtSize(safeLine, size);
      page.drawText(safeLine, { x: (PAGE_W - lw) / 2, y, size, font: bodyFont, color: rgb(0.12, 0.12, 0.18) });
      y -= lineHeight;
    }
  }
  return await doc.save();
}

export async function finalizePicturePdf(existing: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(existing);
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const endPage = doc.addPage([PAGE_W, PAGE_H]);
  const end = safePdfText("The End");
  const ew = titleFont.widthOfTextAtSize(end, 40);
  endPage.drawText(end, { x: (PAGE_W - ew) / 2, y: PAGE_H / 2, size: 40, font: titleFont, color: rgb(0.15, 0.15, 0.2) });
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
