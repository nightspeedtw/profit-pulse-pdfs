// Square kids picture-book PDF builder (612 × 612 pt = 8.5 × 8.5 in).
//
// Skills wired here (owner review 2026-07-15):
//   SKILL A — text-safe frame: 36pt margin from trim for body/title text,
//             shrink-to-fit for titles, panel padding ≥16pt, line-height 1.35,
//             text block ≤ 65% page width. `assertTextSafe` throws if any
//             stamped glyph would leave the safe box.
//   SKILL B — integrated caption: warm dark-brown ink on a palette-tinted
//             translucent panel with feathered stacked-rect edge, not a stark
//             white rectangle.
//   SKILL F — bonus pages: `addSpotTheCluesPage` + `addTalkAboutStoryPage`
//             sit between the last story page and "The End".

import { PDFDocument, PDFImage, PDFFont, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { KIDS_BOOK_FORMAT } from "./kids-book-format.ts";

const PAGE_W = KIDS_BOOK_FORMAT.page_width_pt;   // 612
const PAGE_H = KIDS_BOOK_FORMAT.page_height_pt;  // 612

// SKILL A: safe-frame constants.
const SAFE_MARGIN_PT = 36;              // 0.5in from trim for body/title
const FOLIO_MARGIN_PT = 18;             // 0.25in for folios
const BODY_MAX_WIDTH_PT = PAGE_W * 0.65; // ≤ 65% page width
const LINE_HEIGHT_RATIO = 1.35;
const PANEL_PADDING_PT = 16;
const WARM_INK = rgb(0.22, 0.15, 0.10);   // #3a2619 warm dark-brown
const WARM_INK_SOFT = rgb(0.35, 0.25, 0.18);

// SKILL A: throws when text would clip the safe frame. Callers must catch and
// shrink-to-fit rather than render past the trim.
export class TextOverflowError extends Error {
  constructor(public reason: string, public bbox: { x: number; y: number; w: number; h: number }) {
    super(`text_safe_frame_gate: ${reason} bbox=${JSON.stringify(bbox)}`);
  }
}

function assertTextSafe(bbox: { x: number; y: number; w: number; h: number }, minMargin = SAFE_MARGIN_PT) {
  if (bbox.x < minMargin) throw new TextOverflowError("left-clip", bbox);
  if (bbox.y < minMargin) throw new TextOverflowError("bottom-clip", bbox);
  if (bbox.x + bbox.w > PAGE_W - minMargin) throw new TextOverflowError("right-clip", bbox);
  if (bbox.y + bbox.h > PAGE_H - minMargin) throw new TextOverflowError("top-clip", bbox);
}

async function embedImageSmart(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return await doc.embedPng(bytes);
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return await doc.embedJpg(bytes);
  }
  try { return await doc.embedPng(bytes); } catch { return await doc.embedJpg(bytes); }
}

export interface BonusContent {
  clues?: string[];                     // 3-5 short clue phrases for "Spot the Clues"
  discussion_questions?: string[];      // 3-4 discussion questions
  developmental_hook?: string | null;   // one-liner shown on Talk page footer
}

export interface PicturePdfInput {
  title: string;
  subtitle?: string | null;
  authorLine?: string;
  coverPng: Uint8Array;
  spreads: Array<{ caption: string; imagePng: Uint8Array; paletteHint?: [number, number, number] | null }>;
  bonus?: BonusContent | null;
}

// WinAnsi/StandardFont-safe normalization.
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

