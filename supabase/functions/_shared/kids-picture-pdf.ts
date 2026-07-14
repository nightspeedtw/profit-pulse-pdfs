// Square kids picture-book PDF builder (612 × 612 pt = 8.5 × 8.5 in).
//
// Layout per page:
//   - Cover page:       full-bleed cover image.
//   - Title page:       centered title + subtitle.
//   - Copyright page:   small centered copyright line.
//   - Story pages (N):  full-bleed illustration; a soft white rounded panel at
//                       the lower ~30% carries 1–3 short sentences of caption.
//   - Closing page:     "The End" in the story's warm accent.
//
// All glyphs are normalized to StandardFont-safe ASCII BEFORE encoding so the
// QC glyph-mangling rule never trips on curly quotes / em-dashes.

import { PDFDocument, PDFImage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { KIDS_BOOK_FORMAT } from "./kids-book-format.ts";

const PAGE_W = KIDS_BOOK_FORMAT.page_width_pt;   // 612
const PAGE_H = KIDS_BOOK_FORMAT.page_height_pt;  // 612

async function embedImageSmart(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return await doc.embedPng(bytes);
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return await doc.embedJpg(bytes);
  }
  try { return await doc.embedPng(bytes); } catch { return await doc.embedJpg(bytes); }
}

export interface PicturePdfInput {
  title: string;
  subtitle?: string | null;
  authorLine?: string;
  coverPng: Uint8Array;
  spreads: Array<{ caption: string; imagePng: Uint8Array }>;
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

function safePdfText(text: string): string { return normalizeText(text); }

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
  }
  return out;
}

// Draw a full-bleed image scaled to cover the page (may crop overflow).
function drawFullBleed(page: ReturnType<PDFDocument["addPage"]>, img: PDFImage) {
  const scale = Math.max(PAGE_W / img.width, PAGE_H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  page.drawImage(img, { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, width: w, height: h });
}

// Draw a soft rounded white panel at the bottom carrying 1-3 short sentences.
// The panel auto-sizes to fit the wrapped caption (min 25% / max 38% of page).
async function drawCaptionOverlay(
  doc: PDFDocument,
  page: ReturnType<PDFDocument["addPage"]>,
  caption: string,
) {
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const text = safePdfText(caption);
  if (!text) return;
  const size = 16;
  const lineHeight = size * 1.35;
  const sideMargin = 36;
  const maxWidth = PAGE_W - sideMargin * 2 - 24;
  // Char-width approx wrap.
  const avgCharPt = bodyFont.widthOfTextAtSize("m", size) * 0.9;
  const maxChars = Math.max(20, Math.floor(maxWidth / avgCharPt));
  const lines = wrapLines(text, maxChars).slice(0, 4); // hard-cap 4 lines

  const panelPad = 14;
  const panelH = Math.min(PAGE_H * 0.38, Math.max(PAGE_H * 0.16, lines.length * lineHeight + panelPad * 2));
  const panelY = sideMargin;
  const panelX = sideMargin;
  const panelW = PAGE_W - sideMargin * 2;

  // Rounded-ish panel (pdf-lib has no rounded rect natively; draw filled rect with light border).
  page.drawRectangle({
    x: panelX, y: panelY, width: panelW, height: panelH,
    color: rgb(1, 1, 1), opacity: 0.92,
    borderColor: rgb(0.85, 0.85, 0.88), borderWidth: 1,
  });

  // Center each line horizontally, stack vertically.
  const totalTextH = lines.length * lineHeight;
  let y = panelY + (panelH - totalTextH) / 2 + (lines.length - 1) * lineHeight;
  for (const line of lines) {
    const safe = safePdfText(line);
    const w = bodyFont.widthOfTextAtSize(safe, size);
    page.drawText(safe, {
      x: (PAGE_W - w) / 2, y, size, font: bodyFont, color: rgb(0.12, 0.12, 0.18),
    });
    y -= lineHeight;
  }
}

async function addCoverPage(doc: PDFDocument, coverPng: Uint8Array) {
  const img = await embedImageSmart(doc, coverPng);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  drawFullBleed(page, img);
}

async function addTitlePage(doc: PDFDocument, title: string, subtitle: string | null, authorLine?: string) {
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const t = safePdfText(title);
  const tSize = 34;
  const tw = titleFont.widthOfTextAtSize(t, tSize);
  page.drawText(t, { x: (PAGE_W - tw) / 2, y: PAGE_H / 2 + 20, size: tSize, font: titleFont, color: rgb(0.1, 0.1, 0.15) });
  if (subtitle) {
    const s = safePdfText(subtitle);
    const ss = 16;
    const sw = bodyFont.widthOfTextAtSize(s, ss);
    page.drawText(s, { x: (PAGE_W - sw) / 2, y: PAGE_H / 2 - 12, size: ss, font: bodyFont, color: rgb(0.35, 0.35, 0.4) });
  }
  if (authorLine) {
    const a = safePdfText(authorLine);
    const aw = bodyFont.widthOfTextAtSize(a, 12);
    page.drawText(a, { x: (PAGE_W - aw) / 2, y: 60, size: 12, font: bodyFont, color: rgb(0.4, 0.4, 0.45) });
  }
}

async function addCopyrightPage(doc: PDFDocument) {
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const year = new Date().getFullYear();
  const lines = [
    `Copyright (c) ${year}. All rights reserved.`,
    `No part of this book may be reproduced without permission.`,
    `Printed for read-aloud enjoyment.`,
  ];
  let y = PAGE_H / 2 + 12;
  for (const l of lines) {
    const safe = safePdfText(l);
    const w = bodyFont.widthOfTextAtSize(safe, 10);
    page.drawText(safe, { x: (PAGE_W - w) / 2, y, size: 10, font: bodyFont, color: rgb(0.45, 0.45, 0.5) });
    y -= 16;
  }
}

async function addStoryPage(doc: PDFDocument, caption: string, imgBytes: Uint8Array) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const img = await embedImageSmart(doc, imgBytes);
  drawFullBleed(page, img);
  await drawCaptionOverlay(doc, page, caption);
}

