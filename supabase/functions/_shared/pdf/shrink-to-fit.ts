// Layout text shrink-to-fit — permanent rule for ALL customer-facing
// text stamped into PDFs by pdf-lib (matter pages, certificate, footer
// copyright, title/subtitle when rendered as text rather than SVG).
//
// SKILL A ("measure → shrink → wrap → never clip") originally shipped
// for storybook layout was not extended to the coloring lane, so long
// strings on matter pages overflowed the safe margin. This module is
// the single shared implementation. Never bypass it.
//
// API:
//   drawFitText(page, opts) — single-line fit; shrinks font to fit maxWidth.
//   drawFitParagraph(page, opts) — multi-line fit; shrinks + wraps within a box.
//
// Both return a { finalSize, lines, truncated } report so callers can
// log the fit outcome. If even minSize does not fit, the text is
// ellipsis-truncated rather than clipped.

// @ts-nocheck  Deno edge runtime — pdf-lib Font/Page types
import type { PDFFont, PDFPage, RGB } from "npm:pdf-lib@1.17.1";

export interface FitReport {
  finalSize: number;
  lines: string[];
  truncated: boolean;
}

export interface FitTextOpts {
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  font: PDFFont;
  size: number;        // requested (max) size
  minSize?: number;    // absolute floor; default 6
  color?: RGB;
  align?: "left" | "center" | "right";
}

export interface FitParagraphOpts extends Omit<FitTextOpts, "y"> {
  y: number;           // TOP of the text box (we draw downward)
  maxHeight: number;
  lineHeightFactor?: number; // default 1.25
}

function widthOf(text: string, font: PDFFont, size: number): number {
  try { return font.widthOfTextAtSize(text, size); }
  catch { return text.length * size * 0.55; }
}

function heightOf(font: PDFFont, size: number, lineFactor: number, lines: number): number {
  try { return font.heightAtSize(size) * lineFactor * lines; }
  catch { return size * lineFactor * lines; }
}

function ellipsize(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const ell = "…";
  if (widthOf(text, font, size) <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (widthOf(text.slice(0, mid) + ell, font, size) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + ell;
}

/**
 * Fit a single-line string into maxWidth by shrinking from size → minSize
 * in 0.5pt steps. If minSize still overflows, ellipsize.
 */
export function drawFitText(page: PDFPage, opts: FitTextOpts): FitReport {
  const min = opts.minSize ?? 6;
  const font = opts.font;
  let size = opts.size;
  while (size > min && widthOf(opts.text, font, size) > opts.maxWidth) {
    size = Math.max(min, size - 0.5);
  }
  let text = opts.text;
  let truncated = false;
  if (widthOf(text, font, size) > opts.maxWidth) {
    text = ellipsize(text, font, size, opts.maxWidth);
    truncated = true;
  }
  const w = widthOf(text, font, size);
  const align = opts.align ?? "left";
  const x = align === "center" ? opts.x - w / 2
          : align === "right"  ? opts.x - w
          : opts.x;
  page.drawText(text, { x, y: opts.y, size, font, color: opts.color });
  return { finalSize: size, lines: [text], truncated };
}

function wordWrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const attempt = cur ? cur + " " + w : w;
    if (widthOf(attempt, font, size) <= maxWidth) {
      cur = attempt;
    } else {
      if (cur) out.push(cur);
      // If a single word exceeds maxWidth, keep it (renderer will still overflow
      // horizontally by definition, but shrink loop will reduce size until it fits).
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Fit a paragraph into a bounding box. Shrinks font size until wrapped
 * lines fit BOTH maxWidth and maxHeight. If minSize still doesn't fit,
 * truncates the final line with an ellipsis. Never clips.
 */
export function drawFitParagraph(page: PDFPage, opts: FitParagraphOpts): FitReport {
  const min = opts.minSize ?? 6;
  const font = opts.font;
  const lineFactor = opts.lineHeightFactor ?? 1.25;
  const paragraphs = opts.text.split(/\n/);

  let size = opts.size;
  let lines: string[] = [];

  while (size >= min) {
    lines = [];
    for (const p of paragraphs) {
      if (!p.trim()) { lines.push(""); continue; }
      lines.push(...wordWrap(p, font, size, opts.maxWidth));
    }
    const totalH = heightOf(font, size, lineFactor, Math.max(1, lines.length));
    const allFitWidth = lines.every((ln) => widthOf(ln, font, size) <= opts.maxWidth);
    if (allFitWidth && totalH <= opts.maxHeight) break;
    if (size <= min) break;
    size = Math.max(min, size - 0.5);
  }

  let truncated = false;
  // If at min size we still overflow height, truncate trailing lines.
  const lineH = size * lineFactor;
  const maxLines = Math.max(1, Math.floor(opts.maxHeight / lineH));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[lines.length - 1] = ellipsize(lines[lines.length - 1] + " …", font, size, opts.maxWidth);
    truncated = true;
  }
  // If any single line still overflows width at min size, ellipsize it.
  for (let i = 0; i < lines.length; i++) {
    if (widthOf(lines[i], font, size) > opts.maxWidth) {
      lines[i] = ellipsize(lines[i], font, size, opts.maxWidth);
      truncated = true;
    }
  }

  const align = opts.align ?? "left";
  let y = opts.y;
  for (const ln of lines) {
    const w = widthOf(ln, font, size);
    const x = align === "center" ? opts.x - w / 2
            : align === "right"  ? opts.x - w
            : opts.x;
    if (ln) page.drawText(ln, { x, y, size, font, color: opts.color });
    y -= lineH;
  }

  return { finalSize: size, lines, truncated };
}

/**
 * Pure measurement — useful for tests that want to verify shrink behavior
 * without a live PDFPage. Returns what drawFitParagraph WOULD lay out.
 */
export function measureFitParagraph(opts: {
  text: string; font: PDFFont; size: number; minSize?: number;
  maxWidth: number; maxHeight: number; lineHeightFactor?: number;
}): FitReport {
  const min = opts.minSize ?? 6;
  const lineFactor = opts.lineHeightFactor ?? 1.25;
  const paragraphs = opts.text.split(/\n/);
  let size = opts.size;
  let lines: string[] = [];
  while (size >= min) {
    lines = [];
    for (const p of paragraphs) {
      if (!p.trim()) { lines.push(""); continue; }
      lines.push(...wordWrap(p, opts.font, size, opts.maxWidth));
    }
    const totalH = heightOf(opts.font, size, lineFactor, Math.max(1, lines.length));
    const allFitWidth = lines.every((ln) => widthOf(ln, opts.font, size) <= opts.maxWidth);
    if (allFitWidth && totalH <= opts.maxHeight) break;
    if (size <= min) break;
    size = Math.max(min, size - 0.5);
  }
  let truncated = false;
  const lineH = size * lineFactor;
  const maxLines = Math.max(1, Math.floor(opts.maxHeight / lineH));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[lines.length - 1] = ellipsize(lines[lines.length - 1] + " …", opts.font, size, opts.maxWidth);
    truncated = true;
  }
  for (let i = 0; i < lines.length; i++) {
    if (widthOf(lines[i], opts.font, size) > opts.maxWidth) {
      lines[i] = ellipsize(lines[i], opts.font, size, opts.maxWidth);
      truncated = true;
    }
  }
  return { finalSize: size, lines, truncated };
}