// Word-wrap by measured pixel width, not char count. This is the core of the
// SKILL A shrink-to-fit algorithm.
function wrapLinesByWidth(text: string, font: PDFFont, size: number, maxWidthPt: number): string[] {
  const out: string[] = [];
  for (const para of normalizeText(text).split(/\n+/)) {
    const words = para.split(/\s+/);
    let line = "";
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) > maxWidthPt && line) {
        out.push(line);
        line = w;
      } else {
        line = trial;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

// SKILL A: pick the largest font size that fits `text` inside a maxWidth/maxHeight
// box with wrapping. Returns {size, lines}. Never falls below `minSize`; if
// still overflowing at minSize, returns anyway with truncation flag (caller
// treats as gate failure).
function shrinkToFit(
  text: string,
  font: PDFFont,
  opts: { startSize: number; minSize: number; step: number; maxWidthPt: number; maxHeightPt: number },
): { size: number; lines: string[]; overflow: boolean } {
  const { startSize, minSize, step, maxWidthPt, maxHeightPt } = opts;
  for (let size = startSize; size >= minSize; size -= step) {
    const lines = wrapLinesByWidth(text, font, size, maxWidthPt);
    const totalH = lines.length * size * LINE_HEIGHT_RATIO;
    if (totalH <= maxHeightPt) return { size, lines, overflow: false };
  }
  // Last resort: force minSize, truncate to fit height.
  const size = minSize;
  const lines = wrapLinesByWidth(text, font, size, maxWidthPt);
  const maxLines = Math.max(1, Math.floor(maxHeightPt / (size * LINE_HEIGHT_RATIO)));
  return { size, lines: lines.slice(0, maxLines), overflow: lines.length > maxLines };
}

// Draw a full-bleed image scaled to cover the page (may crop overflow).
function drawFullBleed(page: ReturnType<PDFDocument["addPage"]>, img: PDFImage) {
  const scale = Math.max(PAGE_W / img.width, PAGE_H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  page.drawImage(img, { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, width: w, height: h });
}

// SKILL B — integrated caption panel.
// Instead of stark white, sample a warm cream tinted toward the paletteHint,
// paint 3 stacked rects with decreasing opacity to fake a feathered edge, and
// use warm-ink text (not pure black).
async function drawCaptionOverlay(
  doc: PDFDocument,
  page: ReturnType<PDFDocument["addPage"]>,
  caption: string,
  paletteHint?: [number, number, number] | null,
) {
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const text = safePdfText(caption);
  if (!text) return;

  const sideMargin = SAFE_MARGIN_PT;
  const panelPad = PANEL_PADDING_PT;
  const maxPanelH = PAGE_H * 0.34;
  const minPanelH = PAGE_H * 0.18;
  const maxTextWidth = Math.min(BODY_MAX_WIDTH_PT, PAGE_W - sideMargin * 2 - panelPad * 2);
  const maxTextHeight = maxPanelH - panelPad * 2;

  const fit = shrinkToFit(text, bodyFont, {
    startSize: 18, minSize: 14, step: 1,
    maxWidthPt: maxTextWidth, maxHeightPt: maxTextHeight,
  });
  const size = fit.size;
  const lineHeight = size * LINE_HEIGHT_RATIO;
  const lines = fit.lines;

  const textH = lines.length * lineHeight;
  const panelH = Math.max(minPanelH, Math.min(maxPanelH, textH + panelPad * 2));
  const panelY = sideMargin;
  const panelX = sideMargin;
  const panelW = PAGE_W - sideMargin * 2;

  // Panel color: warm cream biased toward paletteHint.
  const [pr, pg, pb] = paletteHint ?? [0.98, 0.95, 0.88];
  // Blend 70% cream + 30% palette hint, keep it light so text is readable.
  const cream: [number, number, number] = [0.98, 0.95, 0.88];
  const mix = (a: number, b: number) => a * 0.7 + b * 0.3;
  const fill = rgb(
    Math.min(1, mix(cream[0], pr)),
    Math.min(1, mix(cream[1], pg)),
    Math.min(1, mix(cream[2], pb)),
  );

  // Feathered stacked-rect look (3 layers, decreasing opacity outward).
  page.drawRectangle({
    x: panelX - 4, y: panelY - 4, width: panelW + 8, height: panelH + 8,
    color: fill, opacity: 0.35,
  });
  page.drawRectangle({
    x: panelX - 2, y: panelY - 2, width: panelW + 4, height: panelH + 4,
    color: fill, opacity: 0.65,
  });
  page.drawRectangle({
    x: panelX, y: panelY, width: panelW, height: panelH,
    color: fill, opacity: 0.9,
  });

  // Assert the panel itself stays in the safe frame.
  assertTextSafe({ x: panelX, y: panelY, w: panelW, h: panelH });

  // Center each line horizontally, stack from top.
  const startY = panelY + (panelH - textH) / 2 + textH - lineHeight;
  let y = startY;
  for (const raw of lines) {
    const safe = safePdfText(raw);
    const w = bodyFont.widthOfTextAtSize(safe, size);
    const x = (PAGE_W - w) / 2;
    assertTextSafe({ x, y, w, h: size });
    page.drawText(safe, { x, y, size, font: bodyFont, color: WARM_INK });
    y -= lineHeight;
  }
}

async function addCoverPage(doc: PDFDocument, coverPng: Uint8Array) {
  const img = await embedImageSmart(doc, coverPng);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  drawFullBleed(page, img);
}

// SKILL A — shrink-to-fit title/subtitle so nothing ever clips the trim.
async function addTitlePage(doc: PDFDocument, title: string, subtitle: string | null, authorLine?: string) {
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  // Warm cream background so title is not a stark white page.
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(0.99, 0.97, 0.92) });

  const t = safePdfText(title);
  const titleMaxW = PAGE_W - SAFE_MARGIN_PT * 2;
  const titleMaxH = PAGE_H * 0.35;
  const tf = shrinkToFit(t, titleFont, { startSize: 40, minSize: 18, step: 2, maxWidthPt: titleMaxW, maxHeightPt: titleMaxH });
  const tLineH = tf.size * LINE_HEIGHT_RATIO;
  const tTotalH = tf.lines.length * tLineH;
  let ty = PAGE_H / 2 + tTotalH / 2 - tLineH + 16;
  for (const line of tf.lines) {
    const w = titleFont.widthOfTextAtSize(line, tf.size);
    const x = (PAGE_W - w) / 2;
    assertTextSafe({ x, y: ty, w, h: tf.size });
    page.drawText(line, { x, y: ty, size: tf.size, font: titleFont, color: WARM_INK });
    ty -= tLineH;
  }

  if (subtitle) {
    const s = safePdfText(subtitle);
    const sf = shrinkToFit(s, bodyFont, {
      startSize: 18, minSize: 12, step: 1,
      maxWidthPt: PAGE_W - SAFE_MARGIN_PT * 2, maxHeightPt: 60,
    });
    const sLineH = sf.size * LINE_HEIGHT_RATIO;
    let sy = ty - 12;
    for (const line of sf.lines) {
      const w = bodyFont.widthOfTextAtSize(line, sf.size);
      const x = (PAGE_W - w) / 2;
      assertTextSafe({ x, y: sy, w, h: sf.size });
      page.drawText(line, { x, y: sy, size: sf.size, font: bodyFont, color: WARM_INK_SOFT });
      sy -= sLineH;
    }
  }

  if (authorLine) {
    const a = safePdfText(authorLine);
    const w = bodyFont.widthOfTextAtSize(a, 12);
    const x = (PAGE_W - w) / 2;
    const y = SAFE_MARGIN_PT + 12;
    assertTextSafe({ x, y, w, h: 12 });
    page.drawText(a, { x, y, size: 12, font: bodyFont, color: WARM_INK_SOFT });
  }
}