async function addClosingPage(doc: PDFDocument) {
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const end = safePdfText("The End");
  const w = titleFont.widthOfTextAtSize(end, 44);
  page.drawText(end, { x: (PAGE_W - w) / 2, y: PAGE_H / 2 - 10, size: 44, font: titleFont, color: rgb(0.15, 0.15, 0.2) });
}

// ── One-shot builder (kept for legacy repair callers) ────────────────────
export async function buildPicturePdf(input: PicturePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  await addCoverPage(doc, input.coverPng);
  await addTitlePage(doc, input.title, input.subtitle ?? null, input.authorLine);
  await addCopyrightPage(doc);
  for (const s of input.spreads) await addStoryPage(doc, s.caption, s.imagePng);
  await addClosingPage(doc);
  return await doc.save();
}

// ── Incremental (staged) builders — used by kids-build-picture-pdf ───────

export async function startPicturePdf(input: { title: string; subtitle?: string | null; authorLine?: string; coverPng: Uint8Array }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  await addCoverPage(doc, input.coverPng);
  await addTitlePage(doc, input.title, input.subtitle ?? null, input.authorLine);
  await addCopyrightPage(doc);
  return await doc.save();
}

export async function appendSpreadsToPdf(existing: Uint8Array, spreads: Array<{ caption: string; imagePng: Uint8Array }>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(existing);
  for (const s of spreads) await addStoryPage(doc, s.caption, s.imagePng);
  return await doc.save();
}

export async function finalizePicturePdf(existing: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(existing);
  await addClosingPage(doc);
  return await doc.save();
}

// Split a manuscript into N caption blocks (paragraph-based grouping).
// IMPORTANT: returns "" for pages with no manuscript text — callers must
// treat empty captions as a hard failure (Gate 4). Never emit a "Page N"
// placeholder here; that produced the "Page 28" bug in Detective Pip.
export function splitManuscriptForSpreads(md: string, n: number): string[] {
  const paras = md.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paras.length === 0) return Array(n).fill("");
  const chunkSize = Math.max(1, Math.ceil(paras.length / n));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const chunk = paras.slice(i * chunkSize, (i + 1) * chunkSize).join(" ");
    out.push(chunk);
  }
  return out;
}