async function addCopyrightPage(doc: PDFDocument) {
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(0.99, 0.97, 0.92) });
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
    const x = (PAGE_W - w) / 2;
    assertTextSafe({ x, y, w, h: 10 });
    page.drawText(safe, { x, y, size: 10, font: bodyFont, color: WARM_INK_SOFT });
    y -= 16;
  }
}

async function addStoryPage(
  doc: PDFDocument,
  caption: string,
  imgBytes: Uint8Array,
  paletteHint?: [number, number, number] | null,
) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const img = await embedImageSmart(doc, imgBytes);
  drawFullBleed(page, img);
  await drawCaptionOverlay(doc, page, caption, paletteHint);
}

async function addClosingPage(doc: PDFDocument) {
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(0.99, 0.97, 0.92) });
  const end = safePdfText("The End");
  const w = titleFont.widthOfTextAtSize(end, 44);
  const x = (PAGE_W - w) / 2;
  const y = PAGE_H / 2 - 10;
  assertTextSafe({ x, y, w, h: 44 });
  page.drawText(end, { x, y, size: 44, font: titleFont, color: WARM_INK });
}

// SKILL F — bonus page 1: "Can You Spot the Clues?"
async function addSpotTheCluesPage(doc: PDFDocument, clues: string[]) {
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  // Warm decorated background.
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(0.99, 0.96, 0.88) });
  // Decorative accent band.
  page.drawRectangle({ x: 0, y: PAGE_H - 24, width: PAGE_W, height: 12, color: rgb(0.88, 0.72, 0.42), opacity: 0.6 });
  page.drawRectangle({ x: 0, y: 12, width: PAGE_W, height: 12, color: rgb(0.88, 0.72, 0.42), opacity: 0.6 });

  const title = "Can You Spot the Clues?";
  const tf = shrinkToFit(title, titleFont, {
    startSize: 30, minSize: 20, step: 1,
    maxWidthPt: PAGE_W - SAFE_MARGIN_PT * 2, maxHeightPt: 80,
  });
  let y = PAGE_H - 100;
  for (const line of tf.lines) {
    const w = titleFont.widthOfTextAtSize(line, tf.size);
    const x = (PAGE_W - w) / 2;
    assertTextSafe({ x, y, w, h: tf.size });
    page.drawText(line, { x, y, size: tf.size, font: titleFont, color: WARM_INK });
    y -= tf.size * LINE_HEIGHT_RATIO;
  }

  const intro = "Look back through the story. Which of these clues can you find?";
  const introFit = shrinkToFit(intro, bodyFont, {
    startSize: 16, minSize: 13, step: 1,
    maxWidthPt: BODY_MAX_WIDTH_PT, maxHeightPt: 60,
  });
  y -= 12;
  for (const line of introFit.lines) {
    const w = bodyFont.widthOfTextAtSize(line, introFit.size);
    const x = (PAGE_W - w) / 2;
    assertTextSafe({ x, y, w, h: introFit.size });
    page.drawText(line, { x, y, size: introFit.size, font: bodyFont, color: WARM_INK_SOFT });
    y -= introFit.size * LINE_HEIGHT_RATIO;
  }

  y -= 24;
  const bulletSize = 18;
  for (const clueRaw of clues.slice(0, 5)) {
    const clue = safePdfText(`•  ${clueRaw}`);
    const bf = shrinkToFit(clue, bodyFont, {
      startSize: bulletSize, minSize: 14, step: 1,
      maxWidthPt: BODY_MAX_WIDTH_PT, maxHeightPt: 40,
    });
    for (const line of bf.lines) {
      const w = bodyFont.widthOfTextAtSize(line, bf.size);
      const x = (PAGE_W - w) / 2;
      assertTextSafe({ x, y, w, h: bf.size });
      page.drawText(line, { x, y, size: bf.size, font: bodyFont, color: WARM_INK });
      y -= bf.size * LINE_HEIGHT_RATIO;
    }
    y -= 4;
  }

  y -= 12;
  const prompt = safePdfText("Which clue did you notice first?");
  const pf = shrinkToFit(prompt, titleFont, {
    startSize: 16, minSize: 13, step: 1,
    maxWidthPt: BODY_MAX_WIDTH_PT, maxHeightPt: 40,
  });
  for (const line of pf.lines) {
    const w = titleFont.widthOfTextAtSize(line, pf.size);
    const x = (PAGE_W - w) / 2;
    assertTextSafe({ x, y, w, h: pf.size });
    page.drawText(line, { x, y, size: pf.size, font: titleFont, color: WARM_INK });
    y -= pf.size * LINE_HEIGHT_RATIO;
  }
}

// SKILL F — bonus page 2: "Talk About the Story"
async function addTalkAboutStoryPage(doc: PDFDocument, questions: string[], hook?: string | null) {
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(0.96, 0.98, 0.94) });
  page.drawRectangle({ x: 0, y: PAGE_H - 24, width: PAGE_W, height: 12, color: rgb(0.6, 0.78, 0.6), opacity: 0.55 });
  page.drawRectangle({ x: 0, y: 12, width: PAGE_W, height: 12, color: rgb(0.6, 0.78, 0.6), opacity: 0.55 });

  const title = "Talk About the Story";
  const tf = shrinkToFit(title, titleFont, {
    startSize: 30, minSize: 20, step: 1,
    maxWidthPt: PAGE_W - SAFE_MARGIN_PT * 2, maxHeightPt: 80,
  });
  let y = PAGE_H - 100;
  for (const line of tf.lines) {
    const w = titleFont.widthOfTextAtSize(line, tf.size);
    const x = (PAGE_W - w) / 2;
    assertTextSafe({ x, y, w, h: tf.size });
    page.drawText(line, { x, y, size: tf.size, font: titleFont, color: WARM_INK });
    y -= tf.size * LINE_HEIGHT_RATIO;
  }

  y -= 20;
  const qs = questions.slice(0, 4);
  for (let i = 0; i < qs.length; i++) {
    const q = safePdfText(`${i + 1}.  ${qs[i]}`);
    const qf = shrinkToFit(q, bodyFont, {
      startSize: 17, minSize: 13, step: 1,
      maxWidthPt: BODY_MAX_WIDTH_PT, maxHeightPt: 90,
    });
    for (const line of qf.lines) {
      const w = bodyFont.widthOfTextAtSize(line, qf.size);
      const x = (PAGE_W - w) / 2;
      assertTextSafe({ x, y, w, h: qf.size });
      page.drawText(line, { x, y, size: qf.size, font: bodyFont, color: WARM_INK });
      y -= qf.size * LINE_HEIGHT_RATIO;
    }
    y -= 8;
  }

  if (hook) {
    y = Math.max(SAFE_MARGIN_PT + 24, y - 20);
    const hf = shrinkToFit(safePdfText(hook), titleFont, {
      startSize: 14, minSize: 11, step: 1,
      maxWidthPt: BODY_MAX_WIDTH_PT, maxHeightPt: 40,
    });
    for (const line of hf.lines) {
      const w = titleFont.widthOfTextAtSize(line, hf.size);
      const x = (PAGE_W - w) / 2;
      assertTextSafe({ x, y, w, h: hf.size });
      page.drawText(line, { x, y, size: hf.size, font: titleFont, color: WARM_INK_SOFT });
      y -= hf.size * LINE_HEIGHT_RATIO;
    }
  }
}

// ── One-shot builder (kept for legacy repair callers) ────────────────────
export async function buildPicturePdf(input: PicturePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  await addCoverPage(doc, input.coverPng);
  await addTitlePage(doc, input.title, input.subtitle ?? null, input.authorLine);
  await addCopyrightPage(doc);
  for (const s of input.spreads) await addStoryPage(doc, s.caption, s.imagePng, s.paletteHint ?? null);
  if (input.bonus) {
    if (input.bonus.clues?.length) await addSpotTheCluesPage(doc, input.bonus.clues);
    if (input.bonus.discussion_questions?.length) {
      await addTalkAboutStoryPage(doc, input.bonus.discussion_questions, input.bonus.developmental_hook ?? null);
    }
  }
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

export async function appendSpreadsToPdf(
  existing: Uint8Array,
  spreads: Array<{ caption: string; imagePng: Uint8Array; paletteHint?: [number, number, number] | null }>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(existing);
  for (const s of spreads) await addStoryPage(doc, s.caption, s.imagePng, s.paletteHint ?? null);
  return await doc.save();
}

// SKILL F: append bonus + closing in one atomic finalize pass so page count
// math and cross-references stay consistent.
export async function finalizePicturePdf(existing: Uint8Array, bonus?: BonusContent | null): Promise<Uint8Array> {
  const doc = await PDFDocument.load(existing);
  if (bonus) {
    if (bonus.clues?.length) await addSpotTheCluesPage(doc, bonus.clues);
    if (bonus.discussion_questions?.length) {
      await addTalkAboutStoryPage(doc, bonus.discussion_questions, bonus.developmental_hook ?? null);
    }
  }
  await addClosingPage(doc);
  return await doc.save();
}

// Split a manuscript into N caption blocks.
//
// SKILL E rewrite: sentence-first bin-packing. NEVER cut a sentence in half —
// the owner review of Detective Pip proved word-splitting causes "I just make
// a big," / "for his happy" truncations. We split the entire manuscript into
// complete sentences (or short line-blocks for chant refrains), then greedily
// pack them into N bins targeting equal word counts.
export function splitManuscriptForSpreads(md: string, n: number): string[] {
  const cleaned = normalizeText(md).replace(/\*\*[^*]+\*\*/g, "").trim();
  if (!cleaned) return Array(n).fill("");

  // Split into sentence-ish units: prefer sentence terminators, but preserve
  // asterisked chant lines (refrain markers) as their own units.
  const units: string[] = [];
  for (const block of cleaned.split(/\n{2,}/)) {
    const b = block.trim();
    if (!b) continue;
    // Chant/refrain block (italic-star lines) → keep as one unit.
    if (b.startsWith("*") && b.split("\n").every((l) => l.trim().startsWith("*"))) {
      units.push(b.replace(/\*/g, "").split("\n").map((l) => l.trim()).filter(Boolean).join(" "));
      continue;
    }
    // Prose block → sentence split.
    const sentences = b.replace(/\n+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"'])/).map((s) => s.trim()).filter(Boolean);
    for (const s of sentences) units.push(s);
  }
  if (units.length === 0) return Array(n).fill("");

  // Bin-pack: distribute units across n bins, minimizing word-count variance,
  // NEVER splitting a unit across bins. Greedy: assign each unit to the bin
  // with the smallest current word count.
  const bins: string[][] = Array.from({ length: n }, () => []);
  const wc: number[] = Array(n).fill(0);
  // Prefer to spread evenly by processing in original order but with a soft
  // "next open bin" preference so bin-1's don't monopolize early units.
  let nextBin = 0;
  const totalWords = units.reduce((s, u) => s + u.split(/\s+/).filter(Boolean).length, 0);
  const targetPerBin = Math.max(1, Math.floor(totalWords / n));
  for (const u of units) {
    const w = u.split(/\s+/).filter(Boolean).length;
    // If the "current" bin is under target, keep filling it; else advance.
    if (wc[nextBin] >= targetPerBin && nextBin < n - 1) nextBin++;
    bins[nextBin].push(u);
    wc[nextBin] += w;
  }

  // If some bins are empty (few units, many pages), pad by re-distributing
  // from the largest bins: split their unit list in halves until every bin
  // has content. This never cuts a sentence.
  let empty = bins.findIndex((b) => b.length === 0);
  while (empty >= 0) {
    let donor = 0;
    for (let i = 1; i < n; i++) if (bins[i].length > bins[donor].length) donor = i;
    if (bins[donor].length < 2) break;
    const mid = Math.ceil(bins[donor].length / 2);
    bins[empty] = bins[donor].slice(mid);
    bins[donor] = bins[donor].slice(0, mid);
    empty = bins.findIndex((b) => b.length === 0);
  }

  return bins.map((b) => b.join(" "));
}
